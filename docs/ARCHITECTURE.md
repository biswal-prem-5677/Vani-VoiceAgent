# VaniVoice AI — Technical Architecture

## 1. End-to-End Voice Turn Pipeline

```text
Browser (LiveVoiceCall.tsx + App.tsx in-memory Bearer token)
  ├─ Web Speech API SpeechRecognition (or typed text / 1-click prompt)
  ├─ Ref-backed state sync (turnsRef, callMemoryRef, activeLanguageRef, isMutedRef, inFlightTurnRef)
  ├─ AbortController + strict single in-flight lock + idempotencyKey
  └─ POST /api/turn ──▶ Express Server (server.ts) + X-Trace-Id propagation
                          ├─ 1. Auth & Rate Limiters (Bearer verifySessionToken, 60 turns/min/IP)
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

## 2. Authentication, Production Guards & RBAC (`src/utils/auth.ts`, `src/utils/actionConfirmation.ts`)

- **Fail-Fast Production Startup**: `npm start` (`node server.ts`) runs in production mode unless `--dev` or `NODE_ENV=development` is active. `verifyProductionSecurityConfig()` blocks production startup if `SESSION_SECRET` is missing or `< 32` chars, or if no admin protection mechanism (`ADMIN_PASSCODE`, `ADMIN_BOOTSTRAP_TOKEN`, or an existing SQLite `super_admin`) is present.
- **Protected Bootstrap**: If `ADMIN_BOOTSTRAP_TOKEN` is set, claiming first-run super-admin via `POST /api/auth/bootstrap` requires submitting the token in constant time.
- **No Browser Storage of Tokens**: Bearer tokens reside strictly in React component memory (`App.tsx`).
- **Password Storage**: Administrator credentials stored in SQLite `users` use a random 16-byte salt per account with `crypto.scryptSync` and constant-time comparison (`crypto.timingSafeEqual`).

---

## 3. Exact Confirmation Matching & Appointments Ledger (`server.ts`, `src/utils/actionConfirmation.ts`)

1. **Canonical Parameter Hashing (`canonicalizeToolParams`)**:
   - Strips confirmation control keys (`confirmed`, `actionId`), normalizes whitespace/casing, and hashes `{ toolName, params }` with SHA-256 into `paramsHash`.
   - When `book_appointment` or `reschedule_delivery` requires confirmation, SQLite `pending_actions` stores an immutable `actionId` (`act_<uuid>`) and `params_hash`.
   - Confirming with mismatched/tampered parameters fails safely back to a fresh confirmation prompt rather than committing altered arguments.
   - Confirmed rows transition atomically (`UPDATE pending_actions SET status = 'completed' WHERE id = ? AND status = 'pending'`) and store `result_json` for idempotent replay.
2. **SQLite Clinic Appointments Ledger (`appointments`)**:
   - `check_slot_availability` dynamically filters confirmed SQLite bookings for the requested doctor.
   - `book_appointment` prevents double-booking of `(tenant_id, doctor, slot)` across concurrent callers and inserts a `confirmed` appointment (`90`-day retention expiry).
   - Admins can inspect and cancel booked slots in `CallLogsTab.tsx` (`PATCH /api/appointments/:id`), immediately freeing the slot.

---

## 4. Speech Recognition & Synthesis Lifecycle (`LiveVoiceCall.tsx`, `src/utils/speechRecognition.ts`, `src/utils/speechSynthesis.ts`)

- Synchronous ref + React state updaters prevent stale closures in long-lived Web Speech `onstart`, `onresult`, `onerror`, and `onend` listeners.
- `src/utils/speechRecognition.ts` classifies fatal (`not-allowed`, `service-not-allowed`) vs. benign (`no-speech`, `aborted`) errors, enforces bounded exponential backoff (`150ms`–`3000ms`), and cleans up timers on unmount.

---

## 5. Persistence, Audit Trail & Scheduled Cleanup (`server.ts`)

- **9 SQLite Tables (`vanivoice.db`)**: `tenants`, `call_logs`, `consent_records`, `support_tickets`, `handoff_tickets`, `pending_actions`, `users`, `appointments`, and `audit_logs`.
- **Automatic Expiry Worker**: Startup sweep plus a 15-minute `setInterval(...).unref()` deletes expired `call_logs`, `handoff_tickets` (30d), `support_tickets` (90d), `appointments` (90d), and stale pending confirmations (24h).
- **Node 22 Native ESM (`node server.ts`)**: All server imports use explicit `.ts` extensions and `import type`, with Vite loaded lazily only when `--dev` or `NODE_ENV=development` is active.
