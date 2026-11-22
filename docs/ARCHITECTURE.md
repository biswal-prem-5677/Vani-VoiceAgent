# VaniVoice AI — Technical Architecture

## 1. End-to-End Voice Turn Pipeline

```text
Browser (LiveVoiceCall.tsx)
  ├─ Web Speech API SpeechRecognition (or typed text / 1-click prompt)
  ├─ Ref-backed state sync (turnsRef, callMemoryRef, activeLanguageRef, isMutedRef, callActiveRef)
  ├─ AbortController + isProcessingTurn lock (prevents out-of-order concurrent turns)
  └─ POST /api/turn ──▶ Express Server (server.ts)
                          ├─ 1. IP Rate Limiter (120 req/min)
                          ├─ 2. Language Detection (or / hi / hinglish / bn / en)
                          ├─ 3. Safety Router
                          │     ├─ Emergency symptoms -> immediate 112 response + handoff
                          │     └─ Explicit human transfer -> handoff notice
                          ├─ 4. Entity Extraction (extractEntitiesFromInput) + RAG Search (searchKnowledgeBase)
                          ├─ 5. Gemini Multi-Turn Generation (gemini-4-hydrogen / gemini-3.1-flash-lite)
                          │     ├─ Full conversation history (buildGeminiConversationContents)
                          │     ├─ Full tenant KB digest + handoff contact + active working memory
                          │     └─ Tool loop (up to 2 rounds): executeTenantTool -> functionResponse -> Gemini reply
                          └─ 6. JSON Response -> Browser SpeechSynthesis (TTS) + Transcript & Working Memory HUD
```

---

## 2. Generative AI & Tool Synthesis (`src/utils/geminiTurnBuilder.ts`, `server.ts`)

1. **Primary & Cooldown Fallback Models**:
   - Uses `gemini-4-hydrogen` (`ThinkingLevel.LOW`, `3500ms` abort timeout) as the primary model.
   - Auth errors (`401`/`403`) fail fast and surface clear feedback to the client.
   - On `503 UNAVAILABLE`, `429 RESOURCE_EXHAUSTED`, or timeout, `server.ts` places the primary model on a 120-second cooldown and uses `gemini-3.1-flash-lite` (with one transient retry after `450ms`) so ongoing call turns remain fast and uninterrupted.
   - Upstream errors are never masked by scripted fallbacks on `/api/turn`; non-2xx responses return structured `{ error, code, retryable }` JSON rendered by `LiveVoiceCall.tsx` with a **Retry** button.

2. **Full Knowledge & Open-Ended Question Handling**:
   - `searchKnowledgeBase` ranks the top 4 keyword/cross-lingual matches.
   - `buildTenantSystemInstruction` injects both the prioritized RAG hits and the full tenant `knowledgeBase` digest alongside `humanHandoffContact` and `workingMemory`, instructing Gemini to answer general/adjacent questions thoughtfully without fabricating company-specific facts or outputting canned templates.

3. **Non-Scripted Function Calling Loop**:
   - `buildGeminiToolDeclarations` converts `tenant.tools` into `@google/genai` `FunctionDeclaration` schemas (automatically adding an optional `confirmed: boolean` parameter for `book_appointment` and `reschedule_delivery`).
   - When Gemini emits `functionCall` parts, the server runs `executeTenantTool(...)`, updates structured call memory via `extractMemoryUpdatesFromToolCall`, appends both the model `functionCall` content and server `functionResponse` content, and calls Gemini again so the final reply is naturally phrased in the customer's language.

---

## 3. Speech Recognition Lifecycle (`LiveVoiceCall.tsx` & `src/utils/speechRecognition.ts`)

To prevent stale closures inside long-lived `SpeechRecognition` callbacks (`onstart`, `onresult`, `onerror`, `onend`):
- **Synchronous ref+state updaters**: `updateCallActive`, `updateIsMuted`, `updateActiveLanguage`, `updateCallMemory`, `updateTurns`, `updateHumanHandoff`, and `updateLastLatency` mutate refs synchronously alongside React state updates.
- **Latest handler ref**: `handleUserSpokeRef.current` is refreshed every render and invoked from `recognition.onresult`.
- **Safe auto-restart**: Pure rules in `src/utils/speechRecognition.ts` classify fatal (`not-allowed`, `service-not-allowed`) vs benign (`no-speech`, `aborted`) errors, compute bounded exponential backoff (`150ms` normal, `200ms`–`3000ms` error backoff, halted after 5 consecutive errors), fall back to `en-IN` on `language-not-supported`, and clean up timers + recognition handlers on unmount.

---

## 4. Persistence & Node 22 Native ESM Production Runtime

- **Database**: `node:sqlite` (`DatabaseSync`) initializes 4 tables in `vanivoice.db`: `tenants`, `call_logs`, `user_settings`, and `support_tickets`. Default tenants and sample call logs are seeded only when tables are empty.
- **Node 22 Native Type Stripping (`node server.ts`)**:
  - `server.ts` and all server-imported modules (`src/data/*`, `src/utils/*`) use explicit `.ts` file extensions on relative imports and `import type` for TypeScript-only symbols.
  - Vite is imported lazily (`await import('vite')`) only when `NODE_ENV !== 'production'`.
  - In production (`NODE_ENV=production`), `server.ts` serves static assets from `dist/` and `public/`.

---

## 5. Offline Deterministic Evaluation Harness (`POST /api/benchmark/run`)

While live caller turns use Gemini generation via `/api/turn`, `POST /api/benchmark/run` runs the 16 test cases from `src/data/evalBenchmark.ts` deterministically through `detectLanguage`, `safety`, and `processTurn` (`src/utils/callPipeline.ts`) to evaluate baseline routing accuracy, safety triggers, and execution latency without consuming LLM quota.
