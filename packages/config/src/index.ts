/**
 * Central typed configuration. All values come from env with safe defaults
 * tuned for a 2–4 GB VPS. Documented in .env.example and docs/.
 */
import path from 'node:path';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function str(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}

const root = process.cwd();

export const config = {
  env: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',
  port: num('PORT', 3001),
  host: str('HOST', '127.0.0.1'),
  webUrl: str('WEB_URL', 'http://localhost:3000'),
  corsOrigin: str('CORS_ORIGIN', 'http://localhost:3000'),

  jwtSecret: str('JWT_SECRET', 'dev-only-insecure-secret-change-me-32chars!!'),
  adminEmail: str('ADMIN_EMAIL', 'admin@statusflow.local'),
  adminPassword: str('ADMIN_PASSWORD', ''),
  cookieName: str('SESSION_COOKIE_NAME', 'statusflow_session'),
  cookieSecure: bool('COOKIE_SECURE', false),

  databaseUrl: str('DATABASE_URL', 'file:./data/statusflow.db'),
  sessionDir: path.resolve(root, str('SESSION_DIRECTORY', './data/sessions')),
  tempDir: path.resolve(root, str('TEMP_UPLOAD_DIRECTORY', './data/temp')),

  maxUploadSizeMB: num('MAX_UPLOAD_SIZE_MB', 128),
  maxVideoDurationSeconds: num('MAX_VIDEO_DURATION_SECONDS', 90),
  maxConcurrentUploads: num('MAX_CONCURRENT_UPLOADS', 2),
  maxConcurrentFfmpeg: num('MAX_CONCURRENT_FFMPEG', 1),
  allowedVideoMime: str(
    'ALLOWED_VIDEO_MIME',
    'video/mp4,video/quicktime,video/webm',
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  uploadTimeoutMs: num('UPLOAD_TIMEOUT_MS', 300_000),

  logLevel: str('LOG_LEVEL', 'info'),
};

export type AppConfig = typeof config;
