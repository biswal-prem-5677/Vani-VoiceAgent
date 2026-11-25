# VaniVoice AI — Multilingual Multi-Tenant Voice Agent

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933.svg)](https://nodejs.org/)
[![Repository](https://img.shields.io/badge/GitHub-Vani--VoiceAgent-181717.svg)](https://github.com/biswal-prem-5677/Vani-VoiceAgent)

VaniVoice AI is a full-stack multilingual, multi-tenant voice agent platform supporting **Odia (`or`)**, **Hindi (`hi`)**, **Hinglish (`hinglish`)**, **Bengali (`bn`)**, and **English (`en`)**. Each business tenant operates with isolated configuration, role-scoped administration, consent-enforced call logging, a persistent staff callback/handoff queue, a SQLite clinic appointments ledger with slot collision detection, trace-correlated audit logging, and automated safety/emergency routing, powered server-side by `@google/genai` (`gemini-4-hydrogen` with cooldown fallback to `gemini-3.1-flash-lite`), explicit Offline Demo Mode fallback when no API key is present, and single-authoritative server SQLite persistence.

> **Repository**: [https://github.com/biswal-prem-5677/Vani-VoiceAgent](https://github.com/biswal-prem-5677/Vani-VoiceAgent)

---

## Documentation Index

| Guide | Purpose |
| --- | --- |
| [Technical Architecture](docs/ARCHITECTURE.md) | End-to-end voice turn pipeline, single data-plane boundary, Firebase OIDC + tenant-scoped Firestore RBAC, & Node 22 ESM |
| [REST API Reference](docs/API.md) | Auth/OIDC/governance endpoints, `/api/health` vs `/api/diagnostics`, CSP headers, scoped tenant/log/handoff/appointment/metrics routes |
| [Multi-Tenant & Tool Guide](docs/MULTI_TENANT_AND_TOOLS.md) | Tenant isolation, allowlisted server tools, exact `paramsHash` + immutable `actionId` confirmations, & clinic slot ledger |
| [FDE Pilot Case Study](docs/CASE_STUDY_KALINGA_CLINIC.md) | Kalinga Care Multispeciality Clinic pilot design, KPIs, non-HIPAA boundary, & rollout/rollback checklist |
| [New Tenant in 30 Minutes](docs/NEW_TENANT_PLAYBOOK.md) | FDE onboarding playbook: tenant cloning, webhook HMAC signing, `.ics` export, and smoke checks |
| [Privacy, Consent & Safety](docs/PRIVACY_AND_SAFETY.md) | Tenant-aware 112 emergency fast-path, SSRF-guarded webhooks, 30d/90d expiry, & atomic session deletion |
| [Deployment & Operations](docs/DEPLOYMENT.md) | Multi-stage `Dockerfile`, `.dockerignore`, SQLite `VACUUM INTO` backup/restore CLI, mandatory secrets, & Ubuntu + Windows CI |

---

## Key Capabilities

- **Single Authoritative Persistence, Firebase OIDC & Tenant-Scoped RBAC**:
  - **Single Authoritative Data Plane (`server.ts` SQLite)**: All operational & PII records (`call_logs`, `handoff_tickets`, `appointments`, `integration_deliveries`, `support_tickets`, `audit_logs`) reside exclusively on the server-side SQLite store (`./data/vanivoice.db`), preventing browser split-brain drift and guaranteeing atomic non-truncated `DELETE /api/session/data` erasure across unlimited records.
  - **Google OIDC & Immediate Token-Version Revocation (`src/lib/firebase-admin.ts`, `src/utils/auth.ts`)**: Admins can sign in via Google OIDC (`POST /api/auth/firebase`, enforcing `email_verified === true` with opt-in `ADMIN_EMAIL` env var or `super_admin` promotion—zero hardcoded personal emails) or salted `scrypt` credentials. Role changes and revocations increment `token_version` and take effect immediately on the very next API request.
  - **Tenant-Scoped Firestore Security Rules (`firestore.rules`, `firebase-blueprint.json`)**: Firestore governs `/admins/{uid}`, `/users/{uid}`, and `/tenants/{tenantId}` directory metadata ONLY, strictly isolating `tenant_admin` access via `allowedTenants` and `memberUids` with super-admin-only RBAC management.
  - **Fail-Fast Production Startup (`verifyProductionSecurityConfig`)**: `npm start` refuses to boot in production unless `SESSION_SECRET` (>= 32 chars) and an admin protection mechanism (`ADMIN_PASSCODE`, `ADMIN_BOOTSTRAP_TOKEN`, or existing SQLite `super_admin`) exist.
- **Security Hardening, Redacted Logging & Code Splitting**:
  - **Minimal Public `/api/health` + Admin `/api/diagnostics`**: Public `/api/health` exposes only `{ status, timestamp }` readiness; DB counts, model name, heap usage, and Node version require admin authentication on `GET /api/diagnostics`.
  - **CSP & Structured JSON Logging (`src/utils/logger.ts`)**: Every response sets strict `Content-Security-Policy` (`frame-ancestors`, `object-src 'none'`, `base-uri 'self'`) and emits structured JSON logs with automatic token/secret redaction.
  - **Code-Split Production Bundle (`vite.config.ts`, `src/App.tsx`)**: Secondary admin tabs/modals are lazy-loaded with `React.lazy`, and `firebase`, `motion`, and `lucide-react` are split into dedicated Rollup chunks.
- **External Integrations, Safety Routing & Durable Confirmations**:
  - **RFC-5545 `.ics` Invites & SSRF-Guarded HMAC Webhooks (`src/utils/externalIntegration.ts`)**: Real calendar export and signed webhook deliveries with bounded retries and replay queue.
  - **Canonical `paramsHash` Confirmations & Slot Ledger (`src/utils/actionConfirmation.ts`)**: Double-booking guard, parameter-tampering protection, and idempotent replays.

---

## Local Setup & Scripts

```bash
# 1. Install dependencies cleanly across Windows / macOS / Linux (Node.js 22+, zero EBADENGINE warnings)
npm ci

# 2. Configure environment variables
cp .env.example .env

# 3. Development server (Express + Vite middleware on port 3000)
npm run dev

# 4. Run full ESLint check (TS/TSX + firestore.rules), TypeScript typecheck, and test suite
npm run lint
npm run typecheck
npm test

# 5. Production build & SQLite online backup/restore
npm run build
npm run db:backup
node scripts/db-backup.mjs restore data/backups/<backup-file>.db

# 6. Production run (requires SESSION_SECRET >= 32 chars + admin protection)
SESSION_SECRET="$(openssl rand -hex 32)" ADMIN_BOOTSTRAP_TOKEN="your-setup-token" npm start
```

---

## License

Licensed under the **Apache License 2.0** (`LICENSE`).
