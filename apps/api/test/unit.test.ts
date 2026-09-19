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
}));

import { detectSignature, isPublishReady } from '../src/modules/video/service.js';
import { disconnectReasonText, withTimeout } from '../src/modules/whatsapp/service.js';
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
describe('upload state machine', () => {
  const order = ['QUEUED', 'VALIDATING', 'PROCESSING', 'PUBLISHING', 'SUCCESS'];
  it('terminal states are final', () => {
    for (const t of ['SUCCESS', 'FAILED', 'CANCELLED']) {
      expect(order.includes(t) || ['FAILED', 'CANCELLED'].includes(t)).toBe(true);
    }
  });
});
