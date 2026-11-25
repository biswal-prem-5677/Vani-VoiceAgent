# VaniVoice AI — REST API Reference

All routes are served by Express (`server.ts`) on port `3000` (or `process.env.PORT`) with Zod runtime validation (`src/utils/schemas.ts`), a `500kb` JSON body limit, security headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy: microphone=(self)`, `Cache-Control: no-store` on `/api/*`), and bounded per-IP rate limiters (`180 req/min` general API, `60 req/min` on `/api/turn`, `15 req/min` on `/api/auth/bootstrap` & `/api/auth/login`).

---

## 1. Authentication & Session Endpoints

### `GET /api/session`
Returns authentication state (for optional `Authorization: Bearer <token>`), whether first-run super-admin claim is needed (`adminBootstrapNeeded`), whether `ADMIN_PASSCODE` is set, retention options (`[7, 30, 90, 0]`), and server Gemini availability.

### `POST /api/auth/caller-session`
Issues a 4-hour HMAC-SHA256 signed `caller` session token (`201 Created`) containing a fresh `sessionId` (`sess_<uuid>`). Allows callers to run live voice turns and manage consent/deletion strictly for their own session without admin privileges.

### `POST /api/auth/bootstrap`
First-run claim endpoint (`201 Created`) creating the initial `super_admin` user in SQLite `users` using a per-user salted `crypto.scryptSync` password hash. Blocked if `ADMIN_PASSCODE` is configured (`403`) or if a super-admin already exists (`409`).

### `POST /api/auth/login`
Authenticates via registered SQLite email + password, or via server `ADMIN_PASSCODE` if configured (`const-time` comparison), returning `{ token, user }`.

### `GET /api/auth/users` & `POST /api/auth/users` *(Super Admin only)*
Lists registered admin accounts or provisions a scoped `tenant_admin` / `super_admin` with `allowedTenants`.

---

## 2. Live Voice Turn & Test Harness

### `POST /api/turn` *(Authenticated: Bearer token)*
Rate-limited at `60 req/min` per IP. Validates input with `TurnRequestSchema` (`userText` max `1000` chars, `history` max `24` items, `memory` max `20` keys). Resolves `tenantId` strictly (`404 TENANT_NOT_FOUND` if missing/unknown) and supports `idempotencyKey` short-circuiting.

**Success Response (`200 OK`)**
```json
{
  "reply": "Dr. Jena is scheduled tomorrow morning. Would you like me to confirm that slot?",
  "language": "en",
  "switchedLanguage": false,
  "toolCalls": [],
  "shouldHandoff": false,
  "intent": "check_slot_availability",
  "model": "gemini-4-hydrogen",
  "memoryUpdates": { "doctor": "Dr. Jena (Cardiology)" },
  "latencyBreakdown": {
    "ragMs": 2,
    "modelResponseMs": 612,
    "totalTurnaroundMs": 616,
    "mode": "gemini_live",
    "streaming": false
  }
}
```
- `latencyBreakdown.mode`: `'gemini_live' | 'offline_demo' | 'safety_fastpath'` (no synthetic VAD/STT/TTS timings).
- When `GEMINI_API_KEY` is missing on the server, passing `demoMode: true` explicitly executes the deterministic offline demo pipeline (`src/utils/callPipeline.ts`); otherwise returns `503 GEMINI_NOT_CONFIGURED`.
- Critical emergencies and explicit human transfer requests write a ticket into SQLite `handoff_tickets` and return `handoffTicket` (`HND-XXXXXX`).

### `POST /api/benchmark/run` *(Authenticated: Bearer token)*
Executes all 16 cases in `src/data/evalBenchmark.ts` deterministically across their target tenants (`mode: 'deterministic_routing_harness'`).

---

## 3. Multi-Tenant Endpoints

### `GET /api/tenants`
- **Caller / Unauthenticated**: Returns redacted `TenantConfig[]` summaries (`isPublicSummaryOnly: true`, `systemPrompt` & `knowledgeBase` withheld, email masked).
- **Authenticated Admin**: Returns full configurations strictly filtered by `allowedTenants`.

### `GET /api/tenants/:id` *(Admin scoped)* & `POST /api/tenants/:id` *(Admin scoped)*
Reads or updates a tenant configuration validated by `TenantConfigSchema` (max 50 KB chunks, max 15 tools). Enforces `403 Forbidden` if tenant ID is outside `allowedTenants`.

### `POST /api/tenants` *(Super Admin only)*
Creates a new custom tenant (`201 Created`). Returns `409` on duplicate tenant ID.

---

## 4. Consent, Logs & Data Deletion

### `POST /api/consent` *(Authenticated)*
Validates `{ consented: boolean, retentionDays: 0 | 7 | 30 | 90, tenantId? }`. If `consented === false` or `retentionDays === 0`, immediately purges any previously stored logs for the caller's `sessionId`.

### `POST /api/logs` *(Authenticated)*
Persists a validated `CallLog` (`201 Created`) **only** when the active session has granted consent with `retentionDays > 0` (sets `expires_at = createdAt + retentionDays * 86400000`). If consent is missing or `retentionDays === 0`, returns `{ success: true, persisted: false }` without writing to SQLite.

### `GET /api/session/logs` *(Authenticated)*
Returns call logs belonging strictly to the caller's active `sessionId`.

### `GET /api/logs?tenantId=...` *(Admin scoped)*
Returns persisted logs strictly scoped to the admin's `allowedTenants`.

### `DELETE /api/session/data` *(Authenticated)*
Deletes `call_logs`, `consent_records`, and `pending_actions` belonging strictly to the caller's `sessionId`.

### `DELETE /api/logs/all` *(Admin scoped)* & `POST /api/user/wipe-all` *(Super Admin only)*
Deletes logs within the admin's authorized tenants (`/api/logs/all`), or wipes all logs, consent records, handoffs, support tickets, pending actions, and custom tenants and re-seeds the 4 default tenants (`/api/user/wipe-all`).

---

## 5. Staff Handoff Queue, Health & Support

### `GET /api/handoffs?tenantId=...` *(Admin scoped)*
Lists queued, acknowledged, and resolved callback/emergency tickets for the admin's authorized tenants.

### `PATCH /api/handoffs/:id` *(Admin scoped)*
Updates handoff ticket status (`'queued' | 'acknowledged' | 'resolved'`) and optional staff `notes`.

### `GET /api/health`
Public diagnostics endpoint returning operational status, uptime, database table counts (`tenantsCount`, `logsCount`, `ticketsCount`, `handoffsOpenCount`), Gemini configuration flag, and Node version/memory stats.

### `POST /api/support/ticket`
Validates `{ name, email, subject?, message, tenantId? }` and persists a `VANI-XXXXXX` ticket (`201 Created`).
