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
  jidDecode,
  ALL_WA_PATCH_NAMES,
  type WASocket,
  type CacheStore,
} from '@whiskeysockets/baileys';
import { config } from '@statusflow/config';
import { accountRepo, contactRepo } from '@statusflow/database';
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
  /** Resolves once the handshake completes (first connection.update). */
  ready: Promise<void> | null;
  resolveReady: (() => void) | null;
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

/** Await a promise, throwing `error` after `ms` instead of hanging forever. */
export function withTimeout<T>(p: Promise<T>, ms: number, error: Error): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error), ms);
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const sessions = new Map<string, Session>();
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

/**
 * Keep only real user JIDs (PN or LID), drop groups/broadcasts/status,
 * exclude self, dedupe by user part. Pure — unit-tested.
 */
export function extractUserJids(
  ids: (string | null | undefined)[],
  selfUser?: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id) continue;
    try {
      const decoded = jidDecode(id);
      const user = decoded?.user;
      const server = decoded?.server;
      if (!user || (server !== 's.whatsapp.net' && server !== 'lid')) continue;
      if (selfUser && user === selfUser) continue;
      if (seen.has(user)) continue;
      seen.add(user);
      out.push(id);
    } catch {
      /* malformed JID — skip */
    }
  }
  return out;
}

/** Recently sent messages, so Baileys can answer retry requests for them
 * (docs: troubleshooting "Messages failing to send"). Statuses live 24h. */
const outboundMessages = new Map<string, { message: unknown; at: number }>();
const OUTBOUND_TTL_MS = 24 * 3600 * 1000;
const OUTBOUND_MAX = 100;

export function rememberOutboundMessage(id: string, message: unknown): void {
  outboundMessages.set(id, { message, at: Date.now() });
  if (outboundMessages.size > OUTBOUND_MAX * 2) {
    const cutoff = Date.now() - OUTBOUND_TTL_MS;
    for (const [k, v] of outboundMessages) {
      if (v.at < cutoff) outboundMessages.delete(k);
      if (outboundMessages.size <= OUTBOUND_MAX) break;
    }
  }
}

export function lookupOutboundMessage(id: string): unknown {
  return outboundMessages.get(id)?.message;
}

/** Tiny TTL cache implementing Baileys' CacheStore (no extra dependency). */
export function createTtlCache(ttlMs = 3600_000, max = 1000): CacheStore {
  const m = new Map<string, { v: unknown; exp: number }>();
  const prune = () => {
    const now = Date.now();
    for (const [k, v] of m) {
      if (v.exp <= now) m.delete(k);
    }
    while (m.size > max) {
      const oldest = m.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      m.delete(oldest);
    }
  };
  return {
    get<T>(key: string): T | undefined {
      const h = m.get(key);
      if (!h || h.exp <= Date.now()) {
        m.delete(key);
        return undefined;
      }
      return h.v as T;
    },
    set<T>(key: string, value: T): void {
      m.set(key, { v: value, exp: Date.now() + ttlMs });
      if (m.size > max) prune();
    },
    del(key: string): void {
      m.delete(key);
    },
    flushAll(): void {
      m.clear();
    },
  };
}

const retryCounterCache = createTtlCache();

/**
 * Delivery confirmation for status posts. Baileys only emits receipts for
 * status@broadcast as `message-receipt.update` (one per recipient device —
 * see messages-recv handleReceipt); `messages.update` never fires for
 * status, and the bare stanza ack emits nothing at all. Resolves true on
 * the first matching receipt, false on timeout (offline recipients) —
 * never throws, so callers stay honest without false failures.
 */
