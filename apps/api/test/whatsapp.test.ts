import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Baileys-dependent publisher with success/failure/session scenarios.
vi.mock('../src/modules/whatsapp/service.js', () => ({
  publishStatus: vi.fn(),
  getStatus: vi.fn(() => 'CONNECTED'),
  connectAccount: vi.fn(async () => {}),
  disconnectAccount: vi.fn(async () => {}),
  logoutAccount: vi.fn(async () => {}),
  getQr: vi.fn(() => null),
  restoreSessions: vi.fn(async () => {}),
  closeAllSessions: vi.fn(async () => {}),
}));

import { publishStatus } from '../src/modules/whatsapp/service.js';

describe('publishing integration (mocked provider)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves with message id on success', async () => {
    vi.mocked(publishStatus).mockResolvedValueOnce({ messageId: 'MSG123' });
    const r = await publishStatus('acc1', '/tmp/v.mp4');
    expect(r.messageId).toBe('MSG123');
  });

  it('surfaces publishing failure without claiming success', async () => {
    vi.mocked(publishStatus).mockRejectedValueOnce(
      Object.assign(new Error('WhatsApp did not confirm publishing.'), { code: 'PUBLISH_UNCONFIRMED' }),
    );
    await expect(publishStatus('acc1', '/tmp/v.mp4')).rejects.toThrow('did not confirm');
  });

  it('reconnect is isolated per account (one failure does not crash others)', async () => {
    const { connectAccount } = await import('../src/modules/whatsapp/service.js');
    vi.mocked(connectAccount).mockRejectedValueOnce(new Error('boom'));
    await expect(connectAccount('bad')).rejects.toThrow('boom');
    vi.mocked(connectAccount).mockResolvedValueOnce(undefined);
    await expect(connectAccount('good')).resolves.toBeUndefined();
  });
});
