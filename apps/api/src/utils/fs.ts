import fs from 'node:fs';
import path from 'node:path';

/** Ensure a directory exists with restricted permissions (700). */
export function ensureSecureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* Windows / some FS ignore chmod */
  }
}

/** Guard against path traversal; returns basename. */
export function safeFilename(name: string): string {
  return path.basename(name).replace(/[^\w.\-() ]/g, '_').slice(0, 180) || 'video.mp4';
}

/** Best-effort unlink. */
export async function rmQuiet(p: string): Promise<void> {
  try {
    await fs.promises.unlink(p);
  } catch {
    /* already gone */
  }
}

/** Remove files older than maxAgeMs in dir (temp cleanup). */
export async function sweepOldFiles(dir: string, maxAgeMs: number): Promise<number> {
  let removed = 0;
  try {
    const entries = await fs.promises.readdir(dir);
    const now = Date.now();
    for (const e of entries) {
      const p = path.join(dir, e);
      try {
        const st = await fs.promises.stat(p);
        if (now - st.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(p);
          removed += 1;
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* dir missing */
  }
  return removed;
}
