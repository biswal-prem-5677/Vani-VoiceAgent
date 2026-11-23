# Multi-Tenant Configuration, RAG & Tool Calling Guide

VaniVoice AI isolates every company behind a `TenantConfig` object (`src/types/index.ts`), allowing one codebase to serve healthcare, education, logistics, university admissions, or custom businesses simultaneously.

---

## 1. Tenant Data Model (`TenantConfig`)

Each tenant stored in SQLite (`tenants` table) defines:
- **Brand & Locale**: `id`, `name`, `tagline`, `category`, `primaryColor`, `accentColor`, `logoIcon`, `supportedLanguages`, `defaultLanguage`.
- **Voice Persona & Fillers**: `agentName`, `voicePersona` (`gender`, `speed`, `pitch`, `tone`, `provider`), localized `greetings`, and `fillers` spoken/shown while processing.
- **System Prompt & Handoff**: `systemPrompt` and `humanHandoffContact` (`department`, `phone`, `email`).
- **Knowledge Base (`KnowledgeChunk[]`)**: Domain chunks (`id`, `title`, `content`, `category`, `tags`, `addedAt`).
- **Tool Definitions (`TenantTool[]`)**: JSON parameter schemas exposed to Gemini as `FunctionDeclaration`s.

You can manage tenants directly in the admin tabs:
- **New Company (`NewTenantModal.tsx`)**: Onboard a new company via UI (`POST /api/tenants`).
- **Knowledge Base (`KnowledgeBaseTab.tsx`)**: Add, inspect, or remove company documents and test live keyword/cross-lingual retrieval.
- **Voice & Tools (`VoiceConfigTab.tsx`)**: Tune agent tone, speech speed/pitch, fillers, and tool definitions (`POST /api/tenants/:id`).

---

## 2. Knowledge Retrieval (`src/utils/ragEngine.ts`)

1. Incoming queries are normalized and expanded via cross-lingual synonym mappings (English, Hindi, Odia, and Hinglish terms for common domains like doctor fees, appointments, timings, delivery, refunds, and cutoffs).
2. `searchKnowledgeBase` scores matching `title`, `tags`, and `content` tokens and extracts whole-sentence excerpts (`extractRelevantSentences`) so answers never truncate mid-word.
3. On `/api/turn`, both the top 4 prioritized matches (threshold `>= 0.15`) and the tenant's full knowledge digest are supplied to Gemini so general and follow-up questions are answered naturally without rigid templates.

---

## 3. Built-In Tool Handlers (`src/utils/tools.ts`)

| Tool Name | Required Parameters | Confirmation Gate | Demo Behaviour / Sample Fixtures |
| --- | --- | --- | --- |
| `book_appointment` | `doctor`, `slot`, `patientName` | Requires `confirmed: true` | Prompts for missing fields or confirmation before generating a `KAL-APT-XXXX` booking ref |
| `check_slot_availability` | `doctor` *(defaults to General OPD)* | No | Returns sample OPD slots (`10:00 AM`, `11:30 AM`, `04:00 PM`, `05:30 PM`) |
| `track_shipment` | `orderId` | No | Looks up `ORD-98421` (Bluedart), `ORD-58219` (DTDC), `ORD-10024` (Delhivery); reports not found for unknown IDs instead of guessing |
| `reschedule_delivery` | `orderId`, `newDate` | Requires `confirmed: true` | Requests explicit confirmation before marking order rescheduled |
| `check_batch_schedule` | `exam` *(defaults to JEE Main)* | No | Returns upcoming coaching batch timings (`4:30 PM - 8:00 PM`) |
| `check_branch_cutoff` | `rank` *(number > 0)*, `branch` | No | Checks rank against sample cutoff (`18,500`) |
| *Custom tool names* | Any schema defined on tenant | No | Acknowledged cleanly and returned to Gemini for natural spoken synthesis |

---

## 4. Two-Step Confirmation Flow

For state-changing prototype tools (`book_appointment`, `reschedule_delivery`):
1. Gemini collects missing parameters naturally from the caller.
2. When all parameters are available, `buildGeminiToolDeclarations` exposes `confirmed?: boolean`. If `confirmed` is false/omitted, `executeTenantTool` returns `requiresConfirmation: true` and stores `pendingBooking` / `pendingAction` in working memory.
3. Once the caller explicitly confirms, Gemini invokes the tool with `confirmed: true` to finalize the action and clear pending flags via `extractMemoryUpdatesFromToolCall`.
