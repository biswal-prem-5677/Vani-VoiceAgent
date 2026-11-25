import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFirebaseDb, handleFirestoreError, OperationType } from './firebase';
import type { AuthUser, TenantConfig } from '../types';

function sanitizeId(raw: string, fallbackPrefix: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
  return clean.length >= 3 ? clean : `${fallbackPrefix}_${Date.now()}`;
}

/**
 * Syncs minimal OIDC user profile metadata to Firestore.
 * Operational data (transcripts, handoff tickets, appointments, webhooks, support tickets)
 * is stored strictly in the authoritative server-side database via /api/* endpoints.
 */
export async function upsertUserProfileInFirestore(user: AuthUser, uid: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    const db = getFirebaseDb();
    await setDoc(
      doc(db, 'users', uid),
      {
        uid,
        email: user.email.slice(0, 160),
        displayName: (user.name || 'Workspace User').slice(0, 120),
        role: user.role,
        revoked: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {
      // Non-fatal diagnostic: auth token exchange on server already completed
    }
  }
}

export async function syncTenantWorkspaceToFirestore(
  tenant: TenantConfig,
  ownerUid: string
): Promise<void> {
  const tenantId = sanitizeId(tenant.id, 'tenant');
  const cleanOwnerUid = sanitizeId(ownerUid, 'usr');
  const path = `tenants/${tenantId}`;
  try {
    const db = getFirebaseDb();
    await setDoc(doc(db, 'tenants', tenantId), {
      id: tenantId,
      name: tenant.name.slice(0, 120),
      category: tenant.category,
      agentName: tenant.agentName.slice(0, 60),
      webhookEnabled: Boolean(tenant.webhookConfig?.enabled),
      ownerUid: cleanOwnerUid,
      memberUids: {
        [cleanOwnerUid]: true,
      },
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
