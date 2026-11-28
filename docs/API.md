# VaniVoice AI — REST API Reference

All routes are served by Express (`server.ts`) on port `3000` (or `process.env.PORT`) with Zod runtime validation (`src/utils/schemas.ts`), a `500kb` JSON body limit, sanitized `X-Trace-Id` correlation headers (`/^[a-zA-Z0-9_-]{8,64}$/`) on every response, structured redacted JSON HTTP logging (`src/utils/logger.ts`), `Content-Security-Policy` headers (`CSP_FRAME_ANCESTORS`, `object-src 'none'`, `base-uri 'self'`), security headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy: microphone=(self)`, `Cache-Control: no-store` on `/api/*`), explicit JSON `404` responses for unknown `/api/*` paths, and bounded per-IP rate limiters (`180 req/min` general API, `60 req/min` on `/api/turn`, `30 req/min` on `/api/auth/caller-session`, `15 req/min` on login/bootstrap/firebase auth endpoints, and `10 req/min` on `/api/support/ticket`).

---

## 1. Authentication & Session Endpoints

### `GET /api/session`
Returns authentication state (for optional `Authorization: Bearer <token>`), `adminBootstrapNeeded`, `bootstrapRequiresToken`, `passcodeConfigured`, retention policy disclosures (`defaultDays: 30`, `safetyTicketDays: 30`, `supportTicketDays: 90`, `appointmentDays: 90`, `options: [7, 30, 90, 0]`), and server Gemini availability (`modelUsed` is returned only to authenticated admins).

### `POST /api/auth/caller-session`
Rate-limited at `30 req/min` per IP. Issues a 4-hour HMAC-SHA256 signed `caller` session token (`201 Created`) with `iss`/`aud` claims and a fresh `sessionId` (`sess_<uuid>`).

### `POST /api/auth/bootstrap`
First-run claim endpoint (`201 Created`) wrapped in a `BEGIN IMMEDIATE` SQLite transaction creating the initial `super_admin` user in SQLite `users` using a non-blocking per-user salted `scrypt` password hash (minimum 12-character password, `token_version = 1`) and permanently locking `system_meta.bootstrap_completed`.
- When `ADMIN_BOOTSTRAP_TOKEN` is configured, `bootstrapToken` is required and verified in constant time (`403` if missing or invalid).
- Blocked if `ADMIN_PASSCODE` is configured (`403`) or if bootstrap was already completed (`409`).

### `POST /api/auth/login`
Authenticates via registered SQLite email + password (with constant-time dummy hash check when email is missing and per-email lockouts after 5 failures in 15 minutes), or via server `ADMIN_PASSCODE` if configured (`timingSafeEqual`), returning `{ token, user }` and recording an `auth.login` or `auth.login_failed` audit event.

### `POST /api/auth/firebase`
Verifies a Firebase Google OIDC ID token server-side (`verifyIdToken`, rejecting anonymous providers and enforcing `email_verified === true`), provisions new users as `caller` unless `ADMIN_EMAIL` env var explicitly matches, checks `revoked`, and returns `{ token, user }`.

### `GET /api/auth/users` & `POST /api/auth/users` *(Super Admin only)*
Lists registered admin accounts (including `revoked` state) or provisions a scoped `tenant_admin` / `super_admin` (minimum 12-character password) with `allowedTenants`.

### `PATCH /api/auth/users/:id/role` & `POST /api/auth/users/:id/revoke` *(Super Admin only)*
Updates a user's `role` and `allowedTenants`, or revokes/restores workspace access (`{ revoked: boolean }`). Refuses demoting or revoking the last active `super_admin` (`409 Conflict`). Both endpoints increment `token_version` in SQLite `users`, invalidating existing Bearer JWTs immediately (`401`).

---

## 2. Live Voice Turn & Test Harness

### `POST /api/turn` *(Authenticated: Bearer token)*
Rate-limited at `60 req/min` per IP (`RATE_LIMIT_TURN`). Validates input with `TurnRequestSchema` (`userText` max `1000` chars, `history` max `24` items, `memory` max `20` keys). Resolves `tenantId` strictly (`404 TENANT_NOT_FOUND` if missing/unknown) and caches whole-turn `idempotencyKey` responses cleanly under `tool_name = '__turn__'` with request-hash mismatch detection (`409 IDEMPOTENCY_CONFLICT`).

- `latencyBreakdown.mode`: `'gemini_live' | 'offline_demo' | 'safety_fastpath'`
- When `GEMINI_API_KEY` is configured in production, `demoMode: true` returns `403 DEMO_MODE_DISABLED` unless `ALLOW_DEMO_MODE=true`. When `GEMINI_API_KEY` is missing on the server, passing `demoMode: true` explicitly executes the deterministic offline demo pipeline (`src/utils/callPipeline.ts`) backed by `executeServerToolWithDurability`; otherwise returns `503 GEMINI_NOT_CONFIGURED`.
- Outbound webhooks from `demoMode: true` turns are suppressed unless `ALLOW_DEMO_WEBHOOKS=true` is explicitly enabled.
- Consequential actions (`book_appointment`, `reschedule_delivery`) require server-derived user confirmation (`evaluateUserConfirmation(userText)`) across distinct requests (`created_request_id !== req.traceId`) and validate clinic OPD slots (`isValidClinicSlot`).
- Critical medical emergencies (`112`) and self-harm/crisis indicators (**Tele-MANAS `14416` + `112`**) are evaluated across current and prior caller turn context (`checkEmergencyWithContext`), fail-safe against DB write issues, and queue `handoff_tickets` (`HND-XXXXXXXX`).

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

## 4. Consent, Logs & Atomic Full-Session Deletion

### `POST /api/consent` *(Authenticated)*
Validates `{ consented: boolean, retentionDays: 0 | 7 | 30 | 90, tenantId? }`. If `consented === false` or `retentionDays === 0`, immediately purges any previously stored logs for the caller's `sessionId`.

### `POST /api/logs` *(Authenticated)*
Persists a validated `CallLog` (`201 Created`) **only** when the active session has granted consent with `retentionDays > 0` (`expires_at = now + retentionDays * 86400000`). Enforces caller session ownership of `log.id` (`409 LOG_ID_CONFLICT` if another session owns that ID).

### `GET /api/session/logs` *(Authenticated)*
Returns call logs belonging strictly to the caller's active `sessionId`.

### `GET /api/logs?tenantId=...&limit=200&offset=0` *(Admin scoped)*
Returns persisted logs strictly scoped to the admin's `allowedTenants` with SQL-level pagination (`limit` capped at `500`, default `200`, `offset >= 0`).

### `DELETE /api/session/data` *(Authenticated)*
Atomically deletes **all** `call_logs`, `handoff_tickets`, `support_tickets`, `appointments`, `integration_deliveries`, `consent_records`, and `pending_actions` belonging strictly to the caller's `sessionId` (no 100-record client cap), returning deleted counts.

### `DELETE /api/logs/all` *(Admin scoped)* & `POST /api/user/wipe-all` *(Super Admin only)*
Deletes logs within authorized tenants (`/api/logs/all`), or wipes all operational tables and re-seeds defaults (`/api/user/wipe-all`).

---

## 5. Staff Handoffs, Clinic Appointments, Support Tickets, Webhooks & Health

### `GET /api/handoffs?tenantId=...&limit=200&offset=0` & `PATCH /api/handoffs/:id` *(Admin scoped)*
Lists or updates (`'queued' | 'acknowledged' | 'resolved'`) SQL-scoped callback/emergency handoff tickets.

### `GET /api/appointments?tenantId=...&limit=200&offset=0` & `PATCH /api/appointments/:id` *(Admin scoped)*
Lists durable SQLite appointments (`KAL-APT-XXXXXX`, `actionId`, `doctor`, `slot`, `patientName`, `status`) or updates status (`'confirmed' | 'cancelled'`), releasing cancelled slots immediately and dispatching `appointment.cancelled` webhooks if configured.

### `GET /api/appointments/:id/calendar.ics` *(Caller session or Admin scoped)*
Streams an RFC-5545 `text/calendar` `.ics` invite for the appointment. Callers may download invites only for appointments created in their own `sessionId`; admins may download within `allowedTenants`.

### `GET /api/integrations?tenantId=...&limit=100&offset=0` & `POST /api/integrations/:id/retry` *(Admin scoped)*
Lists durable outbound webhook delivery logs (`integration_deliveries`, `30`-day retention) signed with HMAC-SHA256 (`X-VaniVoice-Signature` using the AES-256-GCM decrypted tenant signing secret or `WEBHOOK_SIGNING_SECRET`, never `SESSION_SECRET`) and supports manual retry replay. Outbound URLs enforce trailing-dot stripping, TEST-NET/special-use IP blocking, DNS-resolution SSRF checks (`resolveAndValidateOutboundWebhookUrl`), and `redirect: 'error'`. Tenant `webhookConfig.signingSecret` values are masked (`********`) in read responses.

### `GET /api/metrics/operational?tenantId=...` *(Admin scoped)*
Returns FDE operational KPIs (`computeOperationalMetrics`) computed strictly from real non-sample caller sessions, covering total sessions, containment rate, handoff rate, booking completion, webhook delivery health, and median/P95 latencies.

### `GET /api/audit-logs?tenantId=...&limit=100&offset=0` *(Admin scoped)*
Returns SQL-scoped trace-correlated operational audit events (`traceId`, `actorId`, `actorRole`, `action`, `tenantId`, `targetId`, `metadata`). Global (`tenant_id IS NULL`) events are visible only to `super_admin`.

### `GET /api/health` *(Public readiness)*
Minimal liveness/readiness probe returning `{ status: 'operational', timestamp }` (`200`) or `{ status: 'degraded', timestamp }` (`500`). Does not expose DB counts, runtime versions, model names, or memory heap telemetry publicly.

### `GET /api/diagnostics` *(Admin scoped)*
Authenticated diagnostics endpoint returning SQLite table counts (`tenantsCount`, `logsCount`, `ticketsCount`, `handoffsOpenCount`, `appointmentsCount`), Gemini configuration flag, uptime, heap memory, and Node version.

### `POST /api/support/ticket`, `GET /api/support/tickets` & `PATCH /api/support/tickets/:id`
- `POST /api/support/ticket`: Validates `{ name, email, subject?, message, tenantId? }` and persists a `VANI-XXXXXXXX` ticket (`201 Created`) with a `90`-day `expires_at` timestamp (bound to `session_id` when authenticated so caller session deletion removes it).
- `GET /api/support/tickets` *(Admin scoped)* & `PATCH /api/support/tickets/:id` *(Admin scoped)*: Lists SQL-scoped support tickets and updates status (`'open' | 'in_progress' | 'resolved'`). Global untagged support tickets require `super_admin`.
