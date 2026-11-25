# Firestore Security Specification

## 1. Data Invariants
1. **Master Auth & Verified Identity**: Every read and write (except `/test/connection` probe) requires `request.auth != null` and `request.auth.token.email_verified == true`.
2. **Zero Hardcoded Personal Emails**: Neither `firestore.rules` nor `server.ts` hardcodes any personal email address; opt-in `ADMIN_EMAIL` stays strictly server-side in env config.
3. **Strict Super-Admin vs. Tenant-Admin RBAC**:
   - `isSuperAdmin()` checks `/admins/$(uid).role == 'super_admin'`.
   - `hasTenantAccess(tenantId)` checks `isSuperAdmin()` or `role == 'tenant_admin'` with `tenantId in allowedTenants`.
   - `/admins/{uid}` reads are owner/super-admin only; writes/lists are **strictly `isSuperAdmin()`**, preventing `tenant_admin` privilege escalation.
4. **Tenant Isolation & Single Operational Data Plane**:
   - `/tenants/{tenantId}` blocks open `get`/`list` by verified users (`get` requires `hasTenantAccess(tenantId)`; `list` requires `isSuperAdmin()` or `memberUids[uid] == true`).
   - Operational/PII collections (`callSessions`, `handoffs`, `appointments`, `integrations`, `supportTickets`, `auditLogs`) are denied on client Firestore by the global default-deny net and persisted exclusively in the authoritative server SQLite store.
5. **Strict Schema Keys & Immutable Ownership**: Exact `.hasAll()` / `.hasOnly()` allowlists, bounded string lengths, safe `isValidId()`, server `request.time`, and immutable `createdAt`/`ownerUid`.
