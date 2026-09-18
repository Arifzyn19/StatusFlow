/**
 * WhatsAppModule — Baileys isolated behind a provider interface.
 *
 * STABLE provider: @whiskeysockets/baileys 6.7.24 (legacy dist-tag).
 * EXPERIMENTAL: Baileys v7 RC — kept separate (see docs/architecture.md);
 * do NOT mix v7 sessions into the stable store without migration.
 *
 * Responsibilities: init sessions, QR, status monitoring, exponential-backoff
 * reconnect, status publishing, graceful close, secure credential persistence.
 */
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers,
  type WASocket,
} from '@whiskeysockets/baileys';
import { config } from '@statusflow/config';
import { accountRepo } from '@statusflow/database';
import { bus } from '../../utils/events.js';
import { ensureSecureDir } from '../../utils/fs.js';

export type WaStatus =
  | 'CONNECTING'
  | 'QR_REQUIRED'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'LOGGED_OUT'
  | 'ERROR';

interface Session {
  id: string; // account id
  sock: WASocket | null;
  qr: string | null;
  qrDataUrl: string | null;
  qrAt: number | null;
  pairingCode: string | null;
  lastReasonCode: number | null;
  lastReason: string | null;
  status: WaStatus;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
  connecting: Promise<void> | null;
}

const sessions = new Map<string, Session>();
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/** Human-readable reason for a Baileys disconnect code (shown in UI + logs). */
export function disconnectReasonText(code: number | undefined): string {
  switch (code) {
    case DisconnectReason.timedOut: // 408
      return 'Timed out — the QR code expired before it was scanned. A fresh code is on its way.';
    case DisconnectReason.loggedOut: // 401
      return 'Logged out from WhatsApp. Re-add the account to reconnect.';
    case 440: // connectionReplaced
      return 'Connection replaced — this session was opened elsewhere. Reconnect here to take over.';
    case DisconnectReason.multideviceMismatch: // 411
      return 'Device mismatch — remove the linked device in WhatsApp and scan again.';
    case DisconnectReason.restartRequired: // 515
      return 'WhatsApp asked for a restart. Reconnecting automatically…';
    case DisconnectReason.badSession: // 500
      return 'Bad session — delete and re-add the account if this repeats.';
    case 405:
      return 'Protocol version rejected — update the Baileys dependency and retry.';
    case undefined:
      return 'Connection closed for an unknown reason. Reconnecting…';
    default:
      return `Connection closed (code ${code}). Reconnecting…`;
  }
}

function sessionDirFor(accountId: string): string {
  return path.join(config.sessionDir, accountId);
}

function backoff(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
}

