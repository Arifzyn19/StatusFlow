import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import { config } from '@statusflow/config';

export interface SessionUser {
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export function signSession(email: string): string {
  return jwt.sign({ email }, config.jwtSecret, { expiresIn: '7d' });
}

export default fp(async function auth(app: FastifyInstance) {
  app.decorateRequest('user', undefined);
  app.addHook('preHandler', async (req, reply) => {
    // Public paths skip auth
    const url = req.url.split('?')[0];
    if (
      url === '/api/auth/login' ||
      url === '/api/auth/setup' ||
      url === '/api/system/health' ||
      url === '/api/events'
    )
      return;
    if (url.startsWith('/api/')) {
      const token = req.cookies[config.cookieName];
      if (!token) {
        return reply.code(401).send({ error: 'Not authenticated', code: 'UNAUTHORIZED' });
      }
      // SSE authenticates via query token (EventSource can't set cookies cross-site reliably)
      try {
        const payload = jwt.verify(token, config.jwtSecret) as { email: string };
        req.user = { email: payload.email };
      } catch {
        return reply.code(401).send({ error: 'Session expired', code: 'SESSION_EXPIRED' });
      }
    }
  });
});
