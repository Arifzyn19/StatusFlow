/** Repository layer — swap for Postgres without touching services. */
import { getDb, uuid, type AccountRow, type UploadRow } from './sqlite.js';

function toIso(v: string | null): string | null {
  if (!v) return null;
  return v.includes('T') ? v : v.replace(' ', 'T') + 'Z';
}

export const adminRepo = {
  findByEmail(email: string) {
    return (
      getDb()
        .prepare('SELECT * FROM admin_users WHERE email = ?')
        .get(email) as
        | { id: string; email: string; password_hash: string }
        | undefined
    );
  },
  count(): number {
    const r = getDb().prepare('SELECT COUNT(*) c FROM admin_users').get() as {
      c: number;
    };
    return r.c;
  },
  create(email: string, passwordHash: string) {
    const id = uuid();
    getDb()
      .prepare('INSERT INTO admin_users (id, email, password_hash) VALUES (?,?,?)')
      .run(id, email, passwordHash);
    return { id, email };
  },
  updatePassword(email: string, hash: string) {
    getDb()
      .prepare(
        "UPDATE admin_users SET password_hash=?, updated_at=datetime('now') WHERE email=?",
      )
      .run(hash, email);
  },
};

export const accountRepo = {
  list(): AccountRow[] {
    return getDb()
      .prepare('SELECT * FROM whatsapp_accounts ORDER BY created_at DESC')
      .all() as unknown as AccountRow[];
  },
  get(id: string): AccountRow | undefined {
    return getDb()
      .prepare('SELECT * FROM whatsapp_accounts WHERE id=?')
      .get(id) as unknown as AccountRow | undefined;
  },
  create(name: string, sessionReference: string): AccountRow {
    const id = uuid();
    getDb()
      .prepare(
        "INSERT INTO whatsapp_accounts (id,name,status,session_reference) VALUES (?,?, 'CONNECTING', ?)",
      )
      .run(id, name, sessionReference);
    return this.get(id)!;
  },
  update(id: string, patch: Partial<AccountRow>): void {
    const cur = this.get(id);
    if (!cur) return;
    // node:sqlite cannot bind `undefined` — drop such keys so partial
    // patches (e.g. { status }) never clobber columns with undefined.
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const next = { ...cur, ...clean, id };
    getDb()
      .prepare(
        `UPDATE whatsapp_accounts SET name=?, phone_number=?, status=?, session_reference=?,
         last_connected_at=?, updated_at=datetime('now') WHERE id=?`,
      )
      .run(
        next.name,
        next.phone_number,
        next.status,
        next.session_reference,
        next.last_connected_at,
        id,
      );
  },
  remove(id: string): void {
    getDb().prepare('DELETE FROM whatsapp_accounts WHERE id=?').run(id);
  },
  countByStatus(): Record<string, number> {
    const rows = getDb()
      .prepare('SELECT status, COUNT(*) c FROM whatsapp_accounts GROUP BY status')
      .all() as { status: string; c: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r.c;
    return out;
  },
};

export const uploadRepo = {
  list(opts: {
    accountId?: string;
    status?: string;
    search?: string;
    page: number;
    pageSize: number;
  }): { rows: UploadRow[]; total: number } {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (opts.accountId) {
      conds.push('u.account_id = ?');
      params.push(opts.accountId);
    }
    if (opts.status) {
      conds.push('u.status = ?');
      params.push(opts.status);
    }
    if (opts.search) {
      conds.push('u.original_filename LIKE ?');
      params.push(`%${opts.search}%`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = (
      getDb().prepare(`SELECT COUNT(*) c FROM uploads u ${where}`).get(...(params as never[])) as {
        c: number;
      }
    ).c;
    const rows = getDb()
      .prepare(
        `SELECT u.* FROM uploads u ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...(params as never[]), opts.pageSize, (opts.page - 1) * opts.pageSize) as unknown as UploadRow[];
    return { rows, total };
  },
  recent(limit = 8): UploadRow[] {
    return getDb()
      .prepare('SELECT * FROM uploads ORDER BY created_at DESC LIMIT ?')
      .all(limit) as unknown as UploadRow[];
  },
  get(id: string): UploadRow | undefined {
    return getDb().prepare('SELECT * FROM uploads WHERE id=?').get(id) as unknown as
      | UploadRow
      | undefined;
  },
  create(r: {
    accountId: string;
    filename: string;
    mime: string;
    size: number;
  }): UploadRow {
    const id = uuid();
    getDb()
      .prepare(
        `INSERT INTO uploads (id, account_id, original_filename, mime_type, file_size, status, started_at)
         VALUES (?,?,?,?,?,'QUEUED',datetime('now'))`,
      )
      .run(id, r.accountId, r.filename, r.mime, r.size);
    return this.get(id)!;
  },
  update(id: string, patch: Partial<UploadRow>): void {
    const cur = this.get(id);
    if (!cur) return;
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const n = { ...cur, ...clean, id };
    getDb()
      .prepare(
        `UPDATE uploads SET status=?, error_message=?, error_code=?, duration=?,
         width=?, height=?, started_at=?, completed_at=?, audience=?, delivered=? WHERE id=?`,
      )
      .run(
        n.status,
        n.error_message,
        n.error_code,
        n.duration,
        n.width,
        n.height,
        n.started_at,
        n.completed_at,
        n.audience,
        n.delivered,
        id,
      );
  },
  remove(id: string): void {
    getDb().prepare('DELETE FROM uploads WHERE id=?').run(id);
  },
  /**
   * Crash/restart recovery: any upload left mid-pipeline by a previous run
   * can never complete (its temp files and ffmpeg are gone) — mark it
   * FAILED so the user gets a clear retry signal instead of a stuck row.
   */
  markInterrupted(): number {
    const r = getDb()
      .prepare(
        `UPDATE uploads SET status='FAILED',
         error_message='Server restarted during upload. Please retry.',
         error_code='INTERRUPTED',
         completed_at=datetime('now')
         WHERE status IN ('QUEUED','VALIDATING','PROCESSING','PUBLISHING')`,
      )
      .run();
    return Number((r as { changes: number }).changes ?? 0);
  },
  stats(): { total: number; success: number; failed: number } {
    const rows = getDb()
      .prepare('SELECT status, COUNT(*) c FROM uploads GROUP BY status')
      .all() as { status: string; c: number }[];
    let total = 0,
      success = 0,
      failed = 0;
    for (const r of rows) {
      total += r.c;
      if (r.status === 'SUCCESS') success += r.c;
      if (r.status === 'FAILED') failed += r.c;
    }
    return { total, success, failed };
  },
};

/** Synced contact JIDs per account — the Status audience (statusJidList). */
export const contactRepo = {
  upsert(accountId: string, jids: string[]): void {
    if (!jids.length) return;
    const stmt = getDb().prepare(
      `INSERT OR IGNORE INTO account_contacts (account_id, jid) VALUES (?,?)`,
    );
    for (const j of jids.slice(0, 3000)) {
      try {
        stmt.run(accountId, j);
      } catch {
        /* ignore single bad rows */
      }
    }
  },
  list(accountId: string): string[] {
    return (
      getDb()
        .prepare('SELECT jid FROM account_contacts WHERE account_id=?')
        .all(accountId) as unknown as { jid: string }[]
    ).map((r) => r.jid);
  },
  count(accountId: string): number {
    const r = getDb()
      .prepare('SELECT COUNT(*) c FROM account_contacts WHERE account_id=?')
      .get(accountId) as unknown as { c: number };
    return r.c;
  },
  clear(accountId: string): void {
    getDb().prepare('DELETE FROM account_contacts WHERE account_id=?').run(accountId);
  },
};

export const settingsRepo = {  get(key: string, fallback = ''): string {
    const r = getDb().prepare('SELECT value FROM system_settings WHERE key=?').get(key) as
      | { value: string }
      | undefined;
    return r?.value ?? fallback;
  },
  set(key: string, value: string): void {
    getDb()
      .prepare(
        `INSERT INTO system_settings (id, key, value, updated_at) VALUES (?,?,?,datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
      )
      .run(uuid(), key, value);
  },
  all(): Record<string, string> {
    const rows = getDb().prepare('SELECT key, value FROM system_settings').all() as {
      key: string;
      value: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
};

export { toIso };
