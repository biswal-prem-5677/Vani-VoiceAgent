# VaniVoice AI — Multilingual Multi-Tenant Voice Agent Prototype

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933.svg)](https://nodejs.org/)
[![Repository](https://img.shields.io/badge/GitHub-Vani--VoiceAgent-181717.svg)](https://github.com/biswal-prem-5677/Vani-VoiceAgent)

VaniVoice AI is a full-stack multilingual, multi-tenant voice agent prototype supporting **Odia (`or`)**, **Hindi (`hi`)**, **Hinglish (`hinglish`)**, **Bengali (`bn`)**, and **English (`en`)**. Each business tenant operates with isolated configuration, role-scoped administration, consent-enforced call logging, a persistent staff callback/handoff queue, and automated safety/emergency routing, powered server-side by `@google/genai` (`gemini-4-hydrogen` with automatic cooldown fallback to `gemini-3.1-flash-lite`), explicit Offline Demo Mode fallback when no API key is present, and Node 22 SQLite persistence.

> **Repository**: [https://github.com/biswal-prem-5677/Vani-VoiceAgent](https://github.com/biswal-prem-5677/Vani-VoiceAgent)

---

## Documentation Index

| Guide | Purpose |
| --- | --- |
| [Technical Architecture](docs/ARCHITECTURE.md) | End-to-end voice turn pipeline, RBAC auth model, Gemini tool loop, SpeechRecognition lifecycle, & Node 22 ESM |
| [REST API Reference](docs/API.md) | Authentication endpoints, scoped multi-tenant/log/handoff schemas, rate limits, & error codes |
| [Multi-Tenant & Tool Guide](docs/MULTI_TENANT_AND_TOOLS.md) | Tenant isolation, allowlisted server tool execution, durable confirmations, & RAG retrieval |
| [Privacy, Consent & Safety](docs/PRIVACY_AND_SAFETY.md) | Tenant-aware 112 emergency fast-path, durable `handoff_tickets` queue, & enforced DPDP zero-retention |
| [Deployment & Operations](docs/DEPLOYMENT.md) | Cloud Run / Dockerfile runtime, `ADMIN_PASSCODE` setup, CI workflow, SQLite cleanup worker, & Git sync |

---

## Key Capabilities

- **Role-Based Authentication & Tenant Isolation**:
  - In-memory HMAC-SHA256 signed bearer tokens (`src/utils/auth.ts`) — callers obtain scoped caller session tokens (`POST /api/auth/caller-session`), while tenant configuration, transcript audits, and handoff management require `tenant_admin` or `super_admin` roles (`POST /api/auth/bootstrap` for first-run setup or `POST /api/auth/login`).
  - Passwords are salted per-user and hashed with `crypto.scryptSync`.
  - Unauthenticated `/api/tenants` requests receive redacted public tenant summaries without system prompts, KB documents, or admin emails.
- **Dynamic Server-Side Generative AI (`POST /api/turn`) & Explicit Offline Demo Mode**:
  - Builds deduplicated multi-turn conversation context (`buildGeminiConversationContents`) with bounded (4000-char) knowledge digest injection.
  - Enforces per-tenant tool allowlists, server-verified confirmation state (`pending_actions`), and idempotency keys.
  - When `GEMINI_API_KEY` is unset, `POST /api/turn` returns `503 GEMINI_NOT_CONFIGURED` unless the user explicitly toggles **Offline Deterministic Demo Mode** (`demoMode: true`).
  - Surfaces real measured latency (`ragMs`, `modelResponseMs`, `totalTurnaroundMs`) with zero fabricated audio/STT constants.
- **Safety, Tenant-Aware Emergencies & Durable Staff Handoff Queue**:
  - Whole-word and Indic-script medical emergency detection (`src/utils/safety.ts`) prioritizes **112** emergency guidance without assuming every tenant is a hospital, and durably writes `critical` / `high` tickets (`HND-XXXXXX`) to SQLite `handoff_tickets`.
  - Admins can review, **Acknowledge**, and **Resolve** queued handoffs in `Call Transcripts` (`GET /api/handoffs`, `PATCH /api/handoffs/:id`).
- **Enforced DPDP Consent & Retention (`0`, `7`, `30`, `90` days)**:
  - Choosing **Ephemeral Only** or **Delete on call end (`0` days)** prevents transcript writes in `POST /api/logs`, immediately purges existing logs for that session, and avoids appending records client-side.
  - Expired records (`expires_at`) are swept automatically at startup and every 15 minutes.
- **Real-Time Browser Voice Controls**:
  - Web Speech API `SpeechRecognition` with synchronous ref-backed state tracking, bounded exponential-backoff restarts, fatal error handling, and `en-IN` fallback (`src/components/LiveVoiceCall.tsx`, `src/utils/speechRecognition.ts`).
  - Turn serialization via `inFlightTurnRef` + `AbortController`, barge-in interruption, PWA installability, offline indicator, and inline confirmation dialogs.

---

## Pre-Seeded Demo Tenants & Built-In Tools

| Tenant ID | Business | Default Language | Built-In Tools |
| --- | --- | --- | --- |
| `kalinga_clinic` | Kalinga Care Clinic (Bhubaneswar) | `or` | `book_appointment`, `check_slot_availability` |
| `pragati_coaching` | Pragati Coaching Academy (Cuttack) | `or` | `check_batch_schedule` |
| `konark_logistics` | Konark Express Retail & Logistics (Rourkela) | `hinglish` | `track_shipment`, `reschedule_delivery` |
| `utkal_university` | Utkal Tech Admissions Helpdesk | `en` | `check_branch_cutoff` |

> **Prototype Note**: Voice I/O runs in the browser via Web Speech API (`SpeechRecognition` / `SpeechSynthesis`), and the built-in tool handlers operate on deterministic sample records (`ORD-98421`, `ORD-58219`, `ORD-10024`) rather than external hospital EHR or courier carrier APIs.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide Icons, Motion
- **Backend**: Node.js 22+ (`node server.ts` native ESM type stripping), Express 4, Zod v4 runtime validation
- **Database**: Node built-in `node:sqlite` (`DatabaseSync`) stored in `./data/vanivoice.db` (falls back to `/tmp/vanivoice-data` on read-only containers)
- **AI SDK**: `@google/genai` (`gemini-4-hydrogen` primary + `gemini-3.1-flash-lite` cooldown fallback)

---

## Project Structure

```text
.
├── .github/workflows/ci.yml        # Automated CI pipeline (npm ci, test, lint, build)
├── docs/
│   ├── API.md                      # Authenticated REST API contracts & error codes
│   ├── ARCHITECTURE.md             # Turn pipeline, auth/RBAC, speech lifecycle, & Node 22 ESM
│   ├── DEPLOYMENT.md               # Dockerfile, Cloud Run, ADMIN_PASSCODE, & Git workflow
│   ├── MULTI_TENANT_AND_TOOLS.md   # Multi-tenant isolation, allowlisted tools, & RAG guide
│   └── PRIVACY_AND_SAFETY.md       # Emergency routing, handoff queue, & DPDP retention rules
├── public/
│   ├── icon.svg
│   ├── manifest.webmanifest
│   ├── robots.txt
│   └── sitemap.xml
├── src/
│   ├── components/
│   │   ├── AdminAuthPanel.tsx      # First-run admin claim & credential sign-in UI
│   │   ├── AudioOrb.tsx
│   │   ├── CallLogsTab.tsx         # Scoped transcript audit & Staff Handoff Queue console
│   │   ├── ConsentBanner.tsx       # Retention & ephemeral mode enforcement UI
│   │   ├── ErrorBoundary.tsx
│   │   ├── EvaluationTab.tsx       # 16-case Deterministic Routing Test Suite UI
│   │   ├── KnowledgeBaseTab.tsx    # Admin-gated per-tenant KB & search preview
│   │   ├── LegalModal.tsx          # Privacy policy, manifest, session & workspace deletion
│   │   ├── LiveVoiceCall.tsx       # Ref-safe STT/TTS console, turn lock & offline demo toggle
│   │   ├── Navbar.tsx
│   │   ├── NewTenantModal.tsx      # Super-admin tenant onboarding modal
│   │   ├── OfflineIndicator.tsx
│   │   ├── PWAInstallButton.tsx
│   │   ├── ShareModal.tsx
│   │   ├── SupportDeskModal.tsx
│   │   ├── SystemStatusModal.tsx
│   │   ├── VoiceConfigTab.tsx      # Admin-gated persona & tool settings editor
│   │   └── WidgetEmbedSimulator.tsx
│   ├── data/
│   │   ├── evalBenchmark.ts        # 16 multilingual routing test cases
│   │   ├── mockCallLogs.ts         # Marked sample historical logs (isSampleData: true)
│   │   └── tenants.ts              # Default 4 business tenant configurations
│   ├── types/
│   │   └── index.ts
│   ├── utils/
│   │   ├── auth.ts                 # Salted scrypt hashing, HMAC-SHA256 session tokens, & RBAC
│   │   ├── callPipeline.ts         # Deterministic offline demo pipeline & entity extraction
│   │   ├── geminiTurnBuilder.ts    # Deduplicated turns, 4000-char KB cap, & tool declarations
│   │   ├── languageDetector.ts
│   │   ├── latencyTracker.ts
│   │   ├── ragEngine.ts
│   │   ├── safety.ts               # Tenant-aware 112 routing & handoff reply builder
│   │   ├── schemas.ts              # Zod runtime validation schemas
│   │   ├── speechRecognition.ts
│   │   ├── speechSynthesis.ts
│   │   ├── tools.ts
│   │   ├── useOnlineStatus.ts
│   │   ├── usePWAInstall.ts
│   │   └── voiceEngine.test.ts     # 20 unit tests (node:test)
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── .env.example
├── .gitignore                      # Anchored /data/ rule so src/data/ remains tracked in Git
├── .nvmrc                          # Node 22
├── Dockerfile
├── LICENSE
├── index.html
├── metadata.json
├── package.json
├── package-lock.json
├── server.ts
├── tsconfig.json
└── vite.config.ts
```

---

## Local Setup & Scripts

```bash
# 1. Install dependencies cleanly (requires Node.js 22+)
npm install

# 2. Configure optional server environment variables
cp .env.example .env

# 3. Development server (Express + Vite middleware on port 3000)
npm run dev

# 4. Run 20 unit tests via Node native test runner + tsx
npm test

# 5. Type-check frontend + backend
npm run lint

# 6. Production build & run
npm run build
NODE_ENV=production npm start
```

---

## License

Licensed under the **Apache License 2.0** (`LICENSE`).
