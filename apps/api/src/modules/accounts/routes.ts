import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { accountRepo, toIso } from '@statusflow/database';
import {
  connectAccount,
  disconnectAccount,
  logoutAccount,
  getQr,
  getStatus,
  requestPairingCode,
} from '../whatsapp/service.js';
import { bus } from '../../utils/events.js';
import { parseOr400 } from '../../utils/validate.js';

const pairingSchema = z.object({
  // E.164 without '+': country code + number, 8–15 digits total
  phone: z.string().regex(/^[1-9]\d{7,14}$/, 'Use international format without + or spaces, e.g. 201012345678'),
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
});

function dto(a: ReturnType<typeof accountRepo.get> & object) {
  const r = a as {
    id: string;
    name: string;
    phone_number: string | null;
    status: string;
    last_connected_at: string | null;
    created_at: string;
    updated_at: string;
  };
  return {
    id: r.id,
    name: r.name,
    phoneNumber: r.phone_number,
    status: r.status,
    lastConnectedAt: toIso(r.last_connected_at),
    createdAt: toIso(r.created_at) ?? r.created_at,
    updatedAt: toIso(r.updated_at) ?? r.updated_at,
  };
}

export async function accountRoutes(app: FastifyInstance) {
  app.get('/api/accounts', async () => {
    return accountRepo.list().map(dto);
  });

  app.post('/api/accounts', async (req, reply) => {
    const body = parseOr400(createSchema, req.body);
    // Avoid duplicates: cap total sessions for small VPS
    if (accountRepo.list().length >= 10) {
      return reply.code(400).send({ error: 'Account limit reached (10)', code: 'ACCOUNT_LIMIT' });
    }
    const sessionReference = crypto.randomUUID();
    const acc = accountRepo.create(body.name.trim(), sessionReference);
    bus.emit('account.status', { accountId: acc.id, status: 'CONNECTING' });
    // Fire-and-forget connect (SSE carries QR/status)
    connectAccount(acc.id).catch((e) => {
      app.log.error({ err: e, accountId: acc.id }, 'connect failed');
    });
    return reply.code(201).send(dto(acc));
  });

  app.get('/api/accounts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const acc = accountRepo.get(id);
    if (!acc) return reply.code(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
    return dto(acc);
  });

  app.get('/api/accounts/:id/qr', async (req, reply) => {
    const { id } = req.params as { id: string };
    const acc = accountRepo.get(id);
    if (!acc) return reply.code(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
    const qr = getQr(id);
    return {
      status: getStatus(id),
      qr: qr?.qr ?? null,
      qrDataUrl: qr?.qrDataUrl ?? null,
      stale: qr?.stale ?? false,
      qrAt: qr?.qrAt ?? null,
      reason: qr?.reason ?? null,
    };
  });

  app.post('/api/accounts/:id/pairing', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!accountRepo.get(id))
      return reply.code(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
    const body = parseOr400(pairingSchema, req.body);
    try {
      const code = await requestPairingCode(id, body.phone);
      return { code };
    } catch (e) {
      const err = e as { code?: string; statusCode?: number; message?: string };
      return reply
        .code(err.statusCode ?? 502)
        .send({ error: err.message ?? 'Pairing failed', code: err.code ?? 'PAIRING_FAILED' });
    }
  });

  app.post('/api/accounts/:id/reconnect', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!accountRepo.get(id))
      return reply.code(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
    await disconnectAccount(id).catch(() => {});
    connectAccount(id).catch((e) => app.log.error({ err: e }, 'reconnect failed'));
    return { ok: true, status: getStatus(id) };
  });

  app.post('/api/accounts/:id/logout', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!accountRepo.get(id))
      return reply.code(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
    await logoutAccount(id);
    return { ok: true };
  });

  app.delete('/api/accounts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!accountRepo.get(id))
      return reply.code(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
    await disconnectAccount(id).catch(() => {});
    // Remove session files on delete
    await logoutAccount(id).catch(() => {});
    accountRepo.remove(id);
    bus.emit('account.removed', { accountId: id });
    return { ok: true };
  });
}
