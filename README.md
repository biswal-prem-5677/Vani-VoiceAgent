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
| [Technical Architecture](docs/ARCHITECTURE.md) | End-to-end voice turn pipeline, Firebase OIDC + Firestore Eight-Pillar RBAC, webhook/ICS integrations, & Node 22 ESM |
| [REST API Reference](docs/API.md) | Auth/OIDC/governance endpoints, scoped multi-tenant/log/handoff/appointment/integration/metrics routes, `X-Trace-Id`, & error codes |
| [Multi-Tenant & Tool Guide](docs/MULTI_TENANT_AND_TOOLS.md) | Tenant isolation, allowlisted server tools, exact `paramsHash` + immutable `actionId` confirmations, & clinic slot ledger |
| [New Tenant in 30 Minutes](docs/NEW_TENANT_PLAYBOOK.md) | FDE onboarding playbook: tenant cloning, webhook HMAC signing, `.ics` export, and smoke checks |
| [Privacy, Consent & Safety](docs/PRIVACY_AND_SAFETY.md) | Tenant-aware 112 emergency fast-path, SSRF-guarded webhooks, 30d/90d expiry, & full session deletion |
| [Deployment & Operations](docs/DEPLOYMENT.md) | Multi-stage `Dockerfile`, `.dockerignore`, Firebase Auth/Firestore rules, mandatory secrets, & Ubuntu + Windows CI |

---

## Key Capabilities

- **Enterprise Identity, Firebase OIDC & Managed Firestore Persistence**:
  - **Google OIDC & Scoped Workspace RBAC (`src/lib/firebase.ts`, `src/lib/firebase-admin.ts`, `src/utils/auth.ts`)**: Admins can sign in with Google OIDC (`POST /api/auth/firebase`, verified server-side via Firebase Admin `verifyIdToken` with `email_verified` enforcement and `ADMIN_EMAIL` super-admin provisioning) or email/`scrypt` passcode. Every protected request immediately re-checks user existence, role, and revocation status against SQLite `users` (`PATCH /api/auth/users/:id/role`, `POST /api/auth/users/:id/revoke`).
  - **Fail-Fast Production Startup (`verifyProductionSecurityConfig`)**: `npm start` (`node server.ts`) runs in production mode by default (`npm run dev` passes `--dev` for local development) and refuses to start unless `SESSION_SECRET` (>= 32 chars) and at least one admin protection mechanism (`ADMIN_PASSCODE`, `ADMIN_BOOTSTRAP_TOKEN`, or an existing SQLite `super_admin`) are configured.
  - **Cloud Firestore Rules & Sync (`firestore.rules`, `firebase-blueprint.json`, `src/lib/firestoreStore.ts`)**: Owner-scoped and tenant-admin-scoped Firestore collections deployed with ESLint-validated security rules, complementing local/ephemeral SQLite state.
- **Real External Integrations & FDE Operational Metrics**:
  - **RFC-5545 Calendar (`.ics`) & Signed Outbound Webhooks (`src/utils/externalIntegration.ts`)**: Confirmed clinic bookings generate downloadable `.ics` calendar invites (`GET /api/appointments/:id/calendar.ics`) in both `LiveVoiceCall.tsx` and `CallLogsTab.tsx`. Tenants can configure outbound webhook endpoints (`appointment.confirmed`, `appointment.cancelled`, `handoff.created`) signed with HMAC-SHA256 (`X-VaniVoice-Signature`), guarded against SSRF private IP targets, backed by bounded retries and a durable `integration_deliveries` retry queue (`GET /api/integrations`, `POST /api/integrations/:id/retry`).
  - **FDE Operational Outcomes Dashboard (`src/utils/operationalMetrics.ts`, `GET /api/metrics/operational`)**: Real-time KPIs per tenant covering containment rate, human escalation/emergency rates, tool confirmation rate, webhook delivery health, latency percentiles (median & P95), and language mix.
- **Exact Durable Tool Confirmations & Clinic Appointments Ledger (`src/utils/actionConfirmation.ts`)**:
  - Pending confirmations canonicalize business arguments into a deterministic SHA-256 `paramsHash` tied to an immutable `actionId` (`act_...`). Changing parameters on a confirmation turn fails safely into a fresh confirmation prompt rather than confirming tampered details, and repeated confirmations replay cached results idempotently.
  - Clinic slots are backed by SQLite `appointments` (`check_slot_availability` filters booked slots in real time, `book_appointment` prevents double-booking of `(tenant_id, doctor, slot)`, and admins can view/cancel/export `.ics` slots in `CallLogsTab.tsx`).
- **Safety, Tenant-Aware Emergencies, Privacy & Audit Trail**:
  - Every API request carries an `X-Trace-Id` header and records critical operations in SQLite `audit_logs`.
  - Safety/escalation handoff tickets (`30` days), support desk tickets (`90` days), clinic appointments (`90` days), and webhook deliveries (`30` days) carry `expires_at` timestamps swept automatically at startup and every 15 minutes, and `DELETE /api/session/data` removes all caller-session records across those tables.
- **Cross-Platform Tooling & Multi-OS CI**:
  - Platform-complete `package-lock.json` generated cleanly without local `node_modules` bias (locking Windows, macOS, and Linux native Rolldown, esbuild, and Tailwind Oxide bindings) and validated in `.github/workflows/ci.yml` across both `ubuntu-latest` and `windows-latest`, alongside `npx eslint firestore.rules` and Docker builds.

---

## Tech Stack

- **Frontend**: React 19, TypeScript (~5.8.3), Vite 8, Tailwind CSS v4, Lucide Icons, Motion, Firebase Web SDK (Auth + Firestore)
- **Backend**: Node.js 22+ (`node server.ts` native ESM type stripping), Express 4, Zod v4 runtime validation, `firebase-admin`
- **Database**: Cloud Firestore (`firestore.rules` + `firebase-blueprint.json`) + Node built-in `node:sqlite` (`DatabaseSync`) stored in `./data/vanivoice.db` (falls back to `/tmp/vanivoice-data` on read-only containers)
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

# 4. Run unit, Firestore security rules, and HTTP production integration tests
npm test

# 5. Type-check frontend + backend & validate Firestore rules
npm run lint
npx eslint firestore.rules

# 6. Optional live Gemini safety/routing smoke evaluation (skips cleanly if GEMINI_API_KEY is unset)
npm run eval:live

# 7. Production build & run (requires SESSION_SECRET >= 32 chars + admin protection)
npm run build
SESSION_SECRET="$(openssl rand -hex 32)" ADMIN_BOOTSTRAP_TOKEN="your-setup-token" npm start
```

---

## License

Licensed under the **Apache License 2.0** (`LICENSE`).
