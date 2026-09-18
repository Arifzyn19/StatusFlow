import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '@statusflow/config';
import { bus } from '../utils/events.js';

/**
 * Server-Sent Events fan-out for: account.status, account.qr,
 * upload.progress, upload.status. Nginx-friendly (no WS upgrade).
 */
export async function eventsRoutes(app: FastifyInstance) {
  app.get('/api/events', async (req, reply) => {
    // Auth: cookie or ?token=
    const q = req.query as { token?: string };
    const token = req.cookies[config.cookieName] ?? q.token;
    if (!token) {
      return reply.code(401).send({ error: 'Not authenticated', code: 'UNAUTHORIZED' });
    }
    try {
      jwt.verify(token, config.jwtSecret);
    } catch {
      return reply.code(401).send({ error: 'Session expired', code: 'SESSION_EXPIRED' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`: connected\n\n`);

    const off = bus.onAll((evt) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);
      } catch {
        /* client gone */
      }
    });

    const keep = setInterval(() => {
      try {
        reply.raw.write(`: ping\n\n`);
      } catch {
        /* ignore */
      }
    }, 25_000);

    req.raw.on('close', () => {
      clearInterval(keep);
      off();
    });
    return reply;
  });
}
