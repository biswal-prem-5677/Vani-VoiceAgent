# VaniVoice AI — Technical Architecture

## 1. End-to-End Voice Turn Pipeline

```text
Browser (LiveVoiceCall.tsx + App.tsx in-memory Bearer token)
  ├─ Web Speech API SpeechRecognition (or typed text / 1-click prompt)
  ├─ Ref-backed state sync (turnsRef, callMemoryRef, activeLanguageRef, isMutedRef, inFlightTurnRef)
  ├─ AbortController + strict single in-flight lock + idempotencyKey
  └─ POST /api/turn ──▶ Express Server (server.ts) + CSP + X-Trace-Id + Redacted JSON Logger
                          ├─ 1. Auth & Rate Limiters (Bearer verifySessionToken + token_version check, 60 turns/min/IP)
                          ├─ 2. Strict Tenant Lookup (404 TENANT_NOT_FOUND) + __turn__ Idempotency Cache
                          ├─ 3. Language Detection (or / hi / hinglish / bn / en)
                          ├─ 4. Safety Router (Tenant-Aware)
                          │     ├─ Emergency symptoms -> 112 advice + durable critical ticket (30d expiry)
                          │     └─ Explicit human transfer -> durable high ticket in handoff_tickets
                          ├─ 5. Entity Extraction + Cross-Lingual RAG Search (searchKnowledgeBase)
                          ├─ 6. Server AI Generation (or explicit Offline Demo Mode)
                          │     ├─ Gemini multi-turn history + bounded 4000-char KB digest
                          │     ├─ Per-tenant tool allowlist verification
                          │     └─ Exact paramsHash + immutable actionId confirmation gate
                          │           └─ Clinic SQLite appointments ledger & double-booking guard
                          └─ 7. JSON Response (real ragMs / modelResponseMs / totalTurnaroundMs) -> TTS + Transcript
```

---

## 2. Authentication, Firebase OIDC, Token-Version Revocation & Tenant RBAC

- **Fail-Fast Production Startup**: `npm start` (`node server.ts`) runs in production mode unless `--dev` or `NODE_ENV=development` is active. `verifyProductionSecurityConfig()` blocks startup if `SESSION_SECRET` is missing or `< 32` chars, or if no admin protection mechanism (`ADMIN_PASSCODE`, `ADMIN_BOOTSTRAP_TOKEN`, or existing SQLite `super_admin`) exists.
- **Google OIDC via Firebase Auth (`src/lib/firebase.ts`, `src/lib/firebase-admin.ts`)**: `POST /api/auth/firebase` verifies Firebase ID tokens via `firebase-admin/auth` (`verifyIdToken(idToken, process.env.FIREBASE_CHECK_REVOKED === 'true')`), enforces `email_verified === true`, and provisions verified users as least-privilege `caller` unless `ADMIN_EMAIL` env var is explicitly configured or promoted by an existing `super_admin`. **Zero personal emails are hardcoded in source or security rules.**
- **Immediate Token-Version & DB Re-Verification**: SQLite `users` stores `revoked` and `token_version`. Updating a role (`PATCH /api/auth/users/:id/role`) or revoking access (`POST /api/auth/users/:id/revoke`) increments `token_version`, invalidating previously issued Bearer JWTs immediately on the next request.
- **Firestore RBAC (`firestore.rules`, `firebase-blueprint.json`)**:
  - `/admins/{uid}`: Strictly readable only by owner or `super_admin` and writable/listable **only** by `super_admin`. `tenant_admin` accounts cannot modify `/admins/*` or escalate roles.
  - `/tenants/{tenantId}`: `get` requires `hasTenantAccess(tenantId)` (`super_admin` or `tenant_admin` with `tenantId in allowedTenants`); `list` requires `super_admin` or explicit `memberUids[uid] == true`. Public callers cannot enumerate Firestore tenant documents.

---

## 3. Single Authoritative Data Plane & Operational Stores

- **Authoritative Server Persistence (SQLite `vanivoice.db`)**: All operational & PII records reside strictly server-side across 10 SQLite tables (`tenants`, `call_logs`, `consent_records`, `support_tickets`, `handoff_tickets`, `pending_actions`, `users`, `appointments`, `integration_deliveries`, `audit_logs`).
- **No Sensitive Client-Side Replication**: Operational logs, handoffs, appointments, tickets, and audit records are never mirrored into browser-managed Firestore collections, eliminating dual-store sync drift, un-enforced client TTLs, and 100-doc deletion truncation.
- **Online Backup & Restore (`scripts/db-backup.mjs`)**: Uses SQLite `VACUUM INTO` for atomic hot backups and `PRAGMA integrity_check` before restore.
- **Automatic Expiry Worker**: Startup sweep + 15-minute `setInterval(...).unref()` deletes expired `call_logs`, `handoff_tickets` (30d), `integration_deliveries` (30d), `support_tickets` (90d), `appointments` (90d), and stale `pending_actions` (24h).

---

## 4. Exact Confirmations, External Integrations & Bundle Splitting

- **Canonical `paramsHash` + `actionId` Gate (`src/utils/actionConfirmation.ts`)**: Normalizes business arguments into SHA-256 `paramsHash`, blocks tampered confirmation parameters, prevents double-booking in `appointments`, and supports idempotent replays.
- **Signed Webhooks & `.ics` Calendar Export (`src/utils/externalIntegration.ts`)**: SSRF-protected `validateOutboundWebhookUrl()`, HMAC-SHA256 `X-VaniVoice-Signature`, bounded 3-attempt retries, manual `POST /api/integrations/:id/retry`, and RFC-5545 `.ics` export.
- **Frontend Code Splitting (`vite.config.ts`, `src/App.tsx`)**: Secondary tabs/modals load lazily via `React.lazy`, while Vite splits `firebase`, `motion`, and `lucide-react` into separate Rollup chunks.
- **Node 22 Native ESM (`node server.ts`)**: Pinning `firebase@12.19.0` with Node-22-safe sub-package overrides ensures clean `npm ci` without `EBADENGINE` warnings on Node 22.
