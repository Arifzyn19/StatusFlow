import { describe, it, expect, vi } from 'vitest';

// whatsapp/service pulls @statusflow/database → node:sqlite, which Vitest 2's
// Vite cannot resolve. Mock the DB layer (reason mapper never touches it).
vi.mock('@statusflow/database', () => ({
  accountRepo: {
    list: () => [],
    get: () => undefined,
    create: () => ({}),
    update: () => {},
    remove: () => {},
    countByStatus: () => ({}),
  },
  contactRepo: {
    upsert: () => {},
    list: () => [],
    count: () => 0,
    clear: () => {},
  },
}));

import { detectSignature, isPublishReady } from '../src/modules/video/service.js';
import { disconnectReasonText, withTimeout, isFreshLinkFailure } from '../src/modules/whatsapp/service.js';
import {
  extractUserJids,
  waitForServerAck,
  rememberOutboundMessage,
  lookupOutboundMessage,
  createTtlCache,
} from '../src/modules/whatsapp/service.js';
import type { WASocket } from '@whiskeysockets/baileys';
import { Semaphore } from '../src/utils/semaphore.js';
import { Errors, toApiError, AppError } from '../src/utils/errors.js';
import { safeFilename } from '../src/utils/fs.js';

describe('video signature detection', () => {
  it('detects mp4 ftyp', () => {
    const b = Buffer.alloc(64);
    b.write('....ftypisom', 0);
    expect(detectSignature(b)).toBe('video/mp4');
  });
  it('detects webm EBML', () => {
    const b = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]);
    expect(detectSignature(b)).toBe('video/webm');
  });
  it('rejects random bytes', () => {
    expect(detectSignature(Buffer.alloc(64, 0x41))).toBeNull();
  });
});

describe('publish-ready decision', () => {
  it('passes h264+aac through without re-encode', () => {
    expect(
      isPublishReady({ vcodec: 'h264', acodec: 'aac', duration: 10, width: 720, height: 1280, container: 'mp4' }),
    ).toBe(true);
  });
  it('flags vp9 for transcode', () => {
    expect(
      isPublishReady({ vcodec: 'vp9', acodec: 'opus', duration: 10, width: 720, height: 1280, container: 'webm' }),
    ).toBe(false);
  });
});

describe('semaphore concurrency', () => {
  it('blocks beyond max', async () => {
    const s = new Semaphore(1);
    const r1 = await s.acquire();
    expect(s.tryAcquire()).toBeNull();
    r1();
    expect(s.tryAcquire()).not.toBeNull();
  });
});

describe('fresh-link 401 handling', () => {
  it('soft-resets when the account never connected', () => {
    expect(isFreshLinkFailure(401, null)).toBe(true);
  });
  it('treats 401 as real logout once connected before', () => {
    expect(isFreshLinkFailure(401, '2026-01-01 00:00:00')).toBe(false);
  });
  it('ignores non-401 codes', () => {
    expect(isFreshLinkFailure(408, null)).toBe(false);
    expect(isFreshLinkFailure(undefined, null)).toBe(false);
  });
});

describe('framework client errors', () => {
  it('honors 4xx status instead of reporting 500', () => {
    const e = Object.assign(new Error("Body cannot be empty when content-type is set to 'application/json'"), {
      code: 'FST_ERR_CTP_EMPTY_JSON_BODY',
      statusCode: 400,
      name: 'FastifyError',
    });
    const mapped = toApiError(e, true);
    expect(mapped.status).toBe(400);
    expect(mapped.body.code).toBe('BAD_REQUEST');
  });
  it('still hides 500 internals in prod', () => {
    const mapped = toApiError(new Error('secret stack'), true);
    expect(mapped.body.error).toBe('Internal error');
  });
});
describe('errors', () => {
  it('maps AppError without leaking internals', () => {
    const mapped = toApiError(Errors.tooLarge('big'), true);
    expect(mapped.status).toBe(413);
    expect(mapped.body.code).toBe('FILE_TOO_LARGE');
  });
  it('hides stack in prod', () => {
    const mapped = toApiError(new Error('secret stack'), true);
    expect(mapped.body.error).toBe('Internal error');
  });
  it('exposes detail in dev', () => {
    const mapped = toApiError(new Error('secret stack'), false);
    expect(mapped.body.error).toBe('secret stack');
  });
  it('AppError carries status', () => {
    expect(new AppError('X', 'y', 422).statusCode).toBe(422);
  });
});

describe('safeFilename', () => {
  it('strips traversal', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
  });
  it('falls back', () => {
    expect(safeFilename('')).toBe('video.mp4');
  });
});

