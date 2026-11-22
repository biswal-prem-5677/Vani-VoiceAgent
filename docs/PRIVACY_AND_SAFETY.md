# Privacy, Consent & Safety Guidelines

## 1. Medical Emergency Fast-Path (`src/utils/safety.ts`)

Every incoming turn in `/api/turn` runs `checkEmergencyCondition(userText, activeLang)` **before** general conversational generation:
- Matches critical emergency patterns across Odia, Hindi, Hinglish, Bengali, and English (e.g., chest pain, severe breathing difficulty, heavy bleeding, unconsciousness, stroke, severe trauma).
- Immediately returns a localized **Dial 112** emergency instruction, sets `isEmergency: true` and `shouldHandoff: true`, and logs an urgent escalation request in call memory.
- Healthcare tenant prompts also enforce a strict non-diagnostic boundary: the assistant provides clinic orientation, schedules, and preparation guidance, but does not diagnose conditions or prescribe treatments.

## 2. Human Escalation Routing

`checkHumanEscalationRequest(userText)` triggers a staff transfer (`shouldHandoff: true`) when callers express frustration or explicitly ask to speak/transfer to a human, manager, or supervisor. Whole-word and phrase patterns prevent false triggers on words like `"humanities"` or informational queries such as `"What can this voice agent do?"`.

## 3. Data Privacy & User Controls (India DPDP Alignment)

- **Consent Banner (`src/components/ConsentBanner.tsx`)**: Informs users that browser SpeechRecognition handles audio locally and lets them select a transcript retention policy (`7 days`, `30 days`, or `Delete on call end`), persisted via `POST /api/consent`.
- **Transcript Deletion (`CallLogsTab.tsx`, `LegalModal.tsx`)**:
  - `DELETE /api/logs/all` deletes all saved call transcripts.
  - `POST /api/user/wipe-all` wipes call logs, consent settings, support tickets, and custom tenants, resetting the workspace cleanly.
- **No Exposed Secrets**: `GEMINI_API_KEY` is accessed strictly server-side inside `server.ts` and is never bundled into client JavaScript.
- **Prompt-Injection Hygiene**: System instructions mark caller utterances and uploaded knowledge base documents as untrusted data.
