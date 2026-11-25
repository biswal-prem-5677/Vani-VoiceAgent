# Privacy, Consent & Safety Guidelines

## 1. Tenant-Aware Emergency Fast-Path (`src/utils/safety.ts`)

Every incoming turn in `POST /api/turn` runs `checkEmergencyCondition(userText, activeLang, tenant, ticketId)` **before** general model generation:
- Matches life-threatening symptom indicators across Odia, Hindi, Hinglish, Bengali, and English (chest pain, breathing difficulty, heavy bleeding, unconsciousness, stroke, major accidents).
- **Clinic Tenants (`category === 'clinic'`)**: Immediately instructs dialing **112** or visiting the nearest emergency hospital, logs a `critical` ticket in SQLite `handoff_tickets` (`30`-day retention expiry), and includes the tenant desk phone number.
- **Non-Clinic Tenants**: Immediately advises dialing **112**, clarifies that the business tenant is not a medical facility (never falsely routing to a clinic Duty Medical Officer), and queues a callback ticket for that tenant's own escalation desk.

---

## 2. Durable Staff Handoff Queue (`handoff_tickets`)

`checkHumanEscalationRequest(userText)` uses whole-word regexes and Indic-script escalation tokens (preventing false triggers on `"humanities"`, `"What can this agent do?"`, or `"campus officer"`). When triggered:
- A `HND-XXXXXX` record is persisted in SQLite `handoff_tickets` with a `30`-day `expires_at` timestamp.
- Replies state clearly that the web prototype has **queued a callback ticket** with the department's contact details rather than claiming a live PSTN phone bridge.
- Scoped admins can review, **Acknowledge**, and **Resolve** tickets via `Call Transcripts` (`GET /api/handoffs`, `PATCH /api/handoffs/:id`).

---

## 3. Data Privacy, Disclosed Retention Windows & Session Deletion

- **Explicit Consent & Retention Enforcement (`ConsentBanner.tsx`, `/api/consent`, `/api/logs`)**:
  - Call transcript retention options: `7`, `30`, `90`, or `0` days (`Delete on call end`).
  - Choosing **Ephemeral Only** (`consented: false`) or `0` days deletes any stored logs for the current session immediately and prevents `POST /api/logs` from writing transcripts to SQLite (`persisted: false`).
- **Safety, Support, Appointment & Webhook Retention Policy**:
  - **Safety / Handoff Tickets (`handoff_tickets`) & Webhook Deliveries (`integration_deliveries`)**: Auto-expire after **30 days**.
  - **Support Desk Tickets (`support_tickets`) & Clinic Appointments (`appointments`)**: Auto-expire after **90 days**.
  - **Stale Pending Confirmations (`pending_actions`)**: Expire after **24 hours**.
  - An automated background worker sweeps expired rows across all tables on startup and every 15 minutes.
- **Outbound Webhook SSRF Guard & Signed Payloads**:
  - Tenant webhook targets are validated by `validateOutboundWebhookUrl()` to block loopback (`127.0.0.1`, `localhost`, `::1`), cloud metadata endpoints (`169.254.169.254`), and RFC1918 private networks (`10.x`, `172.16-31.x`, `192.168.x`) unless `ALLOW_LOCAL_WEBHOOKS=true` is explicitly enabled. Payloads are signed with HMAC-SHA256 (`X-VaniVoice-Signature`), and tenant `signingSecret` values are redacted from read endpoints.
- **Complete Session-Scoped Deletion (`LegalModal.tsx`, `DELETE /api/session/data`)**:
  - Callers can permanently erase all **call logs, safety handoff tickets, support tickets, appointments, outbound webhook deliveries, consent records, and pending confirmations** tied to their active `sessionId`.
  - `DELETE /api/logs/all`: Authorized admins erase logs only within `allowedTenants`.
  - `POST /api/user/wipe-all`: Restricted exclusively to `super_admin`; wipes all operational tables and restores default demo tenants.
- **Access Revocation, Traceability & Firestore Rules**:
  - Role edits and user revocations (`POST /api/auth/users/:id/revoke`) take effect immediately on the next API request because SQLite `users` is re-checked server-side on every authenticated call.
  - Every response carries an `X-Trace-Id` header and operational mutations are recorded in `audit_logs`.
  - Cloud Firestore collections are protected by Eight-Pillar `firestore.rules` (owner-only/admin-only queries and role validation, tested via `firestore.rules.test.ts`).
  - Bearer tokens remain strictly in React memory (`App.tsx`), never `localStorage`/`sessionStorage`, and `GEMINI_API_KEY`, `SESSION_SECRET`, `ADMIN_BOOTSTRAP_TOKEN`, `ADMIN_PASSCODE`, and `WEBHOOK_SIGNING_SECRET` remain strictly server-side.
