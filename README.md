# VaniVoice AI — Multilingual Multi-Tenant Voice Agent

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933.svg)](https://nodejs.org/)
[![Repository](https://img.shields.io/badge/GitHub-Vani--VoiceAgent-181717.svg)](https://github.com/biswal-prem-5677/Vani-VoiceAgent)

VaniVoice AI is a full-stack multilingual, multi-tenant voice agent platform supporting **Odia (`or`)**, **Hindi (`hi`)**, **Hinglish (`hinglish`)**, **Bengali (`bn`)**, and **English (`en`)**. Each business tenant operates with isolated configuration, role-scoped administration, consent-enforced call logging, a persistent staff callback/handoff queue, a SQLite clinic appointments ledger with slot collision detection, trace-correlated audit logging, and automated safety/emergency routing, powered server-side by `@google/genai` (`gemini-4-hydrogen` with automatic cooldown fallback to `gemini-3.1-flash-lite`), explicit Offline Demo Mode fallback when no API key is present, and Node 22 SQLite persistence.

> **Repository**: [https://github.com/biswal-prem-5677/Vani-VoiceAgent](https://github.com/biswal-prem-5677/Vani-VoiceAgent)

---

## Documentation Index

| Guide | Purpose |
| --- | --- |
| [Technical Architecture](docs/ARCHITECTURE.md) | End-to-end voice turn pipeline, RBAC auth model, exact confirmation matching, appointments & audit trail, & Node 22 ESM |
| [REST API Reference](docs/API.md) | Auth/bootstrap endpoints, scoped multi-tenant/log/handoff/appointment/audit routes, `X-Trace-Id`, & error codes |
| [Multi-Tenant & Tool Guide](docs/MULTI_TENANT_AND_TOOLS.md) | Tenant isolation, allowlisted server tools, exact `paramsHash` + immutable `actionId` confirmations, & clinic slot ledger |
| [Privacy, Consent & Safety](docs/PRIVACY_AND_SAFETY.md) | Tenant-aware 112 emergency fast-path, 30d handoff & 90d ticket/appointment expiry, & full session deletion |
| [Deployment & Operations](docs/DEPLOYMENT.md) | Multi-stage `Dockerfile`, `.dockerignore`, mandatory production secrets (`SESSION_SECRET`, `ADMIN_BOOTSTRAP_TOKEN`), CI, & cross-platform lockfile |

---

## Key Capabilities

- **Production Secret Guards & Role-Based Tenant Isolation**:
  - **Fail-Fast Production Startup (`verifyProductionSecurityConfig`)**: `npm start` (`node server.ts`) runs in production mode by default (`npm run dev` passes `--dev` for local development) and refuses to start unless `SESSION_SECRET` (>= 32 chars) and at least one admin protection mechanism (`ADMIN_PASSCODE`, `ADMIN_BOOTSTRAP_TOKEN`, or an existing SQLite `super_admin`) are configured.
  - **Protected First-Run Bootstrap**: When `ADMIN_BOOTSTRAP_TOKEN` is set, `POST /api/auth/bootstrap` requires constant-time verification of the token via header/body (`AdminAuthPanel.tsx`).
  - **In-Memory Signed Bearer Tokens (`src/utils/auth.ts`)**: Callers acquire scoped 4-hour `caller` tokens (`POST /api/auth/caller-session`), while admin views require `tenant_admin` or `super_admin` roles (`scrypt` salted password hashes).
- **Exact Durable Tool Confirmations & Clinic Appointments Ledger (`src/utils/actionConfirmation.ts`)**:
  - Pending confirmations canonicalize business arguments into a deterministic SHA-256 `paramsHash` tied to an immutable `actionId` (`act_...`). Changing parameters on a confirmation turn fails safely into a fresh confirmation prompt rather than confirming tampered details, and repeated confirmations replay cached results idempotently.
  - Clinic slots are backed by SQLite `appointments` (`check_slot_availability` filters booked slots in real time, `book_appointment` prevents double-booking of `(tenant_id, doctor, slot)`, and admins can view/cancel slots in `CallLogsTab.tsx`).
- **Safety, Tenant-Aware Emergencies, Privacy & Audit Trail**:
  - Every API request carries an `X-Trace-Id` header and records critical operations in SQLite `audit_logs`.
  - Safety/escalation handoff tickets (`30` days), support desk tickets (`90` days), and clinic appointments (`90` days) carry `expires_at` timestamps swept automatically at startup and every 15 minutes, and `DELETE /api/session/data` removes all transcripts, handoff tickets, support tickets, appointments, consent records, and pending actions for the active caller session.
- **Cross-Platform Tooling & Multi-Stage Container**:
  - Uses pure-JS `typescript@~5.8.3` so `npm ci` runs reliably across Linux, macOS, and Windows without OS-specific TypeScript binary mismatches.
  - `.dockerignore` excludes `.env*`, `data/`, `node_modules/`, `.git/`, and `dist/`, and the multi-stage `Dockerfile` omits `devDependencies` from the final image.

---

## Tech Stack

- **Frontend**: React 19, TypeScript (~5.8.3), Vite 8, Tailwind CSS v4, Lucide Icons, Motion
- **Backend**: Node.js 22+ (`node server.ts` native ESM type stripping), Express 4, Zod v4 runtime validation
- **Database**: Node built-in `node:sqlite` (`DatabaseSync`) stored in `./data/vanivoice.db` (falls back to `/tmp/vanivoice-data` on read-only containers)
- **AI SDK**: `@google/genai` (`gemini-4-hydrogen` primary + `gemini-3.1-flash-lite` cooldown fallback)

---

## Local Setup & Scripts

```bash
# 1. Install dependencies cleanly across Windows / macOS / Linux (Node.js 22+)
npm ci

# 2. Configure environment variables
cp .env.example .env

# 3. Development server (Express + Vite middleware on port 3000)
npm run dev

# 4. Run 26 unit + real HTTP production integration tests
npm test

# 5. Type-check frontend + backend
npm run lint

# 6. Production build & run (requires SESSION_SECRET >= 32 chars + admin protection)
npm run build
SESSION_SECRET="$(openssl rand -hex 32)" ADMIN_BOOTSTRAP_TOKEN="your-setup-token" npm start
```

---

## License

Licensed under the **Apache License 2.0** (`LICENSE`).
