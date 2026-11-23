# Privacy, Consent & Safety Guidelines

## 1. Medical Emergency Fast-Path (`src/utils/safety.ts`)

Every incoming turn in `POST /api/turn` runs `checkEmergencyCondition(userText, activeLang)` **before** general conversational generation:
- Matches critical emergency patterns across Odia, Hindi, Hinglish, Bengali, and English (e.g., chest pain, severe breathing difficulty, heavy bleeding, unconsciousness, stroke, severe trauma).
- Immediately returns a localized **Dial 112** emergency instruction, sets `isEmergency: true` and `shouldHandoff: true`, and records an urgent escalation request in call memory (`escalationStatus: 'Transfer requested to Duty Medical Officer'`).
- Healthcare tenant prompts also enforce a strict non-diagnostic boundary: the assistant explains clinic departments, OPD timings, and appointment preparation, but does not diagnose conditions or prescribe treatments.

---

## 2. Human Escalation Routing

`checkHumanEscalationRequest(userText)` triggers a staff transfer (`shouldHandoff: true`) when callers express frustration or explicitly ask to speak/transfer to a human, manager, or supervisor. Whole-word and phrase patterns prevent false triggers on words like `"humanities"` or informational questions such as `"What services can this voice agent help me with today?"` or `"Is there a placement officer?"`.

---

## 3. Data Privacy & User Controls (India DPDP Alignment)

- **Consent Banner (`src/components/ConsentBanner.tsx`)**: Informs users that browser `SpeechRecognition` handles microphone audio through the browser speech engine and lets them select a transcript retention policy (`7`, `30`, or `90` days, or `0` = do not retain / delete on call end), persisted via `POST /api/consent`.
- **Transcript Deletion (`CallLogsTab.tsx`, `LegalModal.tsx`)**:
  - `DELETE /api/logs/all` deletes all saved call transcripts from `call_logs`.
  - `POST /api/user/wipe-all` wipes call logs, consent settings, support tickets, and custom tenants, then restores the default seeded demo tenants.
- **No Exposed Secrets**: `GEMINI_API_KEY` is accessed strictly server-side inside `server.ts` and is never bundled into client JavaScript.
- **Request Caps & Rate Limiting**:
  - Express enforces a `500kb` JSON body limit across routes.
  - `POST /api/turn` rejects inputs above `1000` characters and enforces an IP rate limit of `120 requests/min`.
- **Prompt-Injection Hygiene**: System instructions mark caller utterances and uploaded knowledge base documents as untrusted input data.

---

## 4. Prototype & Clinical Disclaimers

- **Demo Mode Notice**: This application is a functional prototype. Built-in tool handlers execute against sample local fixtures (`src/utils/tools.ts`) rather than external hospital EHR or courier carrier systems.
- **Not Medical Advice**: Clinic responses and emergency 112 routing are assistive workflow demonstrations only and do not replace licensed medical triage or emergency dispatch.
