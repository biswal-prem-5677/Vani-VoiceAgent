# Deployment & Operations Guide

## 1. Production Runtime (Multi-Stage Dockerfile, Cloud Run & Node 22+)

VaniVoice AI is packaged for **Node.js 22+ native ESM TypeScript execution** (`"start": "node server.ts"`) with a pinned runtime (`.nvmrc` = `22`), `.dockerignore`, and a multi-stage `Dockerfile` (`node:22-slim`):

1. **Docker Build Hygiene (`.dockerignore` + Multi-Stage `Dockerfile`)**:
   - `.dockerignore` excludes `.env*`, `data/`, `node_modules/`, `.git/`, `dist/`, and `.playwright-cli/` from image build contexts so local secrets or databases are never copied into container layers.
   - Stage 1 (`builder`) installs all dependencies via `npm ci` and compiles `dist/` via `npm run build`.
   - Stage 2 (`runtime`) installs production-only dependencies via `npm ci --omit=dev`, copies `dist/`, `public/`, `server.ts`, and `src/`, and runs `npm start`.
2. **Production Defaults (`npm start` vs. `npm run dev`)**:
   - `npm start` runs `node server.ts` in **production mode by default** (serves static `dist/` assets and enforces production secret checks).
   - `npm run dev` runs `tsx server.ts --dev` for local development with Vite middleware and developer warnings.

---

## 2. Node 22 ESM Import & Cross-Platform Lockfile Constraints

Because `node server.ts` runs TypeScript directly in production without bundling:
- Every relative import in `server.ts`, `src/lib/*`, `src/data/*`, and `src/utils/*` MUST include an explicit `.ts` or `.json` (with `with { type: 'json' }`) extension.
- Type-only imports MUST use `import type` (or inline `type` specifiers).
- Never use TypeScript `enum` or constructor parameter properties in server-loaded modules.
- `vite` is imported lazily only when `--dev` or `NODE_ENV=development` is active.
- **Cross-Platform `package-lock.json`**: Always regenerate `package-lock.json` inside an isolated empty directory without an existing `node_modules/` (e.g., copying `package.json` into a clean temp dir and running `npm install --package-lock-only --no-audit`), ensuring Windows (`@rolldown/binding-win32-x64-msvc`, `@esbuild/win32-x64`, `@tailwindcss/oxide-win32-x64-msvc`), macOS, and Linux optional native bindings are all present in the committed lockfile.

---

## 3. Managed Cloud Firestore, SQLite Storage & Expiry Cleanup

- **Firebase Auth & Cloud Firestore**: Configured via `firebase-applet-config.json` and `firebase-blueprint.json` with deployed Eight-Pillar `firestore.rules` (linted cleanly via `npx eslint firestore.rules`). Authenticated OIDC admins sync tenant configs, session logs, handoffs, appointments, webhook deliveries, and support tickets via `src/lib/firestoreStore.ts`.
- **SQLite Runtime Storage**: At boot, `server.ts` initializes `./data/vanivoice.db` (or falls back to `/tmp/vanivoice-data` if `./data` is non-writable). An automated cleanup worker purges expired `call_logs`, `handoff_tickets` (30d), `integration_deliveries` (30d), `support_tickets` (90d), `appointments` (90d), and stale `pending_actions` (24h) on startup and every 15 minutes.

---

## 4. Environment Variables & Mandatory Production Secrets

| Variable | Required | Scope | Notes |
| --- | --- | --- | --- |
| `SESSION_SECRET` | **Required in Production** | Server-only | Must be `>= 32` characters (e.g., `openssl rand -hex 32`); startup exits non-zero if missing/short in production |
| `ADMIN_BOOTSTRAP_TOKEN` | **Recommended in Production** | Server-only | Protects first-run `POST /api/auth/bootstrap` claim; required at startup unless `ADMIN_PASSCODE` or an existing `super_admin` exists |
| `ADMIN_PASSCODE` | Optional | Server-only | Shared admin passcode override; disables `/api/auth/bootstrap` when set |
| `ADMIN_EMAIL` | Optional | Server-only | Primary Google OIDC `super_admin` email provisioned on verified sign-in (defaults to `priyabratabiswal567@gmail.com`) |
| `WEBHOOK_SIGNING_SECRET` | Optional | Server-only | Fallback HMAC-SHA256 secret used for signing outbound EHR/webhook payloads when a tenant does not define a per-tenant secret |
| `ALLOW_LOCAL_WEBHOOKS` | Optional (`false`) | Server-only | Explicitly set to `true` only in local/automated testing to allow localhost webhook targets; SSRF blocks private/loopback targets by default |
| `GEMINI_API_KEY` | Optional (required for live AI) | Server-only | Set via secrets; when unset, callers can explicitly enable Offline Demo Mode |
| `PORT` | Optional | Server | Defaults to `3000` |
| `APP_URL` | Optional | Server/Metadata | Hosted service URL |

---

## 5. Multi-OS CI Pipeline & Verification Checklist

`.github/workflows/ci.yml` executes on a `[ubuntu-latest, windows-latest]` matrix on every push and PR to `main`, plus Docker image verification:
```bash
npm ci
npm audit --omit=dev
npx eslint firestore.rules
npm test       # Unit, Firestore security rules, and HTTP production integration tests
npm run lint   # tsc --noEmit across frontend and backend
npm run build  # Vite production bundle
```

---

## 6. Repository Hygiene & GitHub (`Vani-VoiceAgent`)

Remote repository: `https://github.com/biswal-prem-5677/Vani-VoiceAgent`
- `.gitignore` anchors `/data/` so local SQLite database files are ignored while tracked application data (`src/data/*.ts`) remains committed.
- `package-lock.json` is committed for reproducible cross-platform `npm ci` installs and `npm audit`.
