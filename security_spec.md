# Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Master Auth & Verified Identity**: Every read and write (except `/test/connection` health probe) requires `request.auth != null` and `request.auth.token.email_verified == true`.
2. **No Self-Elevated Roles**: Users can create `/users/{uid}` only with `role == 'caller'` and `revoked == false`; only an existing `isAdmin()` can promote roles, set `revoked`, or write to `/admins/{uid}`.
3. **Owner & Tenant Isolation**: Callers can only create/read/delete their own `ownerUid == request.auth.uid` documents (`callSessions`, `handoffs`, `appointments`, `supportTickets`); cross-record listing requires `resource.data.ownerUid == request.auth.uid || isAdmin()`.
4. **Immutable Audit & Creation Metadata**: `createdAt` and `ownerUid` cannot change after creation; `createdAt` and `updatedAt` must equal `request.time`; `/auditLogs/{logId}` records are append-only (`update` and `delete` denied even for callers).
5. **Terminal State Locking**: Once a `handoffs/{ticketId}` document reaches `status == 'resolved'`, or an `appointments/{appointmentId}` reaches `status == 'cancelled'`, non-admin updates are rejected.
6. **Strict Schema Keys & Bounded Strings**: Every entity validates exact `.hasAll()` / `.hasOnly()` keys and `.size()` bounds on every string to block shadow fields and storage abuse.

## 2. Adversarial "Dirty Dozen" Payloads (All Must Fail with `PERMISSION_DENIED`)
1. Unauthenticated read or write on `/callSessions/sess_1`.
2. Unverified email (`email_verified: false`) attempting write on `/users/uid_1` or spoofing admin email `priyabratabiswal567@gmail.com`.
3. Self-role escalation on `/users/uid_1` create with `{ role: "super_admin", revoked: false }`.
4. Ghost/shadow field injection on `/appointments/apt_1` create with `{ ..., isVerified: true }`.
5. `ownerUid` spoofing on `/handoffs/tkt_1` create with `{ ownerUid: "victim_uid" }`.
6. Non-owner `get` on another user's `/users/victim_uid` PII document.
7. Non-admin blanket `list` query on `/callSessions` without `ownerUid == request.auth.uid`.
8. Oversized ID injection (`150`-char ID or invalid characters `../admin`) on `/appointments/{id}`.
9. Non-admin mutation of `createdAt` or `ownerUid` on `/handoffs/tkt_1` update.
10. Client-forged `createdAt` timestamp not equal to `request.time`.
11. Re-opening a terminal `status == 'resolved'` handoff ticket as a non-admin caller.
12. Deleting or mutating an `/auditLogs/{logId}` entry.
