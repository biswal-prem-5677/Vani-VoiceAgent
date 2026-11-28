import fs from 'node:fs';
import path from 'node:path';
import { initializeApp, getApps, getApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { logStructuredEvent } from '../utils/logger.ts';

let adminAppInstance: App | null = null;

function resolveFirebaseProjectId(): string | undefined {
  if (process.env.FIREBASE_PROJECT_ID?.trim()) {
    return process.env.FIREBASE_PROJECT_ID.trim();
  }
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(import.meta.dirname, '../../firebase-applet-config.json'),
  ];
  for (const cfgPath of candidates) {
    try {
      if (fs.existsSync(cfgPath)) {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
        if (parsed?.projectId?.trim()) {
          return parsed.projectId.trim();
        }
      }
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

function getAdminApp(): App {
  if (!adminAppInstance) {
    const projectId = resolveFirebaseProjectId();
    adminAppInstance =
      getApps().length > 0
        ? getApp()
        : initializeApp(projectId ? { projectId } : undefined);
  }
  return adminAppInstance;
}

export interface VerifiedFirebaseClaims {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  signInProvider?: string;
}

/**
 * Verifies a Firebase Authentication OIDC ID token locally using Google's public JWKS keys.
 * Deliberately defaults checkRevoked=false so zero GCP IAM roles are required on Spark/Starter projects.
 */
export async function verifyFirebaseIdToken(
  idToken: string
): Promise<VerifiedFirebaseClaims | null> {
  if (!idToken || typeof idToken !== 'string') return null;
  if (idToken.split('.').length !== 3) return null;

  try {
    const auth = getAuth(getAdminApp());
    const checkRevoked = process.env.FIREBASE_CHECK_REVOKED === 'true';
    const decoded = await auth.verifyIdToken(idToken, checkRevoked);
    if (!decoded?.uid || !decoded.email) return null;
    if (decoded.email_verified !== true) return null;

    const signInProvider = decoded.firebase?.sign_in_provider;
    if (!signInProvider || signInProvider === 'anonymous') {
      return null;
    }

    return {
      uid: decoded.uid,
      email: decoded.email.toLowerCase(),
      emailVerified: true,
      signInProvider,
      name:
        (typeof decoded.name === 'string' && decoded.name.trim()) ||
        decoded.email.split('@')[0] ||
        'Workspace User',
    };
  } catch (err) {
    logStructuredEvent('warn', 'auth.firebase_verify_failed', {
      reason: err instanceof Error ? err.message.slice(0, 140) : 'Verification failed',
    });
    return null;
  }
}
