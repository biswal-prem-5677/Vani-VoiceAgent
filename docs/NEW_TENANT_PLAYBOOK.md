# New Tenant in 30 Minutes — FDE Onboarding Playbook

This operational runbook guides Forward Deployed Engineers (FDEs) through onboarding a new customer tenant on **VaniVoice AI** from initial kickoff to verified production webhook integration in under 30 minutes.

## Minutes 0–5: Identity & Workspace Access
1. Sign in as **Workspace Super-Admin** using **Google OIDC** (`Sign in with Google`) or your `ADMIN_BOOTSTRAP_TOKEN` / `ADMIN_PASSCODE` workspace login.
2. In **Call Transcripts -> Workspace Identity & Access Governance**, provision or promote the customer's operator email (`tenant_admin`) scoped strictly to their new `tenantId`.

## Minutes 5–15: Tenant Creation & Knowledge Grounding
1. Open the tenant switcher dropdown in the navbar and select **Deploy New Business Tenant...**.
2. Configure:
   - Unique `id` (e.g., `apollo_bhubaneswar`)
   - Domain category (`clinic`, `coaching`, `logistics`, `university`, `custom`)
   - Default language (`or`, `hi`, `hinglish`, `bn`, `en`) and voice persona speed/pitch
   - Escalation department desk phone & email (`humanHandoffContact`)
3. Open **Knowledge Base** and upload or author domain policy chunks (fees, schedules, SOPs, refund policies). Every turn runs grounded BM25/cross-lingual retrieval before Gemini responds.

## Minutes 15–22: External EHR / Webhook & Calendar Integration
1. Navigate to **Voice & Tools -> External EHR / Webhook Delivery & Calendar Export**.
2. Enable outbound webhooks and paste the customer's HTTPS endpoint URL (SSRF validation automatically rejects private RFC-1918, loopback, and metadata IPs).
3. Enter a customer-specific HMAC-SHA256 signing secret (or use the server `WEBHOOK_SIGNING_SECRET`).
4. Customers verify incoming events (`appointment.booked`, `appointment.cancelled`, `handoff.created`) by checking the `t=<timestamp>,v1=<hex>` signature header against `${timestamp}.${rawBody}`.
5. Confirmed clinic bookings immediately expose a `.ics` calendar export endpoint (`/api/appointments/:id/calendar.ics`) for both the caller and tenant admins.

## Minutes 22–30: Safety & End-to-End Verification
1. Run the deterministic safety & routing benchmark in **Eval Harness**.
2. Execute the optional live-provider Gemini harness when `GEMINI_API_KEY` is configured:
   ```bash
   npm run eval:live
   ```
3. Run a test appointment turn and emergency phrase in **Voice Console**:
   - Confirm appointment booking enforces 2-step confirmation with immutable `actionId` and parameter hash.
   - Verify **Call Transcripts -> FDE Operational Outcomes & Outbound EHR Deliveries** shows `delivered` status (or test 1-click **Retry Delivery** if upstream returns an error).
   - Verify emergency speech immediately queues a high-priority callback ticket and advisories (`112`) without making medical diagnoses.
