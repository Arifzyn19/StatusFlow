#!/usr/bin/env node
/** First-run helper: copies .env.example, creates data dirs with safe perms. */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ex = path.join(root, '.env.example');
const env = path.join(root, '.env');
if (!fs.existsSync(env) && fs.existsSync(ex)) {
  fs.copyFileSync(ex, env);
  console.log('Created .env from .env.example — edit secrets before starting.');
} else {
  console.log('.env already exists, leaving it untouched.');
}
for (const d of ['data/sessions', 'data/temp', 'logs']) {
  const p = path.join(root, d);
  fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(p, 0o700); } catch {}
  console.log('Ensured', d, '(700)');
}
console.log('Done. Next: npm install && npm run build && pm2 start deploy/ecosystem.config.js');
