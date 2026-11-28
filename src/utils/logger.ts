import type { Request } from 'express';

const REDACTED_KEYS = new Set([
  'authorization',
  'cookie',
  'password',
  'passwordhash',
  'bootstraptoken',
  'signingsecret',
  'secret',
  'idtoken',
  'token',
  'apikey',
  'gemini_api_key',
  'session_secret',
  'webhook_signing_secret',
  'webhook_encryption_key',
  'admin_passcode',
  'admin_bootstrap_token',
]);

export function redactSensitiveValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') {
    let scrubbed = value.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
    scrubbed = scrubbed.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g, '[JWT_REDACTED]');
    scrubbed = scrubbed.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[API_KEY_REDACTED]');
    return scrubbed;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(item => redactSensitiveValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(key.toLowerCase())) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactSensitiveValue(val, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function logStructuredEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, unknown> = {}
): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(redactSensitiveValue(fields) as Record<string, unknown>),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function logHttpCompletion(params: {
  req: Request & { traceId?: string; authUser?: { role?: string; sub?: string } };
  statusCode: number;
  durationMs: number;
}): void {
  const { req, statusCode, durationMs } = params;
  if (!req.path.startsWith('/api/')) return;
  logStructuredEvent(statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info', 'http.request', {
    traceId: req.traceId || null,
    method: req.method,
    path: req.path,
    statusCode,
    durationMs: Math.round(durationMs * 10) / 10,
    actorRole: req.authUser?.role || 'anonymous',
  });
}
