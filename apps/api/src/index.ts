import { config } from '@statusflow/config';
import { getDb, adminRepo } from '@statusflow/database';
import bcrypt from 'bcryptjs';
import { buildApp } from './app.js';
import { restoreSessions, closeAllSessions } from './modules/whatsapp/service.js';
import { closeDb } from '@statusflow/database';

async function ensureAdmin(app: { log: { info: (o: unknown, m: string) => void } }) {
  getDb();
  if (adminRepo.count() === 0 && config.adminPassword) {
    const hash = await bcrypt.hash(config.adminPassword, 12);
    adminRepo.create(config.adminEmail.toLowerCase(), hash);
    app.log.info({ email: config.adminEmail }, 'initial admin created from env');
  }
}

async function main() {
  const app = await buildApp();
  await ensureAdmin(app);

  const close = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await closeAllSessions();
    } catch {
      /* ignore */
    }
    try {
      await app.close();
    } catch {
      /* ignore */
    }
    closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => void close('SIGTERM'));
  process.on('SIGINT', () => void close('SIGINT'));

  // Isolate session-restore failures: one bad account must not crash boot
  restoreSessions().catch((e) => app.log.error({ err: e }, 'session restore failed'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
