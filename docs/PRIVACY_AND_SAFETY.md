# Privacy, Consent & Safety Guidelines

## 1. Tenant-Aware Emergency Fast-Path (`src/utils/safety.ts`)

Every incoming turn in `POST /api/turn` runs `checkEmergencyCondition(userText, activeLang, tenant, ticketId)` **before** general model generation:
- Matches life-threatening symptom indicators across Odia, Hindi, Hinglish, Bengali, and English (chest pain, breathing difficulty, heavy bleeding, unconsciousness, stroke, major accidents).
- **Clinic Tenants (`category === 'clinic'`)**: Immediately instructs dialing **112** or visiting the nearest emergency hospital, logs a `critical` ticket in SQLite `handoff_tickets`, and includes the tenant desk phone number.
- **Non-Clinic Tenants**: Immediately advises dialing **112**, clarifies that the business tenant is not a medical facility (never falsely routing to a clinic Duty Medical Officer), and queues a callback ticket for that tenant's own escalation desk.

---

## 2. Durable Staff Handoff Queue (`handoff_tickets`)

`checkHumanEscalationRequest(userText)` uses whole-word regexes and Indic-script escalation tokens (preventing false triggers on `"humanities"`, `"What can this agent do?"`, or `"campus officer"`). When triggered:
- A `HND-XXXXXX` record is persisted in SQLite `handoff_tickets`.
- Replies state clearly that the web prototype has **queued a callback ticket** with the department's contact details rather than claiming a live PSTN phone bridge.
- Scoped admins can review, **Acknowledge**, and **Resolve** tickets via `Call Transcripts` (`GET /api/handoffs`, `PATCH /api/handoffs/:id`).

---

## 3. Data Privacy & DPDP-Aligned Retention Controls

- **Explicit Consent & Retention Enforcement (`ConsentBanner.tsx`, `/api/consent`, `/api/logs`)**:
  - Supported retention options: `7`, `30`, `90`, or `0` days (`Delete on call end`).
  - Choosing **Ephemeral Only** (`consented: false`) or `0` days deletes any stored logs for the current session immediately and prevents `POST /api/logs` from writing transcripts to SQLite (`persisted: false`).
  - Persisted logs receive an `expires_at` timestamp swept automatically on startup and every 15 minutes.
- **Scoped Data Deletion (`LegalModal.tsx`, `CallLogsTab.tsx`)**:
  - `DELETE /api/session/data`: Any caller can permanently erase logs, consent preferences, and pending action state for their active session.
  - `DELETE /api/logs/all`: Authorized admins erase logs only within `allowedTenants`.
  - `POST /api/user/wipe-all`: Restricted exclusively to `super_admin`; wipes all transcripts, consent records, handoffs, support tickets, pending actions, and custom tenants, then restores default demo tenants.
- **Security Headers & Input Caps**:
  - Zod runtime schemas validate every write endpoint; `/api/turn` caps `userText` (`1000` chars), `history` (`24` turns), and `memory` (`20` keys) and runs behind `60 req/min` per-IP turn rate limits.
  - Bearer tokens remain strictly in React memory (`App.tsx`) and `GEMINI_API_KEY` / `ADMIN_PASSCODE` / `SESSION_SECRET` remain strictly server-side.
