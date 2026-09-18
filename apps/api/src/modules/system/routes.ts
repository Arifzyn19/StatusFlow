import type { FastifyInstance } from 'fastify';
import os from 'node:os';
import fs from 'node:fs';
import { z } from 'zod';
import { config } from '@statusflow/config';
import { accountRepo, uploadRepo, settingsRepo } from '@statusflow/database';
import { parseOr400 } from '../../utils/validate.js';

const settingsSchema = z.object({
  maxUploadSizeMB: z.number().int().min(1).max(2048).optional(),
  maxVideoDurationSeconds: z.number().int().min(5).max(600).optional(),
  maxConcurrentUploads: z.number().int().min(1).max(8).optional(),
  maxConcurrentFfmpeg: z.number().int().min(1).max(4).optional(),
});

export async function systemRoutes(app: FastifyInstance) {
  app.get('/api/system/health', async () => ({
    ok: true,
    version: '1.0.0',
    uptime: process.uptime(),
    time: new Date().toISOString(),
  }));

  app.get('/api/system/stats', async () => {
    const accounts = accountRepo.list();
    const byStatus = accountRepo.countByStatus();
    const uploads = uploadRepo.stats();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    let diskFree: number | null = null;
    try {
      const st = fs.statfsSync(config.tempDir);
      diskFree = st.bavail * st.bsize;
    } catch {
      try {
        const st = fs.statfsSync(process.cwd());
        diskFree = st.bavail * st.bsize;
      } catch {
        diskFree = null;
      }
    }
    return {
      accounts: {
        total: accounts.length,
        connected: byStatus.CONNECTED ?? 0,
        disconnected: (byStatus.DISCONNECTED ?? 0) + (byStatus.LOGGED_OUT ?? 0),
        byStatus,
      },
      uploads,
      recent: uploadRepo.recent(8).map((u) => ({
        id: u.id,
        accountId: u.account_id,
        originalFilename: u.original_filename,
        status: u.status,
        createdAt: u.created_at,
      })),
      system: {
        loadAvg: os.loadavg(),
        totalMem,
        freeMem,
        usedMem: totalMem - freeMem,
        diskFree,
        cpuCount: os.cpus().length,
      },
      limits: {
        maxUploadSizeMB: config.maxUploadSizeMB,
        maxVideoDurationSeconds: config.maxVideoDurationSeconds,
        maxConcurrentUploads: config.maxConcurrentUploads,
        maxConcurrentFfmpeg: config.maxConcurrentFfmpeg,
        allowedVideoMime: config.allowedVideoMime,
      },
    };
  });

  app.get('/api/system/settings', async () => ({
    ...{
      maxUploadSizeMB: config.maxUploadSizeMB,
      maxVideoDurationSeconds: config.maxVideoDurationSeconds,
      maxConcurrentUploads: config.maxConcurrentUploads,
      maxConcurrentFfmpeg: config.maxConcurrentFfmpeg,
    },
    ...Object.fromEntries(
      Object.entries(settingsRepo.all()).map(([k, v]) => {
        const n = Number(v);
        return [k, Number.isFinite(n) && v.trim() !== '' ? n : v];
      }),
    ),
    allowedVideoMime: config.allowedVideoMime,
    version: '1.0.0',
  }));

  app.put('/api/system/settings', async (req) => {
    const body = parseOr400(settingsSchema, req.body);
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) settingsRepo.set(k, String(v));
    }
    return { ok: true };
  });
}
