# VaniVoice AI — Multilingual Multi-Tenant Voice Agent Prototype

VaniVoice AI is a full-stack multilingual, multi-tenant voice agent prototype supporting **Odia (`or`)**, **Hindi (`hi`)**, **Hinglish (`hinglish`)**, **Bengali (`bn`)**, and **English (`en`)**. Each tenant operates with isolated knowledge bases, customizable voice personas, tool definitions, and automated safety/emergency escalation routing, powered server-side by the Google `@google/genai` SDK (`gemini-4-hydrogen` with automatic cooldown fallback to `gemini-3.1-flash-lite`) and Node 22 SQLite persistence.

---

## Key Capabilities

- **Multi-Tenant Architecture**: Pre-configured with 4 distinct tenants (`Kalinga Care Clinic`, `Pragati Coaching Academy`, `Konark Express Retail & Logistics`, `Utkal Tech Admissions Helpdesk`) plus UI support for creating custom tenants, uploading company documents, and editing voice personas/tools.
- **Dynamic Server-Side Generative AI (`/api/turn`)**:
  - Builds multi-turn conversation context (`buildGeminiConversationContents`) across turns.
  - Combines cross-lingual keyword RAG matching (`searchKnowledgeBase`) with the active tenant's full knowledge base digest and working call memory.
  - Executes server-side function calls (`book_appointment`, `check_slot_availability`, `track_shipment`, `reschedule_delivery`, `check_batch_schedule`, `check_branch_cutoff`, or custom tenant tools) and feeds results back to Gemini via `functionResponse` to synthesize natural, non-scripted spoken replies.
- **Multilingual Language Detection & Mid-Call Switching**: Detects Odia, Devanagari Hindi, Bengali, Hinglish (Latin code-switched), and English per turn (`src/utils/languageDetector.ts`) and adapts both the generated reply and browser STT/TTS locale.
- **Real-Time Browser Voice Controls**:
  - Web Speech API `SpeechRecognition` with ref-backed state synchronization (preventing stale closures), bounded exponential-backoff restarts, fatal error handling, and `language-not-supported` fallback (`src/components/LiveVoiceCall.tsx`, `src/utils/speechRecognition.ts`).
  - Turn-taking, audio orb state visualizer (`AudioOrb.tsx`), and manual barge-in speech interruption (`Interrupt (Barge-In)`).
  - Transparent handling of Odia TTS availability in browsers (displays native Odia script and notifies when using an Indian phonetic fallback voice).
- **Safety & Privacy Controls**:
  - Whole-word & Indic-script medical emergency detection (`src/utils/safety.ts`) immediately surfacing **112** guidance and duty-officer transfer requests.
  - Explicit human-escalation detection without false-triggering on informational `"agent"` / `"officer"` / `"humanities"` questions.
  - India DPDP-aligned consent banner (`ConsentBanner.tsx`), configurable retention window, and one-click `/api/user/wipe-all` data deletion (`LegalModal.tsx`).
- **Evaluation Harness & Widget Simulator**:
  - 16-case internal benchmark runner (`POST /api/benchmark/run`) measuring intent routing, tool selection, and execution latency.
  - Embeddable widget preview and live `curl` examples (`WidgetEmbedSimulator.tsx`).

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide Icons, Motion
- **Backend**: Node.js 22 (native ESM TypeScript type stripping via `node server.ts`), Express 4
- **Database**: Node built-in `node:sqlite` (`DatabaseSync`) stored in `./data/vanivoice.db` (automatically falls back to `/tmp/vanivoice-data` on read-only containers)
- **AI SDK**: `@google/genai` (`gemini-4-hydrogen` & `gemini-3.1-flash-lite`)

---

## Project Structure

