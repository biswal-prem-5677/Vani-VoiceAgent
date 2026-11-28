# Privacy, Consent & Safety Guidelines

## 1. Tenant-Aware Emergency Fast-Path & Non-HIPAA Boundary (`src/utils/safety.ts`, `LegalModal.tsx`)

- **Regulatory & Clinical Boundary**: VaniVoice AI is a multilingual voice workflow prototype for front-desk scheduling and inquiry routing. It is **not** a certified medical device (CDSCO/FDA) and **not** a HIPAA-covered Electronic Health Record (EHR) platform. Callers must never submit regulated diagnostic charts or insurance claims into voice transcripts.
- Every incoming turn in `POST /api/turn` runs `checkEmergencyWithContext(contextTexts, activeLang, tenant, ticketId)` across the caller's latest message plus prior turn context **before** general model generation:
  - Matches acute life-threatening indicators across Odia, Hindi, Hinglish, Bengali, and English while filtering negated expressions (`"I do not have chest pain"`) and informational queries (`"emergency department hours"`).
  - Matches self-harm/crisis indicators across all supported languages and immediately returns India **Tele-MANAS (`14416`)** and emergency **112** directives alongside a `critical` callback ticket.
  - **Clinic Tenants (`category === 'clinic'`)**: Immediately instructs dialing **112** or visiting the nearest emergency hospital, logs a `critical` ticket in SQLite `handoff_tickets` (`30`-day retention expiry), and provides the clinic front-desk phone number (failing safe to still return the 112 guidance even if DB persistence fails).
  - **Non-Clinic Tenants**: Immediately advises dialing **112**, states clearly that the tenant is not a medical facility, and queues a ticket for that tenant's escalation desk.

---

## 2. Durable Staff Handoff Queue (`handoff_tickets`)

`checkHumanEscalationRequest(userText)` uses contextual whole-word regexes and Indic-script escalation tokens (preventing false triggers on `"Are you a human?"`, `"humanities"`, `"What can this agent do?"`, or `"campus officer"`). When triggered:
- A `HND-XXXXXXXX` record is persisted in server SQLite `handoff_tickets` with a `30`-day `expires_at` timestamp.
- Replies disclose honestly that the web system **queued a callback ticket** rather than claiming a live PSTN phone bridge.
- Scoped admins review, **Acknowledge**, and **Resolve** tickets via `Call Transcripts` (`GET /api/handoffs`, `PATCH /api/handoffs/:id`).

---

## 3. Data Privacy, Single Authoritative Store & Atomic Deletion

- **Single Authoritative Server Persistence**: All PII & operational state (`call_logs`, `handoff_tickets`, `appointments`, `integration_deliveries`, `support_tickets`, `audit_logs`) is stored strictly in server-side SQLite—never duplicated into client-side Firestore collections.
- **Explicit Consent & Retention Enforcement (`ConsentBanner.tsx`, `/api/consent`, `/api/logs`)**:
  - Retention options: `7`, `30`, `90`, or `0` days (`Delete on call end`). Choosing **Ephemeral Only** or `0` days purges prior session logs immediately and prevents persisting transcripts.
- **Disclosed Table Retention & Expiry Worker**:
  - **Handoff Tickets & Webhook Deliveries**: Auto-expire after **30 days**.
  - **Support Desk Tickets & Appointments**: Auto-expire after **90 days**.
  - **Pending Confirmations & Turn Idempotency Rows**: Expire after **24 hours**.
  - Background worker purges expired rows on startup and every 15 minutes.
- **Outbound Webhook SSRF Guard, Encryption at Rest & Signed Payloads**:
  - `validateOutboundWebhookUrl()` and DNS resolution guard block loopback, cloud metadata (`169.254.169.254`), TEST-NET/special-use IETF blocks, `.internal`/`.local`/`.nip.io`, and RFC1918 private networks unless `ALLOW_LOCAL_WEBHOOKS=true` is explicitly configured for local testing.
  - Per-tenant `webhookConfig.signingSecret` values are encrypted at rest with `AES-256-GCM` (`WEBHOOK_ENCRYPTION_KEY` or `SESSION_SECRET`) in SQLite and masked in read APIs. `verifyWebhookSignature` enforces a 300-second replay window by default.
- **Atomic Session Erasure (`LegalModal.tsx`, `DELETE /api/session/data`)**:
  - Permanently deletes **100% of records** (`call_logs`, `handoff_tickets`, `support_tickets`, `appointments`, `integration_deliveries`, `consent_records`, `pending_actions`) matching the caller's `sessionId` in SQLite without client pagination caps.
- **Access Revocation, CSP & Redacted Logs**:
  - Role edits and revocations increment `token_version` so stale Bearer tokens fail immediately (`401`).
  - HTTP structured logs recursively scrub `Authorization`, Bearer tokens, JWTs, Google API keys, passwords, and webhook secrets; `/api/health` exposes minimal `{ status, timestamp }` readiness while DB counts/system metrics/model names require admin authentication.
  - Strict `Content-Security-Policy` headers enforce `object-src 'none'`, `base-uri 'self'`, and configurable `frame-ancestors`.
