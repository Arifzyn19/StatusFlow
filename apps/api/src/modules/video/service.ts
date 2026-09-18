/**
 * VideoModule — validate + probe + transcode-only-if-needed.
 * Never promises lossless publishing: WhatsApp may compress on its side.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { AppError } from '../../utils/errors.js';

const execFileAsync = promisify(execFile);

export interface VideoMeta {
  duration: number | null;
  width: number | null;
  height: number | null;
  vcodec: string | null;
  acodec: string | null;
  container: string | null;
}

const SIGNATURES: { mime: string; check: (b: Buffer) => boolean }[] = [
  { mime: 'video/mp4', check: (b) => b.subarray(4, 8).toString() === 'ftyp' },
  { mime: 'video/quicktime', check: (b) => b.subarray(4, 8).toString() === 'ftyp' },
  {
    mime: 'video/webm',
    check: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
];

export function detectSignature(buf: Buffer): string | null {
  for (const s of SIGNATURES) {
    try {
      if (s.check(buf)) return s.mime;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function probe(filePath: string): Promise<VideoMeta> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    const j = JSON.parse(stdout);
    const v = (j.streams ?? []).find((s: { codec_type: string }) => s.codec_type === 'video');
    const a = (j.streams ?? []).find((s: { codec_type: string }) => s.codec_type === 'audio');
    return {
      duration: j.format?.duration ? Number(j.format.duration) : null,
      width: v?.width ?? null,
      height: v?.height ?? null,
      vcodec: v?.codec_name ?? null,
      acodec: a?.codec_name ?? null,
      container: j.format?.format_name ?? null,
    };
  } catch (e) {
    throw new AppError('CORRUPT_VIDEO', 'Video could not be read (corrupt or unsupported).', 422);
  }
}

/** True when native file is directly publishable — avoid re-encode. */
export function isPublishReady(meta: VideoMeta): boolean {
  return meta.vcodec === 'h264' && (meta.acodec === null || meta.acodec === 'aac');
}

/**
 * Transcode only when required. Lightweight preset for 2–4 GB VPS:
 * veryfast, crf 23, faststart. Returns output path (== input when no-op).
 */
export async function ensurePublishable(
  input: string,
  meta: VideoMeta,
  onProgress?: (pct: number) => void,
): Promise<{ path: string; transcoded: boolean }> {
  if (isPublishReady(meta)) return { path: input, transcoded: false };
  const out = `${input}.publish.mp4`;
  await new Promise<void>((resolve, reject) => {
    // Use spawn-free execFile with progress parsing disabled for simplicity;
    // report indeterminate progress via callback ticks.
    const timer = setInterval(() => onProgress?.(50), 1500);
    execFile(
      'ffmpeg',
      [
        '-y',
        '-i',
        input,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        '-threads',
        '2',
        out,
      ],
      (err) => {
        clearInterval(timer);
        if (err) reject(new AppError('FFMPEG_FAILED', 'Video processing failed.', 422));
        else {
          onProgress?.(100);
          resolve();
        }
      },
    );
  });
  if (!fs.existsSync(out)) throw new AppError('FFMPEG_FAILED', 'Video processing failed.', 422);
  return { path: out, transcoded: true };
}

export function extForMime(mime: string): string {
  if (mime === 'video/quicktime') return '.mov';
  if (mime === 'video/webm') return '.webm';
  return '.mp4';
}
