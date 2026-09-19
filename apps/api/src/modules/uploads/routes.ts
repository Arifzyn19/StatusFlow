/**
 * UploadModule — multipart ingest, strict validation, transcode-if-needed,
 * publish via WhatsAppModule, temp cleanup, SSE progress.
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from '@statusflow/config';
import { accountRepo, uploadRepo, toIso } from '@statusflow/database';
import { AppError } from '../../utils/errors.js';
import { bus } from '../../utils/events.js';
import { Semaphore } from '../../utils/semaphore.js';
import { ensureSecureDir, safeFilename, rmQuiet } from '../../utils/fs.js';
import {
  detectSignature,
  probe,
  ensurePublishable,
  extForMime,
} from '../video/service.js';
import { publishStatus, getStatus } from '../whatsapp/service.js';

const uploadSem = new Semaphore(config.maxConcurrentUploads);
const ffmpegSem = new Semaphore(config.maxConcurrentFfmpeg);
const cancelled = new Set<string>();

const ALLOWED_EXT = new Set(['.mp4', '.mov', '.webm']);

function uploadDto(r: ReturnType<typeof uploadRepo.get> & object, accountName?: string) {
  const u = r as {
    id: string;
    account_id: string;
    original_filename: string;
    mime_type: string;
    file_size: number;
    duration: number | null;
    width: number | null;
    height: number | null;
    status: string;
    error_message: string | null;
    error_code: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
  };
  return {
    id: u.id,
    accountId: u.account_id,
    accountName,
    originalFilename: u.original_filename,
    mimeType: u.mime_type,
    fileSize: u.file_size,
    duration: u.duration,
    width: u.width,
    height: u.height,
    status: u.status,
    errorMessage: u.error_message,
    errorCode: u.error_code,
    startedAt: toIso(u.started_at),
    completedAt: toIso(u.completed_at),
    createdAt: toIso(u.created_at) ?? u.created_at,
  };
}

async function fail(id: string, code: string, message: string, tmp: string[], publishPath?: string) {
  uploadRepo.update(id, {
    status: 'FAILED',
    error_message: message,
    error_code: code,
    completed_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  } as never);
  bus.emit('upload.status', { uploadId: id, status: 'FAILED', errorCode: code, errorMessage: message });
  for (const p of tmp) await rmQuiet(p);
  if (publishPath) await rmQuiet(publishPath);
}

export async function uploadRoutes(app: FastifyInstance) {
  // Create upload: multipart { accountId, file }
  app.post('/api/uploads', async (req, reply) => {
    const release = uploadSem.tryAcquire();
    if (!release) {
      return reply
        .code(429)
        .send({ error: 'Too many concurrent uploads. Try again shortly.', code: 'CONCURRENCY_LIMIT' });
    }
    let tmpPath = '';
    let publishPath = '';
    const ownedTmps: string[] = [];
    try {
      const parts = req.parts();
      let accountId = '';
      let filePart: Awaited<ReturnType<typeof parts.next>> | null = null;
      let filename = '';
      let mimetype = '';

      for await (const part of parts as unknown as AsyncIterable<{
        type: string;
        fieldname: string;
        value?: unknown;
        filename?: string;
        mimetype?: string;
        file?: NodeJS.ReadableStream;
      }>) {
        if (part.type === 'field' && part.fieldname === 'accountId') accountId = String(part.value ?? '');
        if (part.type === 'file') {
          filePart = part as never;
          filename = safeFilename(part.filename ?? 'video.mp4');
          mimetype = part.mimetype ?? 'video/mp4';
          break;
        }
      }
      if (!accountId || !filePart) {
        throw new AppError('BAD_REQUEST', 'accountId and video file are required.', 400);
      }

      const account = accountRepo.get(accountId);
      if (!account) throw new AppError('ACCOUNT_NOT_FOUND', 'WhatsApp account not found.', 404);
      if (getStatus(accountId) !== 'CONNECTED' && account.status !== 'CONNECTED') {
        throw new AppError('ACCOUNT_NOT_CONNECTED', 'Account is not connected.', 409);
      }

      const ext = path.extname(filename).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        throw new AppError('UNSUPPORTED_FORMAT', `Unsupported extension ${ext}. Use MP4, MOV or WebM.`, 415);
      }
      const maxBytes = config.maxUploadSizeMB * 1024 * 1024;

      ensureSecureDir(config.tempDir);
      tmpPath = path.join(config.tempDir, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
      ownedTmps.push(tmpPath);

      // Stream to disk with size cap (never fully buffer in RAM)
      let seen = 0;
      const fp = (filePart as unknown as { file: NodeJS.ReadableStream }).file;
      const out = fs.createWriteStream(tmpPath);
      await new Promise<void>((resolve, reject) => {
        fp.on('data', (c: Buffer) => {
          seen += c.length;
          if (seen > maxBytes) {
            out.destroy();
            reject(new AppError('FILE_TOO_LARGE', `File exceeds ${config.maxUploadSizeMB} MB limit.`, 413));
          }
        });
        fp.on('error', reject);
        out.on('error', reject);
        out.on('finish', () => resolve());
        fp.pipe(out);
      }).catch(async (e) => {
        await rmQuiet(tmpPath);
        throw e;
      });

      const stat = await fs.promises.stat(tmpPath);
      const rec = uploadRepo.create({
        accountId,
        filename,
        mime: mimetype,
        size: stat.size,
      });
      const uploadId = rec.id;
      bus.emit('upload.status', { uploadId, status: 'QUEUED', progress: 5 });

      // Async pipeline with timeout
      const timeout = setTimeout(() => {
        cancelled.add(uploadId);
      }, config.uploadTimeoutMs);
      timeout.unref?.();

      (async () => {
        try {
          if (cancelled.has(uploadId)) throw new AppError('CANCELLED', 'Upload cancelled.', 499);
          uploadRepo.update(uploadId, { status: 'VALIDATING' } as never);
          bus.emit('upload.status', { uploadId, status: 'VALIDATING', progress: 15 });

          // 1. MIME allowlist
          if (!config.allowedVideoMime.includes(mimetype)) {
            throw new AppError('UNSUPPORTED_FORMAT', `MIME ${mimetype} is not allowed.`, 415);
          }
          // 2. Real signature check (first 64 bytes)
          const fh = await fs.promises.open(tmpPath, 'r');
          const head = Buffer.alloc(64);
          await fh.read(head, 0, 64, 0);
          await fh.close();
          const sig = detectSignature(head);
          if (!sig) throw new AppError('INVALID_VIDEO', 'File signature is not a valid video.', 422);

          // 3. Probe
          const meta = await probe(tmpPath);
          if (meta.duration && meta.duration > config.maxVideoDurationSeconds) {
            throw new AppError(
              'VIDEO_TOO_LONG',
              `Video is ${Math.round(meta.duration)}s; limit is ${config.maxVideoDurationSeconds}s.`,
              422,
            );
          }
          uploadRepo.update(uploadId, {
            status: 'PROCESSING',
            duration: meta.duration,
            width: meta.width,
            height: meta.height,
          } as never);
          bus.emit('upload.status', { uploadId, status: 'PROCESSING', progress: 40 });

          if (cancelled.has(uploadId)) throw new AppError('CANCELLED', 'Upload cancelled.', 499);

          // 4. Transcode only if needed
          const ffRelease = await ffmpegSem.acquire();
          try {
            // NOTE: the progress callback must not close over `transcoded`
            // below — it fires from a timer while the await is still pending
            // (temporal dead zone → ReferenceError → process crash).
            const onFfmpegProgress = (pct: number) => {
              bus.emit('upload.progress', { uploadId, progress: 40 + Math.round(pct * 0.3) });
            };
            const { path: pub, transcoded } = await ensurePublishable(tmpPath, meta, onFfmpegProgress);
            bus.emit('upload.progress', { uploadId, progress: 70, transcoded });
            publishPath = transcoded ? pub : '';
          } finally {
            ffRelease();
          }

          if (cancelled.has(uploadId)) throw new AppError('CANCELLED', 'Upload cancelled.', 499);

          // 5. Publish
          const finalFile = publishPath || tmpPath;
          // Normalize extension for Baileys mimetype
          uploadRepo.update(uploadId, { status: 'PUBLISHING' } as never);
          bus.emit('upload.status', { uploadId, status: 'PUBLISHING', progress: 80 });
          void extForMime;
          const { messageId, audience } = await publishStatus(accountId, finalFile);
          app.log.info({ uploadId, messageId, audience }, 'status published');

          uploadRepo.update(uploadId, {
            status: 'SUCCESS',
            error_message: null,
            error_code: null,
            completed_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
          } as never);
          bus.emit('upload.status', { uploadId, status: 'SUCCESS', progress: 100, audience, messageId });
        } catch (e) {
          if (e instanceof AppError && e.code === 'CANCELLED') {
            uploadRepo.update(uploadId, {
              status: 'CANCELLED',
              error_message: 'Cancelled by user.',
              error_code: 'CANCELLED',
              completed_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
            } as never);
            bus.emit('upload.status', { uploadId, status: 'CANCELLED', progress: 0 });
          } else {
            const code = e instanceof AppError ? e.code : 'PUBLISH_FAILED';
            const msg =
              e instanceof Error ? e.message : 'Publishing failed.';
            const friendly =
              (e as { code?: string })?.code === 'ACCOUNT_NOT_CONNECTED'
                ? 'Account disconnected during upload.'
                : msg;
            await fail(uploadId, code === 'CANCELLED' ? 'CANCELLED' : code, friendly, ownedTmps, publishPath);
            app.log.error({ err: e, uploadId }, 'upload pipeline failed');
          }
        } finally {
          clearTimeout(timeout);
          cancelled.delete(uploadId);
          for (const p of ownedTmps) await rmQuiet(p);
          if (publishPath) await rmQuiet(publishPath);
          release();
        }
      })();

      const created = uploadRepo.get(uploadId)!;
      return reply.code(202).send(uploadDto(created, account.name));
    } catch (e) {
      release();
      if (tmpPath) await rmQuiet(tmpPath);
      throw e;
    }
  });

  app.post('/api/uploads/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const u = uploadRepo.get(id);
    if (!u) return reply.code(404).send({ error: 'Upload not found', code: 'NOT_FOUND' });
    if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(u.status)) {
      return reply.code(409).send({ error: 'Upload already finished', code: 'ALREADY_FINISHED' });
    }
    cancelled.add(id);
    return { ok: true };
  });

  // Silence unused import warning for pipeline (kept for future resumable support)
  void pipeline;
}
