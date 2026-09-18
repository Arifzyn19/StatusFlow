import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { config } from '@statusflow/config';
import { toApiError } from './utils/errors.js';
import { ensureSecureDir, sweepOldFiles } from './utils/fs.js';
import auth from './plugins/auth.js';
import { eventsRoutes } from './plugins/events.js';
import { authRoutes } from './modules/auth/routes.js';
import { accountRoutes } from './modules/accounts/routes.js';
import { uploadRoutes } from './modules/uploads/routes.js';
import { registerHistoryRoutes } from './modules/history/routes.js';
import { systemRoutes } from './modules/system/routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: (config.maxUploadSizeMB + 10) * 1024 * 1024,
    trustProxy: true,
  });

  // NOTE: must precede all register() calls — Fastify snapshots the error
  // handler into each encapsulated context at creation time.
  app.setErrorHandler((err, _req, reply) => {
    try {
      if ((err as { name?: string })?.name === 'ZodError') {
        return reply.code(400).send({ error: 'Invalid request', code: 'VALIDATION_ERROR' });
      }
      const mapped = toApiError(err, config.isProd);
      app.log.error({ err }, 'request failed');
      return reply.code(mapped.status).send(mapped.body);
    } catch {
      return reply.code(500).send({ error: 'Internal error', code: 'INTERNAL' });
    }
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(cors, {
    origin: config.corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadSizeMB * 1024 * 1024,
      files: 1,
    },
  });

  // Tight login brute-force protection
  await app.register(async (inst) => {
    inst.addHook('preHandler', async (req, reply) => {
      void reply;
      void req;
    });
  });

  await app.register(auth);
  await app.register(eventsRoutes);
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(uploadRoutes);
  await app.register(registerHistoryRoutes);
  await app.register(systemRoutes);

  // Hourly temp sweep (unref'd so it never blocks shutdown)
  const sweep = setInterval(() => {
    sweepOldFiles(config.tempDir, 6 * 3600 * 1000).catch(() => {});
  }, 3600_1000);
  sweep.unref?.();

  ensureSecureDir(config.sessionDir);
  ensureSecureDir(config.tempDir);

  return app;
}
