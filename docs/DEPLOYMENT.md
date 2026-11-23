# Deployment & Operations Guide

## 1. Production Runtime (Cloud Run & Node 22+)

VaniVoice AI uses a single-process Express server (`server.ts`) configured for **Node.js 22 native ESM TypeScript type stripping** (`"start": "node server.ts"`):

1. **Build Frontend Bundle**:
   ```bash
   npm run build
   ```
   Outputs static assets to `dist/`.
2. **Start Production Server**:
   ```bash
   NODE_ENV=production PORT=3000 npm start
   ```
   - Binds to `0.0.0.0:${PORT:-3000}`.
   - Skips importing `vite` in production (`NODE_ENV === 'production'`).
   - Serves `public/` (PWA manifest, `icon.svg`, `robots.txt`, `sitemap.xml`) and `dist/` with a client-side SPA fallback.

---

## 2. Node 22 ESM Import Constraints

Because `node server.ts` executes TypeScript directly without `tsx` or bundling in production:
- Every relative import in `server.ts`, `src/data/*`, and `src/utils/*` MUST include an explicit `.ts` extension.
- Type-only imports MUST use `import type` (or inline `type` specifiers).
- Never eagerly import `vite` at the top level of `server.ts`.

---

## 3. SQLite Storage & Read-Only Container Fallback

- At boot, `server.ts` attempts to create and write to `./data/vanivoice.db` using `node:sqlite` (`DatabaseSync`).
- If the container root filesystem is read-only (as in certain serverless/Cloud Run environments), it catches the `EACCES`/`EROFS` error and automatically stores `vanivoice.db` inside `/tmp/vanivoice-data`.
- Note: Ephemeral container filesystems (`/tmp`) reset across container restarts unless backed by a persistent volume or external database.

---

## 4. Environment Variables & Secrets

| Variable | Required | Scope | Notes |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Yes (for live AI turns) | Server-only | Set via Cloud Run / AI Studio Secrets; `/api/turn` returns `503 GEMINI_NOT_CONFIGURED` if absent |
| `PORT` | Optional | Server | Defaults to `3000` |
| `APP_URL` | Optional | Server/Metadata | Hosted service URL |

Verify live server health after startup:
```bash
curl http://localhost:3000/api/health
```

---

## 5. Pre-Deploy Verification Checklist

Run these three checks before deploying or pushing changes:
```bash
npm test       # Runs 15 unit tests in src/utils/voiceEngine.test.ts
npm run lint   # Runs tsc --noEmit across frontend and backend
npm run build  # Produces clean Vite bundle in dist/
```

---

## 6. Syncing with GitHub (`Vani-VoiceAgent`)

Remote repository: `https://github.com/biswal-prem-5677/Vani-VoiceAgent`

```bash
git status
git add .
git commit -m "Update VaniVoice AI codebase and documentation"
git push -u origin main
```