export function waitForDelivery(sock: WASocket, messageId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      cleanup();
      resolve(v);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    timer.unref?.();
    const matches = (key: { id?: string | null } | undefined) => key?.id === messageId;
    const onUpdate = (events: { key?: { id?: string | null }; update?: { status?: number } }[]) => {
      for (const { key, update } of events ?? []) {
        if (matches(key) && (update?.status ?? 0) >= 2 /* SERVER_ACK */) {
          done(true);
          return;
        }
      }
    };
    const onReceipt = (events: { key?: { id?: string | null } }[]) => {
      for (const { key } of events ?? []) {
        if (matches(key)) {
          done(true);
          return;
        }
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      try {
        sock.ev.off('messages.update', onUpdate as never);
      } catch {
        /* ignore */
      }
      try {
        sock.ev.off('message-receipt.update', onReceipt as never);
      } catch {
        /* ignore */
      }
    };
    sock.ev.on('messages.update', onUpdate as never);
    sock.ev.on('message-receipt.update', onReceipt as never);
  });
}
export function waitForServerAck(sock: WASocket, messageId: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        Object.assign(
          new Error(
            'WhatsApp did not acknowledge the Status post in time. It may still appear — check the phone before retrying.',
          ),
          { code: 'PUBLISH_UNCONFIRMED', statusCode: 504 },
        ),
      );
    }, timeoutMs);
    timer.unref?.();
    const onUpdate = (events: { key?: { id?: string | null }; update?: { status?: number } }[]) => {
      for (const { key, update } of events ?? []) {
        if (key?.id === messageId && (update?.status ?? 0) >= 2 /* SERVER_ACK */) {
          cleanup();
          resolve();
          return;
        }
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      try {
        sock.ev.off('messages.update', onUpdate as never);
      } catch {
        /* ignore */
      }
    };
    sock.ev.on('messages.update', onUpdate as never);
  });
}

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

/** True when linking (QR scan / pairing code) never completed: the 401 is a
 * rejected registration, not a logout — safe to start over instead of
 * dead-ending in LOGGED_OUT. */
export function isFreshLinkFailure(code: number | undefined, lastConnectedAt: string | null): boolean {
  return code === DisconnectReason.loggedOut && !lastConnectedAt;
}

/** Clear backoff so an explicit user retry (reconnect / pairing) starts fresh. */
export function resetReconnect(accountId: string): void {
  const s = sessions.get(accountId);
  if (!s) return;
  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }
  s.reconnectAttempts = 0;
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
      ready: null,
      resolveReady: null,
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
    // Readiness gate: pairing-code (and any stanza) requires an open channel.
    // Resolved by the first connection.update from this socket.
    s.ready = new Promise<void>((res) => {
      s.resolveReady = res;
    });
    ensureSecureDir(config.sessionDir);
    const dir = sessionDirFor(accountId);
    ensureSecureDir(dir);
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    // Brand-new sessions never ran app-state sync (syncFullHistory is off),
    // so pull the address book once it logs in — Status needs the audience.
    const isFreshSession = !state.creds.registered;
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 0] as [number, number, number] }));

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      // Docs (troubleshooting): lets Baileys answer retry requests for
      // messages we sent — including our Status posts.
      getMessage: async (key) => {
        if (!key?.id) return undefined;
        return lookupOutboundMessage(key.id) as never;
      },
      msgRetryCounterCache: retryCounterCache,
    });
    s.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    // Collect the contact audience required for Status delivery
    // (docs: statusJidList). Never allowed to break the socket.
    const collectIds = (ids: (string | null | undefined)[]) => {
      try {
        let self: string | undefined;
        try {
          self = sock.user?.id ? jidDecode(sock.user.id)?.user : undefined;
        } catch {
          self = undefined;
        }
        const fresh = extractUserJids(ids, self);
        if (fresh.length) contactRepo.upsert(accountId, fresh);
      } catch {
        /* ignore collector errors */
      }
    };
    sock.ev.on('contacts.upsert', (contacts) => collectIds(contacts.map((c) => c.id)));
    sock.ev.on('chats.upsert', (chats) => collectIds(chats.map((c) => c.id)));
    sock.ev.on('messages.upsert', ({ messages }) =>
      collectIds(messages.map((m) => m.key?.remoteJid)),
    );

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;
      // Handshake produced its first server message — the channel is live.
      s.resolveReady?.();
      s.resolveReady = null;
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
        if (isFreshSession) {
          // Fire-and-forget: populate the Status audience in the background.
          syncContacts(accountId)
            .then(({ after }) => {
              bus.emit('account.contacts', { accountId, contacts: after });
              log.info({ accountId, contacts: after }, 'initial contact sync complete');
            })
            .catch((e) => log.warn({ err: e, accountId }, 'initial contact sync failed'));
        }
      }
      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const reason = disconnectReasonText(code);
        log.warn({ accountId, code, reason }, 'whatsapp connection closed');
        if (code === DisconnectReason.loggedOut) {
          const lastConnected = accountRepo.get(accountId)?.last_connected_at ?? null;
          if (isFreshLinkFailure(code, lastConnected)) {
            // Half-registered identity (e.g. pairing code never entered on
            // the phone): wipe it and restart registration instead of
            // dead-ending — the user can simply retry with a fresh code.
            try {
              fs.rmSync(dir, { recursive: true, force: true });
            } catch {
              /* ignore */
            }
            resetReconnect(accountId);
            setStatus(accountId, 'DISCONNECTED', {
              reasonCode: code,
              reason: 'Linking didn’t complete. Scan the fresh QR or request a new pairing code.',
            });
            s.sock = null;
            scheduleReconnect(accountId);
            return;
          }
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
  // Detach first so a dead/hanging socket can never block account removal.
  const sock = s?.sock;
  if (s) s.sock = null;
  if (sock) {
    try {
      sock.ws?.close();
    } catch {
      /* ignore */
    }
    try {
      await withTimeout(
        Promise.resolve(sock.end?.(undefined)).catch(() => {}),
        3000,
        new Error('socket end timeout'),
      );
    } catch {
      /* force-close below regardless */
    }
    try {
      sock.ws?.close();
    } catch {
      /* ignore */
    }
  }
  setStatus(accountId, 'DISCONNECTED');
}

