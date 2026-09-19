import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { uploadRepo, accountRepo, toIso } from '@statusflow/database';
import { parseOr400 } from '../../utils/validate.js';

const querySchema = z.object({
  accountId: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function historyRoutes(app: FastifyInstance) {
  void app;
  // List is shared with /api/uploads (GET)
  const list = async (req: { query: unknown }) => {
    const q = parseOr400(querySchema, req.query);
    const { rows, total } = uploadRepo.list(q);
    const names = new Map(accountRepo.list().map((a) => [a.id, a.name]));
    return {
      data: rows.map((u) => ({
        id: u.id,
        accountId: u.account_id,
        accountName: names.get(u.account_id) ?? 'Unknown',
        originalFilename: u.original_filename,
        mimeType: u.mime_type,
        fileSize: u.file_size,
        duration: u.duration,
        width: u.width,
        height: u.height,
        status: u.status,
        errorMessage: u.error_message,
        errorCode: u.error_code,
        audience: u.audience,
        delivered: u.delivered === null ? null : u.delivered === 1,
        startedAt: toIso(u.started_at),
        completedAt: toIso(u.completed_at),
        createdAt: toIso(u.created_at) ?? u.created_at,
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  };

  return { list };
}

export function registerHistoryRoutes(app: FastifyInstance) {
  app.get('/api/uploads', async (req) => {
    const { list } = await historyRoutes(app);
    return list(req);
  });

  app.get('/api/uploads/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const u = uploadRepo.get(id);
    if (!u) return reply.code(404).send({ error: 'Upload not found', code: 'NOT_FOUND' });
    const acc = accountRepo.get(u.account_id);
    return {
      id: u.id,
      accountId: u.account_id,
      accountName: acc?.name ?? 'Unknown',
      originalFilename: u.original_filename,
      mimeType: u.mime_type,
      fileSize: u.file_size,
      duration: u.duration,
      width: u.width,
      height: u.height,
      status: u.status,
      errorMessage: u.error_message,
      errorCode: u.error_code,
      audience: u.audience,
      delivered: u.delivered === null ? null : u.delivered === 1,
      startedAt: toIso(u.started_at),
      completedAt: toIso(u.completed_at),
      createdAt: toIso(u.created_at) ?? u.created_at,
    };
  });

  app.delete('/api/uploads/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const u = uploadRepo.get(id);
    if (!u) return reply.code(404).send({ error: 'Upload not found', code: 'NOT_FOUND' });
    if (!['SUCCESS', 'FAILED', 'CANCELLED'].includes(u.status)) {
      return reply.code(409).send({ error: 'Cannot delete an active upload', code: 'UPLOAD_ACTIVE' });
    }
    uploadRepo.remove(id);
    return { ok: true };
  });
}
