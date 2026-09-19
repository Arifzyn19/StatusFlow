# StatusFlow — troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| QR never appears | API offline / session dir unwritable | `pm2 logs statusflow-api`; `chmod 700 data/sessions`; check `LOG_LEVEL=debug` |
| QR appears then disappears | Short reconnect cycle (see reason under the code) or QR natural expiry (~60s) | The last code now stays visible, dimmed, with the reason (e.g. timed out, replaced). Wait for the fresh code, or use pairing code instead |
| `Connection replaced (440)` | Session opened elsewhere / duplicate socket | Click Reconnect once (not repeatedly); ensure a single API instance manages the session |
| Pairing code rejected/expired | Wrong number or code timed out | Number must be E.164 without `+`/spaces (e.g. `201012345678`); request a fresh code. A wrong number taints the session — then remove and re-add the account |
| `ACCOUNT_NOT_CONNECTED` on upload | Phone went offline / logged out elsewhere | Reconnect; if `LOGGED_OUT`, delete session and re-add |
| `FILE_TOO_LARGE` | Over `MAX_UPLOAD_SIZE_MB` | Lower size or raise limit in Settings / `.env` |
| `VIDEO_TOO_LONG` | Over duration cap | Trim, or raise `MAX_VIDEO_DURATION_SECONDS` (WhatsApp Status caps ~90s) |
| `FFMPEG_FAILED` | Corrupt file / missing ffmpeg | `ffmpeg -version`; test `ffprobe file.mp4`; VP9/WebM gets transcoded — needs CPU headroom |
| Upload stuck in `PUBLISHING` | VPS OOM / WhatsApp throttling | Check `/dashboard` memory panel; `pm2 monit`; retry once; never double-submit |
| SSE disconnects behind Nginx | Buffering on | Ensure `proxy_buffering off` + `X-Accel-Buffering: no` (see `deploy/nginx.conf`) |
| 401 loops on web | Cookie `Secure` mismatch over HTTP | Set `COOKIE_SECURE=false` for plain HTTP, `true` behind HTTPS |
| Backend restart mid-upload | PM2 restart / OOM | Upload stays non-terminal; temp files swept hourly; user retries — success is only reported on confirmed send |
| `Bad MAC` / `No matching sessions` decrypt errors in logs | Stale incoming Signal sessions (common with LID messages) — Baileys retries automatically | Harmless noise; Status publishing is unaffected. Restart the API if it loops for hours |
| Can't find the database file | Relative `DATABASE_URL` resolves against the process cwd: under PM2 (`cwd: apps/api`) it is `apps/api/data/statusflow.db`; `npm run db:migrate` from the root uses `./data/statusflow.db` | Prefer an absolute `DATABASE_URL=file:/abs/path/statusflow.db` in production |
| Delete-account button errors | Fixed: client no longer sends empty JSON bodies; server caps socket teardown so removal can't hang | Update to latest build and restart both PM2 processes |
| Disk full | Old temp files / DB growth | `du -sh data/*`; temp auto-sweeps files >6h; delete old history records |

**Never** report success without a confirmed `messageId` from Baileys — the code
throws `PUBLISH_UNCONFIRMED` otherwise.
