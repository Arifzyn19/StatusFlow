/**
 * Inject-based API smoke test (runs via tsx, NOT vitest — vitest 2's Vite
 * cannot resolve node:sqlite). No network, no real WhatsApp account.
 * Usage: node ../../node_modules/tsx/dist/cli.mjs test/smoke-inject.ts
 */
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-inject-'));
process.env.DATABASE_URL = `file:${path.join(tmp, 'test.db')}`;
process.env.SESSION_DIRECTORY = path.join(tmp, 'sessions');
process.env.TEMP_UPLOAD_DIRECTORY = path.join(tmp, 'temp');
process.env.JWT_SECRET = 'inject-test-secret-32chars-minimum!!';
process.env.CORS_ORIGIN = 'http://localhost:3000';

const { buildApp } = await import('../src/app.js');
const { accountRepo, uploadRepo, contactRepo } = await import('@statusflow/database');
const app = await buildApp();

try {
  // 1. health is public
  let r = await app.inject({ method: 'GET', url: '/api/system/health' });
  assert.equal(r.statusCode, 200, 'health');
  assert.equal(r.json().ok, true);

  // 2. invalid login body → 400 VALIDATION_ERROR (never 500)
  r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'not-an-email', password: 'x' },
  });
  assert.equal(r.statusCode, 400, `invalid login status (got ${r.statusCode}: ${r.body})`);
  assert.equal(r.json().code, 'VALIDATION_ERROR');

  // 3. protected routes → 401 without session
  r = await app.inject({ method: 'GET', url: '/api/accounts' });
  assert.equal(r.statusCode, 401);
  assert.equal(r.json().code, 'UNAUTHORIZED');

  // 4. setup → login → authed request works; bad query → 400
  r = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { email: 'admin@test.local', password: 'Password123!' },
  });
  assert.ok([200, 403].includes(r.statusCode), 'setup');

  r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@test.local', password: 'Password123!' },
  });
  assert.equal(r.statusCode, 200, `login: ${r.body}`);
  const cookie = r.headers['set-cookie'];
  assert.ok(cookie, 'session cookie set');
  const jar = Array.isArray(cookie) ? cookie.join('; ') : String(cookie);

  r = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie: jar } });
  assert.equal(r.statusCode, 200, `accounts: ${r.body}`);
  assert.ok(Array.isArray(r.json()), 'accounts array');

  // 4b. create → delete round-trip (delete must never hang or 500, even
  // while the socket is mid-handshake)
  r = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: { cookie: jar },
    payload: { name: 'smoke-temp' },
  });
  assert.equal(r.statusCode, 201, `create account: ${r.body}`);
  const tempId = (r.json() as { id: string }).id;
  assert.ok(tempId, 'new account id');
  r = await app.inject({ method: 'DELETE', url: `/api/accounts/${tempId}`, headers: { cookie: jar } });
  assert.equal(r.statusCode, 200, `delete account: ${r.body}`);
  assert.equal((r.json() as { ok: boolean }).ok, true);
  r = await app.inject({ method: 'GET', url: '/api/accounts', headers: { cookie: jar } });
  assert.ok(!(r.json() as { id: string }[]).some((a) => a.id === tempId), 'account gone');

  r = await app.inject({
    method: 'GET',
    url: '/api/uploads?page=notanumber',
    headers: { cookie: jar },
  });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().code, 'VALIDATION_ERROR');

  // 5. wrong password → 401 INVALID_CREDENTIALS (no user enumeration)
  r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'admin@test.local', password: 'WrongPass999!' },
  });
  assert.equal(r.statusCode, 401);
  assert.equal(r.json().code, 'INVALID_CREDENTIALS');

  // 6. empty JSON body → 400 BAD_REQUEST (never 500)
  r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(r.statusCode, 400, `empty body status (got ${r.statusCode}: ${r.body})`);
  assert.equal(r.json().code, 'BAD_REQUEST');

  // 7. crash recovery: orphaned mid-pipeline rows become retriable FAILEDs
  const tempAcc = accountRepo.create('smoke-recovery', 'smoke-session-ref');
  const orphan = uploadRepo.create({
    accountId: tempAcc.id,
    filename: 'orphan.mp4',
    mime: 'video/mp4',
    size: 123,
  });
  uploadRepo.update(orphan.id, { status: 'PROCESSING' } as never);
  const done = uploadRepo.create({
    accountId: tempAcc.id,
    filename: 'done.mp4',
    mime: 'video/mp4',
    size: 456,
  });
  uploadRepo.update(done.id, { status: 'SUCCESS' } as never);
  assert.equal(uploadRepo.markInterrupted(), 1, 'exactly one orphan recovered');
  const recovered = uploadRepo.get(orphan.id)!;
  assert.equal(recovered.status, 'FAILED');
  assert.equal(recovered.error_code, 'INTERRUPTED');
  assert.equal(uploadRepo.get(done.id)!.status, 'SUCCESS', 'finished rows untouched');

  // 8. contact audience store round-trip
  contactRepo.upsert(tempAcc.id, ['6281@s.whatsapp.net', '123@lid', '6281@s.whatsapp.net']);
  contactRepo.upsert(tempAcc.id, []);
  assert.deepEqual(contactRepo.list(tempAcc.id).sort(), ['123@lid', '6281@s.whatsapp.net']);
  assert.equal(contactRepo.count(tempAcc.id), 2);
  contactRepo.clear(tempAcc.id);
  assert.equal(contactRepo.count(tempAcc.id), 0);

  console.log('smoke-inject: ALL CHECKS PASSED');
} finally {
  await app.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
