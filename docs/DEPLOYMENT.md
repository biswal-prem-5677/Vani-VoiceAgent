# Deployment & Operations Guide

## 1. Production Runtime (Multi-Stage Dockerfile, Cloud Run & Node 22+)

VaniVoice AI runs on **Node.js 22+ native ESM TypeScript execution** (`"start": "node server.ts"`) with `.nvmrc` = `22`, `.dockerignore`, and a multi-stage `Dockerfile` (`node:22-slim`):

1. **Docker Build Hygiene (`.dockerignore` + Multi-Stage `Dockerfile`)**:
   - `.dockerignore` excludes `.env*`, `data/`, `node_modules/`, `.git/`, `dist/`, and `.playwright-cli/` from image build contexts so local secrets or databases are never copied into container layers.
   - Stage 1 (`builder`) runs `npm ci` and compiles `dist/` via `npm run build`.
   - Stage 2 (`runtime`) runs `npm ci --omit=dev`, copies `dist/`, `public/`, `server.ts`, and `src/`, and executes `npm start`.
2. **Production Defaults (`npm start` vs. `npm run dev`)**:
   - `npm start` runs `node server.ts` in **production mode by default** (serves static `dist/` assets and enforces production secret checks).
   - `npm run dev` runs `tsx server.ts --dev` for local development with Vite middleware.

---

## 2. Node 22 ESM & Dependency Compatibility

- Every relative import in `server.ts`, `src/lib/*`, `src/data/*`, and `src/utils/*` uses an explicit `.ts` or `.json` (with `with { type: 'json' }`) extension.
- Type-only imports use `import type` (no TS `enum` or constructor parameter properties in server-loaded files).
- `firebase` is pinned to `12.19.0` with explicit Node-22-compatible sub-package overrides (`@firebase/app`, `@firebase/app-compat`, `@firebase/database`, `@firebase/database-compat`) so `npm ci` runs on Node 22 with **zero `EBADENGINE` warnings** and **0 production audit vulnerabilities**.
- Always regenerate `package-lock.json` inside an isolated empty directory without a host `node_modules/` so Windows, macOS, and Linux native optional bindings remain intact.

---

## 3. Single Authoritative SQLite Store, Backup/Restore CLI & Firestore Auth/Directory

- **Authoritative Server Persistence (`./data/vanivoice.db`)**: Mount a persistent volume at `/app/data` in container deployments so SQLite retains state across restarts (falls back to `/tmp/vanivoice-data` only if `./data` is read-only). An automatic expiry worker sweeps `call_logs`, `handoff_tickets` (30d), `integration_deliveries` (30d), `support_tickets` (90d), `appointments` (90d), and stale `pending_actions` (24h) on startup and every 15 minutes.
- **Online Backup & Integrity-Checked Restore (`scripts/db-backup.mjs`)**:
  ```bash
  # Hot backup via SQLite VACUUM INTO -> data/backups/vanivoice-<timestamp>.db
  npm run db:backup

  # Integrity-checked restore (runs PRAGMA integrity_check and saves pre-restore copy)
  node scripts/db-backup.mjs restore data/backups/vanivoice-<timestamp>.db
  ```
- **Firebase Auth & Directory Rules (`firestore.rules`)**: Firebase Auth supplies verified Google OIDC sign-in, while `firestore.rules` restricts `/admins/{uid}` strictly to `super_admin` and scopes `/tenants/{tenantId}` to `hasTenantAccess(tenantId)` / `memberUids`—no operational PII is stored in Firestore.

---

## 4. Environment Variables & Mandatory Production Secrets

| Variable | Required | Scope | Notes |
| --- | --- | --- | --- |
| `SESSION_SECRET` | **Required in Production** | Server-only | Must be `>= 32` characters (`openssl rand -hex 32`); startup exits non-zero if missing/short |
| `ADMIN_BOOTSTRAP_TOKEN` | **Recommended in Production** | Server-only | Protects first-run `POST /api/auth/bootstrap` claim; required unless `ADMIN_PASSCODE` or an existing `super_admin` exists |
| `ADMIN_PASSCODE` | Optional | Server-only | Shared admin passcode override; disables `/api/auth/bootstrap` when set |
| `ADMIN_EMAIL` | Optional | Server-only | Explicit Google OIDC email auto-promoted to `super_admin` on verified sign-in (empty by default; never hardcoded) |
| `FIREBASE_CHECK_REVOKED` | Optional (`false`) | Server-only | Set `true` only on user-owned GCP projects with IAM permissions for Firebase Auth `checkRevoked` checks |
| `CSP_FRAME_ANCESTORS` | Optional (`'self' ...`) | Server-only | Controls `Content-Security-Policy` `frame-ancestors` (set `'self'` in strict standalone prod) |
| `WEBHOOK_SIGNING_SECRET` | Optional | Server-only | Fallback HMAC-SHA256 secret for outbound EHR webhooks |
| `ALLOW_LOCAL_WEBHOOKS` | Optional (`false`) | Server-only | Keep `false` in production (SSRF protection); `true` only for local/automated testing |
| `GEMINI_API_KEY` | Optional (required for live AI) | Server-only | Set via secret manager; Offline Demo Mode remains available when unset |
| `PORT` | Optional | Server | Defaults to `3000` |

---

## 5. Multi-OS CI Pipeline & Verification Checklist

`.github/workflows/ci.yml` executes on a `[ubuntu-latest, windows-latest]` matrix on every push and PR to `main`, plus Docker image verification:
```bash
npm ci
npm audit --omit=dev
npm run lint       # ESLint across TS/TSX source, Node scripts, and firestore.rules
npm run typecheck  # tsc --noEmit across frontend and backend
npm test           # Unit, Firestore security rules invariants, and HTTP production integration tests
npm run build      # Code-split Vite production bundle
```

---

## 6. Repository Hygiene & GitHub (`Vani-VoiceAgent`)

Remote repository: `https://github.com/biswal-prem-5677/Vani-VoiceAgent`
- `.gitignore` anchors `/data/` so local SQLite database files and backups are ignored while tracked source data (`src/data/*.ts`) remains committed.
