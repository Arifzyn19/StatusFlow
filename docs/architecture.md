# StatusFlow — architecture

Monorepo (`npm workspaces`):

```
apps/web        Next.js 15 dashboard (React 19, Tailwind, TanStack Query, RHF+Zod)
apps/api        Fastify 5 REST + SSE (TypeScript)
packages/shared DTOs + status unions (no Node imports)
packages/database SQLite layer (node:sqlite) + repositories + Prisma schema (reference)
packages/config typed env config with VPS-safe defaults
```

## Backend modules

- **AuthModule** (`modules/auth`): bcryptjs hashing, JWT in HttpOnly SameSite cookie,
  first-run `/setup`, rate-limited login, change-password.
- **AccountModule** (`modules/accounts`): CRUD over `whatsapp_accounts`, caps at 10
  sessions for small VPS, delegates connections to WhatsAppModule.
- **WhatsAppModule** (`modules/whatsapp/service.ts`): the ONLY file importing Baileys.
  Stable provider: `@whiskeysockets/baileys@6.7.24` (last stable legacy tag; v7 is RC).
  Experimental v7 must live behind a separate provider file and never share session dirs.
- **UploadModule** (`modules/uploads`): streams multipart to disk (never buffers whole
  file), validates ext → MIME allowlist → magic bytes → ffprobe → duration cap,
  transcodes only when not h264/aac, publishes via `status@broadcast`, always cleans temp.
- **VideoModule** (`modules/video`): `probe`, `isPublishReady`, `ensurePublishable`
  (veryfast/crf23/faststart, 2 threads — VPS-friendly).
- **HistoryModule** (`modules/history`): filtered/paginated upload queries + safe delete
  (active uploads cannot be deleted).
- **SystemModule** (`modules/system`): health, stats (accounts/uploads/loadavg/mem/disk),
  admin-editable limits persisted to `system_settings`.

## Live updates

`GET /api/events` — Server-Sent Events (no Redis, Nginx-friendly with
`X-Accel-Buffering: no`). Topics: `account.status`, `account.qr`,
`upload.progress`, `upload.status`. The web app subscribes once per dashboard layout
and invalidates React Query caches.

## Data

`node:sqlite` (built into Node 22+) with WAL + foreign keys. Repository functions in
`packages/database/src/repositories.ts` are the only SQL touchpoints — replace that
file with a `pg`-backed implementation (or Prisma client using
`packages/database/prisma/schema.prisma`) to move to PostgreSQL.

## WhatsApp compatibility (verified 2026-09-18)

- `@whiskeysockets/baileys`: `latest = 7.0.0-rc14`, `legacy/stable = 6.7.24`.
  StatusFlow pins **6.7.24** for production stability (status publishing via
  `status@broadcast` is exercised on the 6.x API).
- `fastify@5.12.5`, `next@15.5.4` (pinned; Next 16 is latest but 15.x is the proven
  stable line), `prisma@6.x` schema kept as migration reference.
