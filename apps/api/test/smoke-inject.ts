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

  console.log('smoke-inject: ALL CHECKS PASSED');
} finally {
  await app.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
