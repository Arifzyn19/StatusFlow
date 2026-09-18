# StatusFlow — Multi-Account WhatsApp Status Uploader

Premium self-hosted dashboard to connect multiple WhatsApp accounts (QR auth) and
publish videos directly to WhatsApp Status. Personal/authorized accounts only —
no spam, bulk messaging, scraping, or abuse features.

## Workflow

Dashboard → Add account → scan QR → CONNECTED → Upload page → pick account +
video → validate → publish → confirmed result in History.

> WhatsApp may compress Status videos on its side. StatusFlow preserves your file
> (no gratuitous re-encode) but never promises lossless delivery.

## Stack

- **Web**: Next.js 15.5, React 19, TypeScript, Tailwind, TanStack Query, RHF + Zod,
  Lucide icons. Dark premium UI (near-black, charcoal, restrained green accent).
- **API**: Fastify 5, TypeScript, REST + SSE (`/api/events`), Zod validation,
  bcryptjs + JWT HttpOnly cookies, rate limits, structured logs.
- **WhatsApp**: Baileys **6.7.24** (stable legacy tag; v7 RC kept experimental and
  isolated — see `docs/architecture.md`), session credentials in `data/sessions` (700).
- **DB**: SQLite via `node:sqlite` (zero native deps) + repository pattern;
  `packages/database/prisma/schema.prisma` is the PostgreSQL migration reference.
- **Video**: ffprobe metadata, magic-byte checks, ffmpeg **only when not
  h264/aac** (`veryfast`, CRF 23, 2 threads — VPS-friendly).

## Quick start

```bash
cp .env.example .env   # set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
node scripts/setup.mjs
npm install
npm run dev:api        # :3001
npm run dev:web        # :3000 (proxies /api → :3001)
```

Open `http://localhost:3000/login` → first run: “Create admin account”.

## Production

See `docs/deployment.md` (PM2 + Nginx + HTTPS), `docs/architecture.md`,
`docs/troubleshooting.md`. Env reference: `.env.example`.

```bash
npm run build:api && npm run build:web
pm2 start deploy/ecosystem.config.js
```

## API

- Auth: `POST /api/auth/{setup,login,logout}` · `GET /api/auth/me`
- Accounts: `GET/POST /api/accounts` · `GET /api/accounts/:id[/qr]` ·
  `POST /api/accounts/:id/{reconnect,logout,pairing}` · `DELETE /api/accounts/:id`
  (`pairing` body: `{ "phone": "201012345678" }` — E.164 without `+`, returns `{ code }`)
- Uploads: `POST /api/uploads` (multipart) · `GET /api/uploads[?accountId&status&search&page]`
  · `GET/DELETE /api/uploads/:id` · `POST /api/uploads/:id/cancel`
- System: `GET /api/system/{health,stats,settings}` · `PUT /api/system/settings`
- Live: `GET /api/events` (SSE: `account.status`, `account.qr`, `upload.*`)

## Security

Argon2id-or-bcrypt requirement met via bcrypt (12 rounds); HttpOnly + SameSite
cookies; helmet; CORS allowlist; login rate limiting; Zod on every body; file
signature + size + duration validation; path-traversal guards; 700 session dir;
no secrets or creds ever sent to the frontend; no stack traces in production.

## Testing

```bash
npm run test:api   # vitest: validation, signatures, semaphore, errors, mocked publish
```

No real WhatsApp account needed — Baileys is mocked in `apps/api/test/`.

## Scope (v1)

Video Status only. No image/text Status, scheduling, bulk publishing, or public
registration.
