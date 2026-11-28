import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);
const TOKEN_ISSUER = 'vanivoice-api';
const TOKEN_AUDIENCE = 'vanivoice-client';

export type UserRole = 'caller' | 'tenant_admin' | 'super_admin';

export interface SessionTokenPayload {
  sub: string;
  sessionId: string;
  email: string;
  name: string;
  role: UserRole;
  allowedTenants: string[];
  ver?: number;
  iss?: string;
  aud?: string;
  iat: number;
  exp: number;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export async function verifyPasswordAsync(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  try {
    const derived = (await scryptAsync(password, salt, 64)) as Buffer;
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function constantTimeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

export function signSessionToken(
  claims: Omit<SessionTokenPayload, 'iat' | 'exp' | 'iss' | 'aud'>,
  secret: string,
  ttlSeconds = 8 * 3600
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const fullPayload: SessionTokenPayload = {
    ...claims,
    iss: TOKEN_ISSUER,
    aud: TOKEN_AUDIENCE,
    iat: nowSec,
    exp: nowSec + ttlSeconds,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest();
  const encodedSig = base64UrlEncode(signature);
  return `${encodedPayload}.${encodedSig}`;
}

export function verifySessionToken(
  token: string,
  secret: string
): SessionTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSig] = parts;
  if (!encodedPayload || !encodedSig) return null;

  try {
    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', secret).update(encodedPayload).digest()
    );
    if (!constantTimeEqualString(encodedSig, expectedSig)) {
      return null;
    }

    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as SessionTokenPayload;
    if (
      !parsed ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.role !== 'string' ||
      parsed.iss !== TOKEN_ISSUER ||
      parsed.aud !== TOKEN_AUDIENCE
    ) {
      return null;
    }
    if (Math.floor(Date.now() / 1000) >= parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function canAccessTenant(
  user: Pick<SessionTokenPayload, 'role' | 'allowedTenants'> | null | undefined,
  tenantId: string
): boolean {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (user.role !== 'tenant_admin') return false;
  return Array.isArray(user.allowedTenants) && (
    user.allowedTenants.includes('*') || user.allowedTenants.includes(tenantId)
  );
}
