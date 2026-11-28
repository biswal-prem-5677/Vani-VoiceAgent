# Kalinga Care Multispeciality Clinic — FDE Pilot Case Study

## 1. Customer Workflow & Operational Pain Point
Kalinga Care Multispeciality Clinic (Bhubaneswar, Odisha) handles high daily front-desk call volumes across **Odia**, **Hindi**, **Hinglish**, **Bengali**, and **English**:
- **Front-desk bottlenecks**: Patients calling for OPD slot timings (Cardiology, Pediatrics, General Medicine), appointment scheduling, diagnostic lab timing, or cashless insurance queries wait on hold or abandon calls when staff cannot cover regional dialects consistently.
- **Safety triage boundary**: Callers occasionally report acute chest pain, breathlessness, or trauma on general inquiry lines, requiring immediate `112` medical emergency guidance and a structured callback ticket rather than generic chat replies.

---

## 2. Implemented FDE Architecture & Integrations
1. **Multilingual Voice & Text Turn Pipeline (`POST /api/turn`)**:
   - Detects and adapts mid-call across `or`, `hi`, `hinglish`, `bn`, and `en` using `detectLanguage()`.
   - Grounds clinical FAQ replies in tenant-specific retrieval (`searchKnowledgeBase`) and `@google/genai` server-side generation (with deterministic `Offline Demo Mode` fallback when `GEMINI_API_KEY` is unconfigured).
2. **Safety Fast-Path & Human Escalation Queue (`src/utils/safety.ts`, `/api/handoffs`)**:
   - Emergency indicators trigger an immediate **112** directive and persist a `critical` callback ticket (`HND-XXXXXX`) in SQLite `handoff_tickets` (`30`-day expiry).
   - Whole-word human escalation phrases create a `high`-priority callback ticket routed to the clinic front desk (`+91-674-2598110`) without falsely simulating live PSTN transfers (with negation guards preventing false escalation).
3. **Exact Tool Confirmation & Conflict-Safe Slot Ledger (`src/utils/actionConfirmation.ts`)**:
   - `check_slot_availability` computes open slots live from SQLite `appointments`.
   - `book_appointment` hashes business parameters (`paramsHash`) under an immutable `actionId` (`act_...`). Changing doctor/slot during confirmation automatically invalidates stale confirmation and prompts fresh verification. Double-booking `(tenant_id, LOWER(doctor), LOWER(slot)) WHERE status = 'confirmed'` is prevented atomically via a `BEGIN IMMEDIATE` transaction and partial unique SQLite index (`idx_appointments_unique_active_slot`), returning remaining open slots on conflict.
4. **External Systems Integration (`src/utils/externalIntegration.ts`)**:
   - **RFC-5545 Calendar Invites**: Callers and clinic staff download valid `.ics` invites (`GET /api/appointments/:id/calendar.ics`) directly from the console and admin ledger.
   - **HMAC-Signed EHR Webhooks**: Booking, cancellation, and handoff events queue outbound delivery rows (`pending`) and dispatch asynchronously off `/api/turn` via DNS-rebinding & redirect-protected POST payloads signed with a dedicated secret (`X-VaniVoice-Signature`), bounded retries, and manual replay in `integration_deliveries` (`POST /api/integrations/:id/retry`).

---

## 3. Single Authoritative Data Plane & RBAC Boundaries
- **Authoritative Storage**: Operational PII (`call_logs`, `handoff_tickets`, `appointments`, `integration_deliveries`, `support_tickets`, `audit_logs`) is stored **exclusively on the server-side SQLite database** (`./data/vanivoice.db`), with consistent online backup/restore via `scripts/db-backup.mjs`.
- **RBAC Isolation**:
  - Kalinga clinic coordinators hold `tenant_admin` (`allowedTenants: ['kalinga_clinic']`) and cannot read, mutate, or list other tenants (`konark_logistics`, `pragati_coaching`, `utkal_university`), nor elevate admin privileges in Firestore (`/admins/{uid}`).
  - Immediate revocation (`POST /api/auth/users/:id/revoke`) increments `token_version` so active Bearer sessions are blocked on the very next request.

---

## 4. Reference Pilot Acceptance Gates & Real-Session Telemetry (`GET /api/metrics/operational`)
The targets below serve as acceptance gates for a clinic deployment; in the local prototype workspace, `computeOperationalMetrics` excludes synthetic sample seed records and computes KPIs strictly from real completed caller sessions:

| KPI | Reference Pilot Target | Measurement Endpoint |
| --- | --- | --- |
| Self-Service Containment Rate | >= 65% target on routine OPD/FAQ turns | `GET /api/metrics/operational` (`containmentRatePct`) |
| Safety Fast-Path Routing Recall | 100% deterministic coverage (plus `14416` self-harm guard) | `POST /api/benchmark/run` & unit suite |
| Slot Collision Rate | 0% confirmed double-bookings + OPD slot validation | Partial unique index + `BEGIN IMMEDIATE` + `isValidClinicSlot` |
| Webhook Delivery Success | >= 98% target with async outbox + auto-retry + replay | `integration_deliveries` (`webhookSuccessRatePct`) |
| P95 Turnaround Latency | < 2,000 ms (live) / < 150 ms (safety fast-path) | Per-turn `p95LatencyMs` & metric summary |

---

## 5. Non-HIPAA Pilot Boundary & Rollout / Rollback Checklist
- **Regulatory Scope**: VaniVoice AI assists **front-desk scheduling & OPD FAQ logistics only**. It is **not** a CDSCO/FDA medical device or HIPAA-covered EHR; clinical chart data and diagnoses must never be collected in transcripts.
- **Rollout**: Set `SESSION_SECRET`, `ADMIN_BOOTSTRAP_TOKEN`, `WEBHOOK_SIGNING_SECRET`, `GEMINI_API_KEY`, and `CSP_FRAME_ANCESTORS` -> run `npm run db:backup` before schema/code updates -> verify `/api/health` and `POST /api/benchmark/run`.
- **Rollback**: Stop container -> run `node scripts/db-backup.mjs restore data/backups/<pre-release>.db` -> redeploy previous container tag -> verify `GET /api/health` returns `200 operational`.
