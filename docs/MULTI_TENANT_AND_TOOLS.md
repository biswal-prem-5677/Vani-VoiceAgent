# Multi-Tenant Configuration, RAG & Tool Calling Guide

VaniVoice AI isolates every company behind a validated `TenantConfig` (`src/utils/schemas.ts`, SQLite `tenants` table) and restricts administrative reads/writes via role-based tenant scoping (`canAccessTenant`).

---

## 1. Public Summary vs. Admin Configuration Access

- **Caller / Unauthenticated Views (`GET /api/tenants`)**: Receive redacted tenant metadata (`isPublicSummaryOnly: true`) needed to switch active demo businesses in the Voice Console, while system prompts, internal escalation emails, and full knowledge documents stay protected on the server.
- **Tenant Admin & Super Admin Views**:
  - **Super Admin** (`allowedTenants: ['*']`): Creates new business tenants (`NewTenantModal.tsx` -> `POST /api/tenants`) and manages any tenant (`POST /api/tenants/:id`).
  - **Tenant Admin**: Reads and updates only the tenant IDs explicitly assigned to their account (`POST /api/auth/users`).
  - **Knowledge Base (`KnowledgeBaseTab.tsx`)** & **Voice Config (`VoiceConfigTab.tsx`)**: Prompt for `AdminAuthPanel` sign-in when accessed without an admin role.

---

## 2. Knowledge Retrieval (`src/utils/ragEngine.ts`)

1. Cross-lingual keyword and synonym expansion matches English, Odia, Hindi, and Hinglish concepts and extracts complete-sentence excerpts (`extractRelevantSentences`).
2. `POST /api/turn` merges top RAG matches (score `>= 0.15`) with a bounded `4000`-character digest of remaining tenant documents (`buildTenantSystemInstruction`), preventing prompt bloat even on larger tenant knowledge bases.
3. Unmatched queries in Offline Demo Mode use category-appropriate fallbacks rather than fabricating policy details.

---

## 3. Allowlisted Tool Execution & Durable Confirmations (`src/utils/tools.ts`, `server.ts`)

| Tool Name | Required Parameters | Confirmation Gate | Demo Behaviour / Sample Fixtures |
| --- | --- | --- | --- |
| `book_appointment` | `doctor`, `slot`, `patientName` | Server-enforced (`pending_actions`) | Validates required fields; requires explicit confirmation turn before returning `KAL-APT-XXXX` |
| `check_slot_availability` | `doctor` *(optional default)* | No | Returns sample OPD slots (`10:00 AM`, `11:30 AM`, `04:00 PM`, `05:30 PM`) |
| `track_shipment` | `orderId` | No | Looks up sample records `ORD-98421` (Bluedart), `ORD-58219` (DTDC), `ORD-10024` (Delhivery); rejects unknown IDs |
| `reschedule_delivery` | `orderId`, `newDate` | Server-enforced (`pending_actions`) | Requires pending server state + explicit confirmation before marking rescheduled |
| `check_batch_schedule` | `exam` *(optional default)* | No | Returns sample coaching batch schedule (`4:30 PM - 8:00 PM`) |
| `check_branch_cutoff` | `rank` *(number > 0)*, `branch` | No | Checks rank against sample cutoff (`18,500`) |

### Security Guarantees on Tool Calling
- **Per-Tenant Allowlist**: `server.ts` intersects any model `functionCall` against `tenant.tools`. Calls to tools not registered on the active tenant are rejected before execution.
- **Durable Confirmation State**: `book_appointment` and `reschedule_delivery` cannot bypass confirmation by passing `confirmed: true` on the first turn unless SQLite `pending_actions` holds a prior pending confirmation record for that `(session_id, tenant_id, tool_name)`.
- **Strict Tenant Lookup**: Passing an unknown `tenantId` to `/api/turn` or `/api/logs` returns `404 TENANT_NOT_FOUND` rather than falling back to another company's tenant.
