# VaniVoice AI — Technical Architecture

## 1. End-to-End Voice Turn Pipeline

```text
Browser (LiveVoiceCall.tsx + App.tsx in-memory Bearer token)
  ├─ Web Speech API SpeechRecognition (or typed text / 1-click prompt)
  ├─ Ref-backed state sync (turnsRef, callMemoryRef, activeLanguageRef, isMutedRef, inFlightTurnRef)
  ├─ AbortController + strict single in-flight lock + idempotencyKey
  └─ POST /api/turn ──▶ Express Server (server.ts)
                          ├─ 1. Auth & Rate Limiters (Bearer verifySessionToken, 60 turns/min/IP)
                          ├─ 2. Strict Tenant Lookup (404 TENANT_NOT_FOUND if invalid) + Idempotency Check
                          ├─ 3. Language Detection (or / hi / hinglish / bn / en)
                          ├─ 4. Safety Router (Tenant-Aware)
                          │     ├─ Emergency symptoms -> 112 advice + durable critical ticket in handoff_tickets
                          │     └─ Explicit human transfer -> durable high ticket in handoff_tickets (honest queue reply)
                          ├─ 5. Entity Extraction + Cross-Lingual RAG Search (searchKnowledgeBase)
                          ├─ 6. Server AI Generation (or explicit Offline Demo Mode)
                          │     ├─ Gemini multi-turn history + bounded 4000-char KB digest
                          │     ├─ Per-tenant tool allowlist verification
                          │     └─ Durable SQLite confirmation gate (pending_actions) -> functionResponse loop
                          └─ 7. JSON Response (real ragMs / modelResponseMs / totalTurnaroundMs) -> TTS + Transcript
```

---

## 2. Authentication, RBAC & In-Memory Token Architecture (`src/utils/auth.ts`, `App.tsx`)

- **Caller vs. Admin Sessions**:
  - Every browser visit acquires a short-lived `caller` token (`POST /api/auth/caller-session`) scoped to a unique `sessionId`, enabling voice turns, session-scoped DPDP consent/deletion, and session-only transcript recall without granting administrative visibility.
  - Administrative operations (viewing cross-tenant logs, modifying knowledge bases/voice configs, creating tenants, acknowledging/resolving queued handoff tickets, and global wipes) require a signed `tenant_admin` or `super_admin` token.
- **No Browser Storage of Tokens**: Bearer tokens reside strictly in React component memory (`App.tsx`), avoiding persistent browser-storage exposure.
- **Password Storage**: Administrator credentials stored in SQLite `users` use a random 16-byte salt per account with `crypto.scryptSync` and constant-time comparison (`crypto.timingSafeEqual`).

---

## 3. Generative AI, Tool Allowlists & Confirmation Persistence (`src/utils/geminiTurnBuilder.ts`, `server.ts`)

1. **Primary & Cooldown Fallback Models**:
   - Uses `gemini-4-hydrogen` (`ThinkingLevel.LOW`, `3500ms` timeout) with automatic 120-second cooldown failover to `gemini-3.1-flash-lite` on `429`/`503`/timeouts.
   - If `GEMINI_API_KEY` is unconfigured, the server does **not** silently fall back on live calls unless `demoMode: true` is explicitly toggled by the user.
2. **Bounded Context & Non-Scripted Guidance**:
   - `buildTenantSystemInstruction` supplies top RAG matches alongside up to `4000` characters of remaining tenant KB chunks so prompts remain predictable and cost-bounded.
3. **Per-Tenant Allowlists & Durable Confirmation (`pending_actions`)**:
   - Even if a model hallucinates an unauthorized tool name, `server.ts` blocks execution unless the tool is defined on that tenant.
   - Irreversible mock actions (`book_appointment`, `reschedule_delivery`) check SQLite `pending_actions` so `confirmed: true` cannot skip the confirmation turn.

---

## 4. Speech Recognition & Synthesis Lifecycle (`LiveVoiceCall.tsx`, `src/utils/speechRecognition.ts`, `src/utils/speechSynthesis.ts`)

- Synchronous ref + React state updaters prevent stale closures in long-lived Web Speech `onstart`, `onresult`, `onerror`, and `onend` listeners.
- `src/utils/speechRecognition.ts` classifies fatal (`not-allowed`, `service-not-allowed`) vs. benign (`no-speech`, `aborted`) errors, enforces bounded exponential backoff (`150ms`–`3000ms`), and cleans up timers on unmount.
- Transparently informs users when browser `speechSynthesis` lacks a native Odia (`or-IN`) voice and uses Indian phonetic fallback speech alongside native Odia script.

---

## 5. Persistence & Scheduled Retention Cleanup (`server.ts`)

- **7 SQLite Tables (`vanivoice.db`)**: `tenants`, `call_logs` (with `session_id`, `expires_at`), `consent_records`, `support_tickets`, `handoff_tickets`, `pending_actions`, and `users`.
- **Automatic Expiry Worker**: Startup sweep plus a 15-minute `setInterval(...).unref()` deletes rows where `expires_at <= Date.now()`.
- **Node 22 Native ESM (`node server.ts`)**: All server imports use explicit `.ts` extensions and `import type`, with Vite loaded lazily only when `NODE_ENV !== 'production'`.
