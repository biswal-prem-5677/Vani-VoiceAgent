import { initializeApp, getApps, getApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

let adminAppInstance: App | null = null;

function getAdminApp(): App {
  if (!adminAppInstance) {
    adminAppInstance =
      getApps().length > 0
        ? getApp()
        : initializeApp({
            projectId: firebaseConfig.projectId,
          });
  }
  return adminAppInstance;
}

export interface VerifiedFirebaseClaims {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/**
 * Verifies a Firebase Authentication OIDC ID token locally using Google's public JWKS keys.
 * Deliberately uses verifyIdToken(idToken) without checkRevoked=true so zero GCP IAM roles are required.
 */
export async function verifyFirebaseIdToken(
  idToken: string
): Promise<VerifiedFirebaseClaims | null> {
  if (!idToken || typeof idToken !== 'string') return null;
  // Firebase JWT tokens always have 3 dot-separated segments
  if (idToken.split('.').length !== 3) return null;

  try {
    const auth = getAuth(getAdminApp());
    const decoded = await auth.verifyIdToken(idToken);
    if (!decoded?.uid || !decoded.email) return null;
    if (decoded.email_verified !== true) return null;

    return {
      uid: decoded.uid,
      email: decoded.email.toLowerCase(),
      emailVerified: true,
      name:
        (typeof decoded.name === 'string' && decoded.name.trim()) ||
        decoded.email.split('@')[0] ||
        'Workspace User',
    };
  } catch {
    return null;
  }
}