function setStatus(
  accountId: string,
  status: WaStatus,
  extra?: { phone?: string | null; reasonCode?: number | null; reason?: string | null },
) {
  const s = sessions.get(accountId);
  if (s) {
    s.status = status;
    // Keep the last QR on screen across short reconnects (CONNECTING /
    // DISCONNECTED) so it doesn't flash in and out; the frontend marks it
    // stale until a fresh code arrives. Clear only on terminal states.
    if (status === 'CONNECTED' || status === 'LOGGED_OUT') {
      s.qr = null;
      s.qrDataUrl = null;
      s.qrAt = null;
      s.pairingCode = null;
    }
    if (extra?.reasonCode !== undefined) s.lastReasonCode = extra.reasonCode ?? null;
    if (extra?.reason !== undefined) s.lastReason = extra.reason ?? null;
    if (status === 'QR_REQUIRED') {
      s.lastReasonCode = null;
      s.lastReason = null;
    }
  }
  const patch: Record<string, string | null> = {
    status,
    phone_number: extra?.phone ?? accountRepo.get(accountId)?.phone_number ?? null,
  };
  if (status === 'CONNECTED') {
    patch.last_connected_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  accountRepo.update(accountId, patch as never);
  bus.emit('account.status', {
    accountId,
    status,
    phoneNumber: extra?.phone ?? null,
    reasonCode: s?.lastReasonCode ?? null,
    reason: s?.lastReason ?? null,
  });
}

function getSession(accountId: string): Session {
  let s = sessions.get(accountId);
  if (!s) {
    s = {
      id: accountId,
      sock: null,
      qr: null,
      qrDataUrl: null,
      qrAt: null,
      pairingCode: null,
      lastReasonCode: null,
      lastReason: null,
      status: 'DISCONNECTED',
      reconnectAttempts: 0,
      reconnectTimer: null,
      connecting: null,
    };
    sessions.set(accountId, s);
  }
  return s;
}

/** Initialize (or re-initialize) a Baileys connection. Idempotent. */
export function connectAccount(accountId: string): Promise<void> {
  const s = getSession(accountId);
  if (s.connecting) return s.connecting;
  if (s.sock && s.status === 'CONNECTED') return Promise.resolve();

  setStatus(accountId, 'CONNECTING');
  s.connecting = (async () => {
    ensureSecureDir(config.sessionDir);
    const dir = sessionDirFor(accountId);
    ensureSecureDir(dir);
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 0] as [number, number, number] }));

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    s.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        s.qr = qr;
        s.qrDataUrl = await QRCode.toDataURL(qr).catch(() => null);
        s.qrAt = Date.now();
        setStatus(accountId, 'QR_REQUIRED');
        bus.emit('account.qr', { accountId, qr, qrDataUrl: s.qrDataUrl });
      }
      if (connection === 'open') {
        s.reconnectAttempts = 0;
        const phone = sock.user?.id?.split(':')[0] ?? sock.user?.id?.split('@')[0] ?? null;
        setStatus(accountId, 'CONNECTED', { phone });
      }
      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const reason = disconnectReasonText(code);
        log.warn({ accountId, code, reason }, 'whatsapp connection closed');
        if (code === DisconnectReason.loggedOut) {
          try {
            fs.rmSync(dir, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
          try {
            await useMultiFileAuthState(dir);
          } catch {
            /* ignore */
          }
          setStatus(accountId, 'LOGGED_OUT');
          s.sock = null;
          return;
        }
        setStatus(accountId, 'DISCONNECTED', { reasonCode: code ?? null, reason });
        s.sock = null;
        scheduleReconnect(accountId);
      }
    });
  })().finally(() => {
    s.connecting = null;
  });
  return s.connecting;
}

function scheduleReconnect(accountId: string): void {
  const s = getSession(accountId);
  if (s.reconnectTimer) return;
  const delay = backoff(s.reconnectAttempts++);
  if (s.reconnectAttempts > 10) {
    setStatus(accountId, 'ERROR');
    return; // no infinite loops
  }
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null;
    connectAccount(accountId).catch(() => {
      setStatus(accountId, 'ERROR');
    });
  }, delay);
  s.reconnectTimer.unref?.();
}

export async function disconnectAccount(accountId: string): Promise<void> {
  const s = sessions.get(accountId);
  if (s?.reconnectTimer) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }
  try {
    await s?.sock?.ws?.close();
  } catch {
    /* ignore */
  }
  try {
    await s?.sock?.end?.(undefined);
  } catch {
    /* ignore */
  }
  if (s) s.sock = null;
  setStatus(accountId, 'DISCONNECTED');
}

