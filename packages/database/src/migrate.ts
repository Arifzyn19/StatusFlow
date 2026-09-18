/**
 * Explicit migration runner: `npm run db:migrate` from the repo root.
 * Applies the SQLite DDL (same `migrate()` that runs on API boot) and exits.
 *
 * Honors DATABASE_URL when set. When unset, the default `file:./data/...`
 * is anchored to the repo root (not the workspace cwd) so the DB lands in
 * the canonical `./data/statusflow.db` either way.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb, dbFilePath } from './sqlite.js';

if (!process.env.DATABASE_URL) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  process.env.DATABASE_URL = `file:${path.join(root, 'data', 'statusflow.db')}`;
}

getDb();
closeDb();
console.log(`Database migrated: ${dbFilePath()}`);
