/**
 * SQLite data layer built on Node 22+ `node:sqlite` (DatabaseSync).
 * Zero native dependencies — ideal for small VPS and Termux/Android.
 *
 * Repository pattern: every query goes through these functions so a
 * future PostgreSQL adapter (pg + Drizzle/Prisma) can replace sqlite.ts
 * without touching service code.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let db: DatabaseSync | null = null;

export function dbFilePath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/statusflow.db';
  const p = url.startsWith('file:') ? url.slice(5) : url;
  return path.resolve(process.cwd(), p);
}

export function getDb(): DatabaseSync {
  if (db) return db;
  const file = dbFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function closeDb(): void {
  try {
    db?.close();
  } catch {
    /* noop */
  }
  db = null;
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS whatsapp_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone_number TEXT,
      status TEXT NOT NULL DEFAULT 'DISCONNECTED',
      session_reference TEXT UNIQUE NOT NULL,
      last_connected_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_accounts_status ON whatsapp_accounts(status);
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      duration REAL,
      width INTEGER,
      height INTEGER,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      error_message TEXT,
      error_code TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_uploads_account ON uploads(account_id);
    CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
    CREATE INDEX IF NOT EXISTS idx_uploads_created ON uploads(created_at);
    CREATE TABLE IF NOT EXISTS system_settings (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS account_contacts (
      account_id TEXT NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
      jid TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, jid)
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_account ON account_contacts(account_id);
  `);
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// ---- row mappers ----
export interface AccountRow {
  id: string;
  name: string;
  phone_number: string | null;
  status: string;
  session_reference: string;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadRow {
  id: string;
  account_id: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  status: string;
  error_message: string | null;
  error_code: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}
