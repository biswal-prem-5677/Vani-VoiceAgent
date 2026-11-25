# VaniVoice AI — REST API Reference

All routes are served by Express (`server.ts`) on port `3000` (or `process.env.PORT`) with Zod runtime validation (`src/utils/schemas.ts`), a `500kb` JSON body limit, `X-Trace-Id` correlation headers on every response, security headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy: microphone=(self)`, `Cache-Control: no-store` on `/api/*`), and bounded per-IP rate limiters (`180 req/min` general API, `60 req/min` on `/api/turn`, `15 req/min` on `/api/auth/bootstrap` & `/api/auth/login`).

---

## 1. Authentication & Session Endpoints

### `GET /api/session`
Returns authentication state (for optional `Authorization: Bearer <token>`), whether first-run super-admin claim is needed (`adminBootstrapNeeded`), whether `ADMIN_BOOTSTRAP_TOKEN` is enforced (`bootstrapRequiresToken`), whether `ADMIN_PASSCODE` is set (`passcodeConfigured`), retention policy disclosures (`defaultDays: 30`, `safetyTicketDays: 30`, `supportTicketDays: 90`, `appointmentDays: 90`, `options: [7, 30, 90, 0]`), and server Gemini availability.

### `POST /api/auth/caller-session`
Issues a 4-hour HMAC-SHA256 signed `caller` session token (`201 Created`) containing a fresh `sessionId` (`sess_<uuid>`).

### `POST /api/auth/bootstrap`
First-run claim endpoint (`201 Created`) creating the initial `super_admin` user in SQLite `users` using a per-user salted `crypto.scryptSync` password hash.
- When `ADMIN_BOOTSTRAP_TOKEN` is configured, `bootstrapToken` is required and verified in constant time (`403` if missing or invalid).
- Blocked if `ADMIN_PASSCODE` is configured (`403`) or if a super-admin already exists (`409`).

### `POST /api/auth/login`
Authenticates via registered SQLite email + password, or via server `ADMIN_PASSCODE` if configured (`timingSafeEqual`), returning `{ token, user }` and recording an `auth.login` audit event.

### `POST /api/auth/firebase`
Verifies a Firebase Google OIDC ID token server-side (`verifyIdToken`), enforces `email_verified === true`, auto-provisions the workspace primary `ADMIN_EMAIL` as `super_admin` (or loads an existing registered account), checks revocation status, and returns `{ token, user }`.

### `GET /api/auth/users` & `POST /api/auth/users` *(Super Admin only)*
Lists registered admin accounts (including `revoked` state) or provisions a scoped `tenant_admin` / `super_admin` with `allowedTenants`.

### `PATCH /api/auth/users/:id/role` & `POST /api/auth/users/:id/revoke` *(Super Admin only)*
Updates a user's `role` and `allowedTenants`, or revokes/restores workspace access (`{ revoked: boolean }`). Revoked users are blocked immediately on their next API request (`401`) and cannot re-exchange Firebase OIDC tokens (`403`).

---

## 2. Live Voice Turn & Test Harness

### `POST /api/turn` *(Authenticated: Bearer token)*
Rate-limited at `60 req/min` per IP. Validates input with `TurnRequestSchema` (`userText` max `1000` chars, `history` max `24` items, `memory` max `20` keys). Resolves `tenantId` strictly (`404 TENANT_NOT_FOUND` if missing/unknown) and caches whole-turn `idempotencyKey` responses cleanly under `tool_name = '__turn__'`.

- `latencyBreakdown.mode`: `'gemini_live' | 'offline_demo' | 'safety_fastpath'`
- When `GEMINI_API_KEY` is missing on the server, passing `demoMode: true` explicitly executes the deterministic offline demo pipeline (`src/utils/callPipeline.ts`) backed by the exact same server-side `executeServerToolWithDurability` ledger & confirmation gate; otherwise returns `503 GEMINI_NOT_CONFIGURED`.
- Critical emergencies and explicit human transfer requests write a ticket with `30`-day `expires_at` into SQLite `handoff_tickets` and return `handoffTicket` (`HND-XXXXXX`).

### `POST /api/benchmark/run` *(Authenticated: Bearer token)*
Executes all 16 cases in `src/data/evalBenchmark.ts` deterministically across their target tenants (`mode: 'deterministic_routing_harness'`).

---

## 3. Multi-Tenant Endpoints

### `GET /api/tenants`
- **Caller / Unauthenticated**: Returns redacted `TenantConfig[]` summaries (`isPublicSummaryOnly: true`).
- **Authenticated Admin**: Returns full configurations strictly filtered by `allowedTenants`.

### `GET /api/tenants/:id` *(Admin scoped)* & `POST /api/tenants/:id` *(Admin scoped)*
Reads or updates a tenant configuration validated by `TenantConfigSchema`.

### `POST /api/tenants` *(Super Admin only)*
Creates a new custom tenant (`201 Created`). Returns `409` on duplicate tenant ID.

---

## 4. Consent, Logs & Complete Session Deletion

### `POST /api/consent` *(Authenticated)*
Validates `{ consented: boolean, retentionDays: 0 | 7 | 30 | 90, tenantId? }`. If `consented === false` or `retentionDays === 0`, immediately purges any previously stored logs for the caller's `sessionId`.

### `POST /api/logs` *(Authenticated)*
Persists a validated `CallLog` (`201 Created`) **only** when the active session has granted consent with `retentionDays > 0` (`expires_at = now + retentionDays * 86400000`).

### `GET /api/session/logs` *(Authenticated)*
Returns call logs belonging strictly to the caller's active `sessionId`.

### `GET /api/logs?tenantId=...` *(Admin scoped)*
Returns persisted logs strictly scoped to the admin's `allowedTenants`.

### `DELETE /api/session/data` *(Authenticated)*
Deletes `call_logs`, `handoff_tickets`, `support_tickets`, `appointments`, `integration_deliveries`, `consent_records`, and `pending_actions` belonging strictly to the caller's `sessionId`, returning deleted row counts.

### `DELETE /api/logs/all` *(Admin scoped)* & `POST /api/user/wipe-all` *(Super Admin only)*
Deletes logs within the admin's authorized tenants (`/api/logs/all`), or wipes all transcripts, consent records, handoffs, appointments, integration deliveries, support tickets, audit logs, pending actions, and custom tenants and re-seeds default tenants (`/api/user/wipe-all`).

---

## 5. Staff Handoffs, Clinic Appointments, Webhooks, Metrics & Support

### `GET /api/handoffs?tenantId=...` & `PATCH /api/handoffs/:id` *(Admin scoped)*
Lists or updates (`'queued' | 'acknowledged' | 'resolved'`) tenant-scoped callback/emergency handoff tickets.

### `GET /api/appointments?tenantId=...` & `PATCH /api/appointments/:id` *(Admin scoped)*
Lists durable SQLite appointments (`KAL-APT-XXXX`, `actionId`, `doctor`, `slot`, `patientName`, `status`) or updates status (`'confirmed' | 'cancelled'`), releasing cancelled slots immediately for re-booking and dispatching `appointment.cancelled` webhooks if configured.

### `GET /api/appointments/:id/calendar.ics` *(Caller session or Admin scoped)*
Streams an RFC-5545 `text/calendar` `.ics` invite for the appointment. Callers may download invites only for appointments created in their own `sessionId`; admins may download within `allowedTenants`.

### `GET /api/integrations?tenantId=...` & `POST /api/integrations/:id/retry` *(Admin scoped)*
Lists durable outbound webhook delivery logs (`integration_deliveries`, `30`-day retention) signed with HMAC-SHA256 (`X-VaniVoice-Signature`) and allows manual re-dispatch of failed/pending deliveries. Tenant `webhookConfig.signingSecret` values are redacted (`configured` boolean + masked preview) in read responses.

### `GET /api/metrics/operational?tenantId=...` *(Admin scoped)*
Returns real-time FDE operational KPIs (`computeOperationalMetrics`), including total calls, containment rate, safety/escalation rate, tool confirmation rate, webhook delivery health, median/P95 response latencies, and language distribution.

### `GET /api/audit-logs?tenantId=...` *(Admin scoped)*
Returns up to 100 latest trace-correlated operational audit events (`traceId`, `actorId`, `actorRole`, `action`, `tenantId`, `targetId`, `metadata`).

### `GET /api/health`
Public diagnostics endpoint returning operational status, uptime, database table counts (`tenantsCount`, `logsCount`, `ticketsCount`, `handoffsOpenCount`, `appointmentsCount`), Gemini configuration flag, and Node stats.

### `POST /api/support/ticket`
Validates `{ name, email, subject?, message, tenantId? }` and persists a `VANI-XXXXXX` ticket (`201 Created`) with a `90`-day `expires_at` timestamp (and binds `session_id` if an authenticated `Bearer` token is present so caller privacy wipe also removes it).
