# StatusFlow — deployment (Ubuntu VPS, 2–4 GB RAM, no Docker required)

## 1. Prerequisites

```bash
sudo apt update && sudo apt install -y nodejs npm ffmpeg nginx certbot python3-certbot-nginx
node --version   # >= 20.19
ffmpeg -version
```

Or use NodeSource for Node 22 LTS.

## 2. Install

```bash
git clone <repo> StatusFlow && cd StatusFlow
cp .env.example .env && nano .env   # set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
node scripts/setup.mjs
npm install
npm run build:api && npm run build:web
```

DB migrates automatically on API boot (`packages/database` runs DDL).
Sessions live in `./data/sessions` (chmod 700); temp uploads in `./data/temp`.

## 3. Run with PM2

```bash
npm i -g pm2
pm2 start deploy/ecosystem.config.js
pm2 save && pm2 startup   # follow the printed command
pm2 logs statusflow-api --lines 50
```

Memory guards: API restarts at 800 MB, web at 600 MB.

## 4. Nginx + HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/statusflow
# edit server_name, then:
sudo ln -s /etc/nginx/sites-available/statusflow /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d status.example.com
```

SSE (`/api/events`) already sets `proxy_buffering off` in the sample config.

## 5. Permissions & backups

```bash
chmod 700 data/sessions data/temp
# backup: sqlite file + sessions (encrypted at rest recommended)
tar -czf backup-$(date +%F).tar.gz data/statusflow.db data/sessions
```

## 6. Monitoring

- `GET /api/system/health` for load-balancer checks.
- `GET /api/system/stats` for memory/load/disk overview.
- `pm2 monit`, `journalctl`, and `logs/` files.

## 7. Updates

```bash
git pull && npm install && npm run build:api && npm run build:web && pm2 restart all
```
