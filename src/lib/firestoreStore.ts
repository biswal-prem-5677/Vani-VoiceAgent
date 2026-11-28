import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFirebaseDb, handleFirestoreError, OperationType } from './firebase';
import type { AuthUser, TenantConfig } from '../types';

function sanitizeId(raw: string, fallbackPrefix: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
  return clean.length >= 3 ? clean : `${fallbackPrefix}_${Date.now()}`;
}

/**
 * Syncs minimal OIDC user profile metadata to Firestore.
 * Creates with least-privilege role ('caller', revoked: false) on first sign-in and
 * updates only mutable fields ('displayName', 'updatedAt') on repeat logins to satisfy firestore.rules.
 */
export async function upsertUserProfileInFirestore(user: AuthUser, uid: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    const db = getFirebaseDb();
    const userRef = doc(db, 'users', uid);
    const displayName = (user.name || 'Workspace User').slice(0, 120);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid,
        email: user.email.slice(0, 160),
        displayName,
        role: 'caller',
        revoked: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName,
        updatedAt: serverTimestamp(),
      });
    }
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