```text
.
├── docs/
│   ├── API.md                    # REST API endpoint contracts & error codes
│   ├── ARCHITECTURE.md           # Pipeline, speech lifecycle, & Node 22 ESM design
│   └── PRIVACY_AND_SAFETY.md     # Safety emergency router & DPDP data lifecycle
├── public/
│   ├── icon.svg
│   ├── manifest.webmanifest      # PWA Web App Manifest
│   ├── robots.txt
│   └── sitemap.xml
├── src/
│   ├── components/
│   │   ├── AudioOrb.tsx          # Reactive voice state visualizer
│   │   ├── CallLogsTab.tsx       # Call history & transcript inspector
│   │   ├── ConsentBanner.tsx     # Microphone & transcript retention banner
│   │   ├── ErrorBoundary.tsx     # Top-level UI crash boundary
│   │   ├── EvaluationTab.tsx     # 16-case internal benchmark UI
│   │   ├── KnowledgeBaseTab.tsx  # Per-tenant document ingestion & search preview
│   │   ├── LegalModal.tsx        # Privacy policy, terms, & Wipe All Data action
│   │   ├── LiveVoiceCall.tsx     # Live STT/TTS call console & turn orchestration
│   │   ├── Navbar.tsx            # Navigation, utility modals, & tenant switcher
│   │   ├── NewTenantModal.tsx    # Custom company onboarding modal
│   │   ├── OfflineIndicator.tsx  # Network connectivity banner
│   │   ├── PWAInstallButton.tsx  # Installable PWA prompt control
│   │   ├── ShareModal.tsx        # Prototype link sharing modal
│   │   ├── SupportDeskModal.tsx  # Support ticket submission (/api/support/ticket)
│   │   ├── SystemStatusModal.tsx # Health & model diagnostics (/api/health)
│   │   ├── VoiceConfigTab.tsx    # Persona, fillers, & tool parameters editor
│   │   └── WidgetEmbedSimulator.tsx
│   ├── data/
│   │   ├── evalBenchmark.ts      # 16 multilingual benchmark test cases
│   │   ├── mockCallLogs.ts       # Sample historical call transcripts
│   │   └── tenants.ts            # Default tenant configurations
│   ├── types/
│   │   └── index.ts              # Shared TypeScript interfaces
│   ├── utils/
│   │   ├── callPipeline.ts       # Entity extraction & deterministic benchmark pipeline
│   │   ├── geminiTurnBuilder.ts  # Conversation history, system prompt, & tool builder
│   │   ├── languageDetector.ts   # Cross-script & Hinglish/Odia detector
│   │   ├── latencyTracker.ts     # Percentile metrics utility
│   │   ├── ragEngine.ts          # Cross-lingual keyword/synonym search & chunking
│   │   ├── safety.ts             # Medical emergency (112) & escalation checks
│   │   ├── speechRecognition.ts  # Pure STT error/backoff restart rules
│   │   ├── speechSynthesis.ts    # Browser SpeechSynthesis controller
│   │   ├── tools.ts              # Server/prototype tool handlers
│   │   ├── useOnlineStatus.ts
│   │   ├── usePWAInstall.ts
│   │   └── voiceEngine.test.ts   # Node native test runner suite (15 tests)
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── .env.example
├── index.html
├── metadata.json
├── package.json
├── server.ts                     # Express server + Vite dev middleware + API routes
├── tsconfig.json
└── vite.config.ts
```

---

## Local Setup & Commands

### Prerequisites
- Node.js `v22+` (uses `node:sqlite` and native `.ts` type stripping in production)
- A Gemini API key set via environment variable `GEMINI_API_KEY`

### Environment Variables
See `.env.example`:
- `GEMINI_API_KEY`: Required server-side key for `@google/genai` (never exposed to browser bundles).
- `APP_URL`: Optional hosted application base URL.
- `PORT`: Server port (defaults to `3000`).

### Scripts

```bash
# Install dependencies
npm install

# Run development server (Express + Vite middleware on port 3000)
npm run dev

# Run unit tests (Node test runner via tsx)
npm test

# Type-check with TypeScript
npm run lint

# Build frontend production bundle into dist/
npm run build

# Run production server (serves dist/ and /api/* via Node 22 native ESM)
NODE_ENV=production npm start
```

---

## Cloud Run / Production Notes

`"start": "node server.ts"` runs directly under Node.js 22 native ESM + type stripping:
- All relative server-side imports in `server.ts`, `src/data/*`, and `src/utils/*` use explicit `.ts` extensions and `import type` for type-only symbols.
- `vite` is dynamically imported only when `NODE_ENV !== 'production'`.
- SQLite initialization automatically falls back to `/tmp/vanivoice-data` if `./data` is not writable.

---

## License

Licensed under the **Apache License 2.0** (`LICENSE`).