export async function logoutAccount(accountId: string): Promise<void> {
  const s = sessions.get(accountId);
  try {
    await s?.sock?.logout();
  } catch {
    /* already logged out */
  }
  if (s?.reconnectTimer) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }
  try {
    fs.rmSync(sessionDirFor(accountId), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  if (s) {
    s.sock = null;
    s.qr = null;
    s.qrDataUrl = null;
  }
  setStatus(accountId, 'LOGGED_OUT');
}

export function getQr(accountId: string): {
  qr: string;
  qrDataUrl: string | null;
  status: WaStatus;
  stale: boolean;
  qrAt: number | null;
  reason: string | null;
} | null {
  const s = sessions.get(accountId);
  if (!s || !s.qr) return null;
  return {
    qr: s.qr,
    qrDataUrl: s.qrDataUrl,
    status: s.status,
    stale: s.status !== 'QR_REQUIRED',
    qrAt: s.qrAt,
    reason: s.lastReason,
  };
}

export function getStatus(accountId: string): WaStatus {
  return sessions.get(accountId)?.status ?? 'DISCONNECTED';
}

/**
 * Link via 8-character pairing code instead of QR.
 * `phone` must be E.164 without '+' (e.g. '201012345678').
 * NOTE: a wrong number taints the session — delete and re-add the account
 * if the code never works.
 */
export async function requestPairingCode(accountId: string, phone: string): Promise<string> {
  const s = getSession(accountId);
  if (s.status === 'CONNECTED') {
    throw Object.assign(new Error('Account is already connected.'), {
      code: 'ALREADY_CONNECTED',
      statusCode: 409,
    });
  }
  if (!s.sock) {
    await connectAccount(accountId);
    // Wait for the socket to exist (handshake in progress is fine —
    // requestPairingCode is designed to be called while connecting).
    const deadline = Date.now() + 15_000;
    while (!s.sock && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!s.sock) {
    throw Object.assign(new Error('Could not open a WhatsApp connection. Retry shortly.'), {
      code: 'CONNECTION_FAILED',
      statusCode: 502,
    });
  }
  try {
    setTimeout(async () => { 
    const code = await s.sock.requestPairingCode(phone);
    s.pairingCode = code;
    bus.emit('account.pairing', { accountId, code });
    return code;
    }, 3000)
  } catch (e) {
    log.warn({ err: e, accountId }, 'pairing code request failed');
    throw Object.assign(
      new Error('WhatsApp rejected the pairing request. Check the number and retry.'),
      { code: 'PAIRING_FAILED', statusCode: 502 },
    );
  }
}

export function getPairingCode(accountId: string): string | null {
  return sessions.get(accountId)?.pairingCode ?? null;
}

/**
 * Publish a video file to the account's WhatsApp Status.
 * Uses status@broadcast. Returns message id on confirmed send.
 */
export async function publishStatus(
  accountId: string,
  filePath: string,
  caption = '',
): Promise<{ messageId: string }> {
  const s = sessions.get(accountId);
  if (!s?.sock || s.status !== 'CONNECTED' || !s.sock.user) {
    throw Object.assign(new Error('Account is not connected.'), { code: 'ACCOUNT_NOT_CONNECTED' });
  }
  const data = await fs.promises.readFile(filePath);
  const res = await s.sock.sendMessage('status@broadcast', {
    video: data,
    caption: caption || undefined,
    mimetype: 'video/mp4',
  } as never);
  const id = (res as { key?: { id?: string } })?.key?.id;
  if (!id) throw Object.assign(new Error('WhatsApp did not confirm publishing.'), { code: 'PUBLISH_UNCONFIRMED' });
  return { messageId: id };
}

/** Restore all non-logged-out sessions after restart (isolated per account). */
export async function restoreSessions(): Promise<void> {
  const accounts = accountRepo.list().filter((a) => a.status !== 'LOGGED_OUT');
  for (const a of accounts) {
    try {
      await connectAccount(a.id);
    } catch (e) {
      accountRepo.update(a.id, { status: 'ERROR' } as never);
    }
    // stagger to avoid thundering herd on small VPS
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/** Graceful shutdown: close every socket, clear timers. */
export async function closeAllSessions(): Promise<void> {
  for (const [id, s] of sessions) {
    if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
    try {
      await s.sock?.ws?.close();
    } catch {
      /* ignore */
    }
    s.sock = null;
    void id;
  }
}