export async function logoutAccount(accountId: string): Promise<void> {
  const s = sessions.get(accountId);
  if (s?.reconnectTimer) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }
  const sock = s?.sock;
  if (s) s.sock = null;
  if (sock) {
    // logout() awaits a server reply — cap it so a dead socket can't hang
    // account removal; session files are deleted unconditionally below.
    try {
      await withTimeout(
        Promise.resolve(sock.logout()).catch(() => {}),
        5000,
        new Error('logout timeout'),
      );
    } catch {
      /* fall through to force cleanup */
    }
    try {
      sock.ws?.close();
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmSync(sessionDirFor(accountId), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  if (s) {
    s.qr = null;
    s.qrDataUrl = null;
    s.qrAt = null;
    s.pairingCode = null;
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
  }
  if (!s.sock) {
    throw Object.assign(new Error('Could not open a WhatsApp connection. Retry shortly.'), {
      code: 'CONNECTION_FAILED',
      statusCode: 502,
    });
  }
  // The socket object exists immediately, but the encrypted channel takes a
  // few seconds. Sending too early throws "Connection Closed" — wait for it.
  if (s.ready) {
    await withTimeout(
      s.ready,
      20_000,
      Object.assign(new Error("WhatsApp didn't respond in time. Check the network and retry."), {
        code: 'CONNECTION_TIMEOUT',
        statusCode: 504,
      }),
    );
  }
  const sock = s.sock;
  try {
    const code = await sock.requestPairingCode(phone);
    s.pairingCode = code;
    bus.emit('account.pairing', { accountId, code });
    return code;
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
 * Pull the address-book snapshot that Status delivery needs (statusJidList).
 * With syncFullHistory disabled the automatic app-state sync never runs, so
 * this must be triggered explicitly: automatically on first-ever link, or via
 * POST /api/accounts/:id/sync-contacts for existing sessions. Collections
 * with no locally stored version are returned as full snapshots.
 */
export async function syncContacts(accountId: string): Promise<{ before: number; after: number }> {
  const s = sessions.get(accountId);
  const sock = s?.sock;
  if (!sock || s.status !== 'CONNECTED') {
    throw Object.assign(new Error('Account is not connected.'), {
      code: 'ACCOUNT_NOT_CONNECTED',
      statusCode: 409,
    });
  }
  const resync = (
    sock as unknown as {
      resyncAppState?: (collections: string[], isInitialSync: boolean) => Promise<void>;
    }
  ).resyncAppState;
  if (typeof resync !== 'function') {
    throw Object.assign(new Error('Contact sync is not supported by this Baileys version.'), {
      code: 'SYNC_UNSUPPORTED',
      statusCode: 501,
    });
  }
  const before = contactRepo.count(accountId);
  await withTimeout(
    resync.call(sock, [...ALL_WA_PATCH_NAMES], true),
    120_000,
    Object.assign(new Error('Contact sync timed out — partial results kept, retry to continue.'), {
      code: 'SYNC_TIMEOUT',
      statusCode: 504,
    }),
  );
  const after = contactRepo.count(accountId);
  log.info({ accountId, before, after }, 'contact sync complete');
  return { before, after };
}

export function getContactCount(accountId: string): number {
  try {
    return contactRepo.count(accountId);
  } catch {
    return 0;
  }
}

/**
 * Publish a video file to the account's WhatsApp Status.
 *
 * Per Baileys docs (Broadcasts & Stories), posting to status@broadcast
 * REQUIRES statusJidList — without an audience the server acks the stanza
 * but nothing is ever posted (false SUCCESS). So we:
 *  1. resolve the audience from synced contacts (collected on login),
 *  2. refuse when Status privacy on the phone is set to Nobody,
 *  3. send with broadcast options (sendMessage resolving + key.id is the
 *     protocol-level confirmation that the addressed stanza was accepted),
 *  4. best-effort delivery check: first device receipt within 20s.
 *
 * NOTE on receipts: Baileys never emits `messages.update` for status and
 * nothing at all for the bare stanza ack — only per-recipient
 * `message-receipt.update`. So `delivered=false` means "no recipient has
 * confirmed yet (likely offline)", not failure.
 */
export async function publishStatus(
  accountId: string,
  filePath: string,
  caption = '',
): Promise<{ messageId: string; audience: number; delivered: boolean }> {
  const s = sessions.get(accountId);
  const sock = s?.sock;
  if (!sock || s.status !== 'CONNECTED' || !sock.user) {
    throw Object.assign(new Error('Account is not connected.'), { code: 'ACCOUNT_NOT_CONNECTED' });
  }

  let selfUser: string | undefined;
  try {
    selfUser = jidDecode(sock.user.id)?.user;
  } catch {
    selfUser = undefined;
  }
  const audience = extractUserJids(contactRepo.list(accountId), selfUser);
  if (!audience.length) {
    throw Object.assign(
      new Error(
        'No contacts synced yet — WhatsApp needs an audience list to post Status. ' +
          'Reconnect, wait about a minute for contact sync, then retry.',
      ),
      { code: 'NO_AUDIENCE', statusCode: 409 },
    );
  }

  if (typeof sock.fetchPrivacySettings === 'function') {
    try {
      const privacy = await sock.fetchPrivacySettings();
      if (privacy && typeof privacy.status === 'string' && privacy.status.toLowerCase() === 'none') {
        throw Object.assign(
          new Error(
            'Status privacy on the phone is set to Nobody — allow at least My contacts, then retry.',
          ),
          { code: 'STATUS_PRIVACY_NONE', statusCode: 403 },
        );
      }
    } catch (e) {
      if ((e as { code?: string })?.code === 'STATUS_PRIVACY_NONE') throw e;
      log.debug({ err: e, accountId }, 'status privacy check skipped');
    }
  }

  const data = await fs.promises.readFile(filePath);
  const res = await sock.sendMessage(
    'status@broadcast',
    {
      video: data,
      caption: caption || undefined,
      mimetype: 'video/mp4',
    },
    { broadcast: true, statusJidList: audience },
  );
  const id = res?.key?.id;
  if (!id) throw Object.assign(new Error('WhatsApp did not confirm publishing.'), { code: 'PUBLISH_UNCONFIRMED' });
  rememberOutboundMessage(id, res);
  const delivered = await waitForDelivery(sock, id, 20_000);
  log.info({ accountId, messageId: id, audience: audience.length, delivered }, 'status published');
  return { messageId: id, audience: audience.length, delivered };
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
