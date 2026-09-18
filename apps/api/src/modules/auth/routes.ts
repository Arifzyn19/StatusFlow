import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '@statusflow/config';
import { adminRepo } from '@statusflow/database';
import { signSession } from '../../plugins/auth.js';
import { parseOr400 } from '../../utils/validate.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const setupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.cookieSecure,
    path: '/',
    maxAge: 7 * 24 * 3600,
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/me', async (req) => {
    return { email: req.user!.email };
  });

  // First-run setup: only when no admin exists
  app.post('/api/auth/setup', async (req, reply) => {
    if (adminRepo.count() > 0) {
      return reply.code(403).send({ error: 'Setup already completed', code: 'SETUP_DONE' });
    }
    const body = parseOr400(setupSchema, req.body);
    const hash = await bcrypt.hash(body.password, 12);
    adminRepo.create(body.email.toLowerCase(), hash);
    const token = signSession(body.email.toLowerCase());
    return reply.setCookie(config.cookieName, token, cookieOpts()).send({ email: body.email });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parseOr400(loginSchema, req.body);
    const admin = adminRepo.findByEmail(body.email.toLowerCase());
    if (!admin || !(await bcrypt.compare(body.password, admin.password_hash))) {
      return reply.code(401).send({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }
    const token = signSession(admin.email);
    return reply.setCookie(config.cookieName, token, cookieOpts()).send({ email: admin.email });
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    return reply.clearCookie(config.cookieName, { path: '/' }).send({ ok: true });
  });

  app.post('/api/auth/change-password', async (req, reply) => {
    const body = parseOr400(passwordSchema, req.body);
    const admin = adminRepo.findByEmail(req.user!.email);
    if (!admin || !(await bcrypt.compare(body.currentPassword, admin.password_hash))) {
      return reply.code(400).send({ error: 'Current password is incorrect', code: 'BAD_PASSWORD' });
    }
    adminRepo.updatePassword(req.user!.email, await bcrypt.hash(body.newPassword, 12));
    return { ok: true };
  });
}
