# Deployment & Operations Guide

## 1. Production Runtime (Dockerfile, Cloud Run & Node 22+)

VaniVoice AI is packaged for **Node.js 22+ native ESM TypeScript execution** (`"start": "node server.ts"`) with a pinned runtime (`.nvmrc` = `22`, `Dockerfile` using `node:22-slim`):

1. **Install Clean Dependencies**:
   ```bash
   npm ci
   ```
2. **Build Frontend Bundle**:
   ```bash
   npm run build
   ```
   Outputs static assets to `dist/`.
3. **Start Production Server**:
   ```bash
   NODE_ENV=production PORT=3000 npm start
   ```
   - Binds to `0.0.0.0:${PORT:-3000}` with `app.set('trust proxy', 1)` for accurate reverse-proxy IP rate limiting.
   - Skips importing `vite` in production (`NODE_ENV === 'production'`) and serves `public/` + `dist/` with SPA fallback.

---

## 2. Node 22 ESM Import Constraints

Because `node server.ts` runs TypeScript directly in production without bundling:
- Every relative import in `server.ts`, `src/data/*`, and `src/utils/*` MUST include an explicit `.ts` extension.
- Type-only imports MUST use `import type` (or inline `type` specifiers).
- `vite` is imported lazily only in development mode.

---

## 3. SQLite Storage, Expiry Cleanup & Read-Only Containers

- At boot, `server.ts` initializes `./data/vanivoice.db` (or falls back to `/tmp/vanivoice-data` if `./data` is non-writable).
- An automated cleanup worker purges expired rows (`expires_at <= now`) on startup and every 15 minutes.
- In ephemeral container runtimes (like default Cloud Run without persistent volume mounts), `/tmp` resets on cold starts; mount persistent storage or swap to an external database for multi-instance durability.

---

## 4. Environment Variables & Admin Access

| Variable | Required | Scope | Notes |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Optional (required for live AI) | Server-only | Set via secrets; when unset, callers can explicitly enable Offline Demo Mode |
| `ADMIN_PASSCODE` | Optional | Server-only | Optional workspace passcode for admin login; if omitted, claim initial `super_admin` in the UI (`POST /api/auth/bootstrap`) |
| `SESSION_SECRET` | Recommended in prod | Server-only | HMAC-SHA256 signing key (defaults to a runtime random CSPRNG secret if unset; single-instance only without explicit secret) |
| `PORT` | Optional | Server | Defaults to `3000` |
| `APP_URL` | Optional | Server/Metadata | Hosted service URL |

---

## 5. CI Pipeline & Verification Checklist

`.github/workflows/ci.yml` executes on every push and PR to `main`:
```bash
npm ci
npm test       # 20 tests in src/utils/voiceEngine.test.ts
npm run lint   # tsc --noEmit across frontend and backend
npm run build  # Vite production bundle
```

---

## 6. Repository Hygiene & GitHub (`Vani-VoiceAgent`)

Remote repository: `https://github.com/biswal-prem-5677/Vani-VoiceAgent`
- `.gitignore` anchors `/data/` so local SQLite database files are ignored while tracked application data (`src/data/*.ts`) remains committed.
- `package-lock.json` is committed for reproducible `npm ci` installs and `npm audit`.
