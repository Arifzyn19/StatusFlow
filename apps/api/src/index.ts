import { config } from '@statusflow/config';
import { getDb, adminRepo, uploadRepo } from '@statusflow/database';
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

  // A timer/queue callback must never take the whole server down silently:
  // log loudly, attempt graceful shutdown, and let PM2 restart us.
  // (Boot recovery below converts orphaned uploads into retriable FAILEDs.)
  let shuttingDown = false;
  const onFatal = (origin: string, err: unknown) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      app.log.fatal({ err, origin }, 'fatal error — shutting down');
    } catch {
      /* logger may be broken; fall through to exit */
    }
    setTimeout(() => process.exit(1), 3000).unref?.();
    close('FATAL').catch(() => process.exit(1));
  };
  process.on('uncaughtException', (err) => onFatal('uncaughtException', err));
  process.on('unhandledRejection', (err) => onFatal('unhandledRejection', err));

  // Crash recovery: uploads orphaned by a previous run can never finish.
  try {
    const n = uploadRepo.markInterrupted();
    if (n > 0) app.log.info({ count: n }, 'marked interrupted uploads as FAILED');
  } catch (e) {
    app.log.error({ err: e }, 'interrupted-upload recovery failed');
  }

  // Isolate session-restore failures: one bad account must not crash boot
  restoreSessions().catch((e) => app.log.error({ err: e }, 'session restore failed'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
