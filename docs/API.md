# VaniVoice AI — REST API Reference

All routes are served by Express on port `3000` (or `process.env.PORT`). JSON request bodies are capped at `500kb` across the server.

---

## 1. Live Voice Turn Pipeline

### `POST /api/turn`
Processes a caller utterance through language detection, safety checks, RAG retrieval, and server-side Gemini generation + tool calling. Rate-limited at `120 requests/min` per IP (`X-Forwarded-For` or socket IP).

**Request Body**
```json
{
  "tenantId": "kalinga_clinic",
  "userText": "Can you check what slots Dr. Jena has available today and tell me the fee?",
  "language": "en",
  "memory": { "patientName": "Rajesh" },
  "history": []
}
```
- `userText` *(string, required, max 1000 chars)*
- `tenantId` *(string, optional)* — defaults to first seeded tenant (`kalinga_clinic`) if omitted or unknown
- `language` *(SupportedLanguage, optional)* — `'or' | 'hi' | 'hinglish' | 'bn' | 'en'`
- `memory` *(Record<string, string>, optional)* — current working call slots
- `history` *(CallTurn[], optional)* — prior conversation turns

**Success Response (`200 OK`)**
```json
{
  "reply": "Dr. Jena has available slots today at 10:00 AM, 11:30 AM, 04:00 PM, and 05:30 PM. The consultation fee is ₹500...",
  "language": "en",
  "switchedLanguage": false,
  "toolCalls": [
    {
      "name": "check_slot_availability",
      "result": {
        "success": true,
        "toolName": "check_slot_availability",
        "data": { "doctor": "Dr. Jena (Cardiology)", "availableSlots": ["10:00 AM", "11:30 AM", "04:00 PM", "05:30 PM"] }
      }
    }
  ],
  "shouldHandoff": false,
  "intent": "check_slot_availability",
  "model": "gemini-4-hydrogen",
  "memoryUpdates": { "doctor": "Dr. Jena (Cardiology)", "day": "Today" },
  "latencyBreakdown": {
    "vadMs": 15,
    "sttMs": 25,
    "ragMs": 5,
    "llmFirstTokenMs": 1054,
    "ttsFirstAudioMs": 15,
    "totalTurnaroundMs": 1076
  }
}
```

When an emergency or explicit human escalation is triggered, `shouldHandoff` is `true` (with `isEmergency: true` for 112 safety routes), `handoffReason` is populated, and `intent` is `'emergency_medical'` or `'human_escalation'`.

**Error Responses**
| Status | Code | Meaning |
| --- | --- | --- |
| `400` | — | Missing `userText` or exceeds 1000-char limit |
| `400` | `INVALID_ARGUMENT` | Upstream model rejected request payload |
| `403` | `API_KEY_INVALID` | Invalid or insufficient Gemini API key scopes |
| `429` | — / `RESOURCE_EXHAUSTED` | IP rate limit (`120 req/min`) or Gemini quota exceeded |
| `502` | `MODEL_NOT_FOUND` / `UPSTREAM_AI_ERROR` / `EMPTY_MODEL_RESPONSE` | Upstream model failure (surface Retry UI) |
| `503` | `GEMINI_NOT_CONFIGURED` | `GEMINI_API_KEY` not set on server |

---

## 2. Multi-Tenant Configuration

### `GET /api/tenants`
Returns all persisted `TenantConfig[]` records from SQLite.

### `POST /api/tenants`
Creates a new custom tenant (`201 Created`). Requires `id` and `name`.

**Response (`201 Created`)**: `{ "success": true, "tenant": { ... } }`

### `POST /api/tenants/:id`
Replaces/updates an existing tenant configuration (including knowledge base chunks, voice settings, fillers, and tools).

**Response (`200 OK`)**: `{ "success": true, "tenant": { ... } }`

---

## 3. Call Logs & Privacy Management

### `GET /api/logs?tenantId=...`
Lists stored `CallLog[]` records ordered newest-first (optionally filtered by `tenantId`).

### `POST /api/logs`
Persists a completed `CallLog` (`201 Created`). Requires `id` and `tenantId`.

### `DELETE /api/logs/all`
Deletes all call transcript records from `call_logs`.

### `POST /api/consent`
Stores microphone/audio retention consent (`{ consented: boolean, retentionDays: number }`).

### `POST /api/user/wipe-all`
Permanently deletes all `call_logs`, `user_settings`, `support_tickets`, and custom `tenants`, then restores default seeded tenants.

---

## 4. Operations, Support & Benchmark

### `GET /api/health`
Returns operational status, server timestamp, uptime, SQLite table counts, Gemini configuration status, heap memory usage, and Node version.

**Sample Response (`200 OK`)**
```json
{
  "status": "operational",
  "timestamp": 1763890000000,
  "uptimeSeconds": 42,
  "database": {
    "type": "sqlite",
    "status": "connected",
    "tenantsCount": 4,
    "logsCount": 4,
    "ticketsCount": 0
  },
  "geminiAi": {
    "configured": true,
    "model": "gemini-4-hydrogen"
  },
  "systemMetrics": {
    "memoryMb": 48,
    "nodeVersion": "v22.x.x"
  }
}
```

### `GET /api/session`
Returns workspace session metadata, retention policy options (`[7, 30, 90, 0]` days, default `30`), `serverAiActive`, and `modelUsed`.

### `POST /api/support/ticket`
Validates `{ name, email, subject?, message }` (checking required fields and email syntax) and persists a tracked support ticket in SQLite (`201 Created` with generated `VANI-XXXXXX` `ticketId`).

### `POST /api/benchmark/run`
Executes all 16 cases in `src/data/evalBenchmark.ts` across their target tenants using deterministic intent/safety/tool evaluation and returns `{ totalCases, passedCount, overallAccuracy, avgLatency, cases }`.