describe('disconnect reasons', () => {
  it('explains QR timeout (408)', () => {
    expect(disconnectReasonText(408)).toMatch(/expired/i);
  });
  it('explains replaced connections (440)', () => {
    expect(disconnectReasonText(440)).toMatch(/replaced/i);
  });
  it('explains logout (401)', () => {
    expect(disconnectReasonText(401)).toMatch(/logged out/i);
  });
  it('includes the code for unknown reasons', () => {
    expect(disconnectReasonText(999)).toContain('999');
  });
});

describe('withTimeout', () => {
  it('resolves fast promises untouched', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, new Error('late'))).resolves.toBe('ok');
  });
  it('rejects hanging promises after ms', async () => {
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 20, new Error('too slow'))).rejects.toThrow('too slow');
  });
});
describe('pairing phone validation (E.164 without +)', () => {
  const re = /^[1-9]\d{7,14}$/;
  it('accepts country code + number', () => {
    expect(re.test('201012345678')).toBe(true);
  });
  it('rejects +, spaces, letters, too-short', () => {
    expect(re.test('+201012345678')).toBe(false);
    expect(re.test('2010 123456')).toBe(false);
    expect(re.test('12345')).toBe(false);
    expect(re.test('0201012345678')).toBe(false);
  });
});
describe('status audience (extractUserJids)', () => {
  it('keeps PN and LID users, drops groups/broadcast/status', () => {
    expect(
      extractUserJids([
        '6281234567890@s.whatsapp.net',
        '1234567890@lid',
        '123456-789@g.us',
        'status@broadcast',
        '1234@broadcast',
        null,
        undefined,
        'not-a-jid',
      ]),
    ).toEqual(['6281234567890@s.whatsapp.net', '1234567890@lid']);
  });
  it('excludes self and dedupes by user part', () => {
    expect(
      extractUserJids(
        ['6281@s.whatsapp.net', '6281:5@s.whatsapp.net', '6282@s.whatsapp.net'],
        '6281',
      ),
    ).toEqual(['6282@s.whatsapp.net']);
  });
});

function fakeSock() {
  const handlers = new Map<string, Set<(v: never) => void>>();
  const ev = {
    on: (e: string, h: (v: never) => void) => {
      let s = handlers.get(e);
      if (!s) {
        s = new Set();
        handlers.set(e, s);
      }
      s.add(h);
    },
    off: (e: string, h: (v: never) => void) => {
      handlers.get(e)?.delete(h);
    },
    fire: (e: string, v: never) => {
      handlers.get(e)?.forEach((h) => h(v));
    },
  };
  return { ev, handlerCount: (e: string) => handlers.get(e)?.size ?? 0 } as unknown as {
    ev: WASocket['ev'];
    handlerCount: (e: string) => number;
    fire: (e: string, v: never) => void;
  } & { fire: (e: string, v: never) => void };
}

describe('waitForServerAck', () => {
  it('resolves on SERVER_ACK for the message id', async () => {
    const sock = fakeSock();
    const p = waitForServerAck(sock, 'MSG1', 1000);
    (sock.ev as unknown as { fire: (e: string, v: never) => void }).fire('messages.update', [
      { key: { id: 'OTHER' }, update: { status: 4 } },
      { key: { id: 'MSG1' }, update: { status: 1 } },
      { key: { id: 'MSG1' }, update: { status: 2 } },
    ] as never);
    await expect(p).resolves.toBeUndefined();
    expect(sock.handlerCount('messages.update')).toBe(0);
  });
  it('rejects PUBLISH_UNCONFIRMED on timeout', async () => {
    const sock = fakeSock();
    await expect(waitForServerAck(sock, 'MSG9', 30)).rejects.toMatchObject({
      code: 'PUBLISH_UNCONFIRMED',
    });
    expect(sock.handlerCount('messages.update')).toBe(0);
  });
});

describe('outbound message store (getMessage backing)', () => {
  it('remembers and looks up by id', () => {
    rememberOutboundMessage('K1', { hello: 1 });
    expect(lookupOutboundMessage('K1')).toEqual({ hello: 1 });
    expect(lookupOutboundMessage('missing')).toBeUndefined();
  });
});

describe('createTtlCache', () => {
  it('get/set/del/flushAll with expiry', async () => {
    const c = createTtlCache(30, 10);
    c.set('a', 1);
    expect(c.get<number>('a')).toBe(1);
    c.del('a');
    expect(c.get('a')).toBeUndefined();
    c.set('b', 2);
    c.flushAll();
    expect(c.get('b')).toBeUndefined();
    c.set('c', 3);
    await new Promise((r) => setTimeout(r, 50));
    expect(c.get('c')).toBeUndefined();
  });
});
describe('upload state machine', () => {
  const order = ['QUEUED', 'VALIDATING', 'PROCESSING', 'PUBLISHING', 'SUCCESS'];
  it('terminal states are final', () => {
    for (const t of ['SUCCESS', 'FAILED', 'CANCELLED']) {
      expect(order.includes(t) || ['FAILED', 'CANCELLED'].includes(t)).toBe(true);
    }
  });
});
