import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import type { AppointmentRecord, TenantConfig } from '../types/index.ts';

export interface WebhookValidationResult {
  valid: boolean;
  reason?: string;
  normalizedUrl?: string;
}

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^localhost\.localdomain$/i,
  /\.(?:internal|local|localhost|arpa)$/i,
  /\.(?:nip\.io|sslip\.io|xip\.io|localtest\.me)$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^\[::1\]$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^metadata\.google\.internal$/i,
];

export function isBlockedIpAddress(rawIp: string): boolean {
  const clean = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (!clean) return true;

  // Unwrap IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (clean.startsWith('::ffff:')) {
    const tail = clean.slice(7);
    if (net.isIPv4(tail)) {
      return isBlockedIpAddress(tail);
    }
    const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16);
      const lo = parseInt(hexMatch[2], 16);
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isBlockedIpAddress(v4);
    }
  }

  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map(Number);
    const [a, b, c] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // AWS/GCP link-local & metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24 (IETF) & 192.0.2.0/24 (TEST-NET-1)
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 Benchmarking
    if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }

  if (net.isIPv6(clean)) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true; // ULA fc00::/7
    if (clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) {
      return true; // Link-local fe80::/10
    }
    if (clean.startsWith('ff')) return true; // Multicast
    return false;
  }

  return true;
}

/**
 * Synchronous URL validation against SSRF targets.
 * Blocks loopback, RFC-1918 private networks, link-local, special-use IETF/TEST-NET blocks,
 * `.internal`/`.local` suffixes (after stripping trailing dots), and cloud metadata endpoints
 * unless allowLocal is explicitly enabled (for controlled integration testing).
 */
export function validateOutboundWebhookUrl(
  rawUrl: string,
  allowLocal = false
): WebhookValidationResult {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return { valid: false, reason: 'Webhook URL is empty.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Malformed webhook URL.' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Embedded credentials in webhook URLs are not allowed.' };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && !(allowLocal && protocol === 'http:')) {
    return {
      valid: false,
      reason: 'Outbound webhooks require HTTPS in production.',
    };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!hostname) {
    return { valid: false, reason: 'Webhook URL hostname is missing.' };
  }

  if (!allowLocal) {
    if (net.isIP(hostname) && isBlockedIpAddress(hostname)) {
      return {
        valid: false,
        reason: `Blocked private or internal IP "${hostname}" for SSRF protection.`,
      };
    }
    if (PRIVATE_HOST_PATTERNS.some(re => re.test(hostname))) {
      return {
        valid: false,
        reason: `Blocked private or internal host "${hostname}" for SSRF protection.`,
      };
    }
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}

/**
 * Resolves DNS records before outbound delivery to mitigate DNS-rebinding SSRF.
 */
export async function resolveAndValidateOutboundWebhookUrl(
  rawUrl: string,
  allowLocal = false
): Promise<WebhookValidationResult> {
  const basic = validateOutboundWebhookUrl(rawUrl, allowLocal);
  if (!basic.valid || !basic.normalizedUrl || allowLocal) {
    return basic;
  }

  const parsed = new URL(basic.normalizedUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (net.isIP(hostname)) {
    return isBlockedIpAddress(hostname)
      ? { valid: false, reason: `Blocked private IP "${hostname}" for SSRF protection.` }
      : basic;
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
      return { valid: false, reason: `Could not resolve webhook host "${hostname}".` };
    }
    for (const rec of records) {
      if (isBlockedIpAddress(rec.address)) {
        return {
          valid: false,
          reason: `Webhook host "${hostname}" resolved to blocked internal IP (${rec.address}).`,
        };
      }
    }
    return basic;
  } catch {
    return { valid: false, reason: `DNS resolution failed for webhook host "${hostname}".` };
  }
}

function deriveAesKey(masterSecret: string): Buffer {
  return crypto.createHash('sha256').update(`vanivoice-aes:${masterSecret}`, 'utf8').digest();
}

export function encryptSecretAtRest(plaintext: string, masterSecret: string): string {
  const clean = (plaintext || '').trim();
  if (!clean || clean.startsWith('enc:v1:')) return clean;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveAesKey(masterSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptSecretAtRest(storedValue: string | undefined, masterSecret: string): string {
  const clean = (storedValue || '').trim();
  if (!clean) return '';
  if (!clean.startsWith('enc:v1:')) return clean;
  const parts = clean.split(':');
  if (parts.length !== 5) return '';
  try {
    const iv = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    const ciphertext = Buffer.from(parts[4], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveAesKey(masterSecret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Computes a Stripe-style HMAC-SHA256 webhook signature header (`t=<ts>,v1=<hex>`).
 */
export function signWebhookPayload(
  secret: string,
  timestampSec: number,
  rawBody: string
): string {
  const signedContent = `${timestampSec}.${rawBody}`;
  const digest = crypto.createHmac('sha256', secret).update(signedContent, 'utf8').digest('hex');
  return `t=${timestampSec},v1=${digest}`;
}

export function verifyWebhookSignature(
  secret: string,
  signatureHeader: string,
  rawBody: string,
  maxAgeSeconds = 300
): boolean {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec((signatureHeader || '').trim());
  if (!match) return false;
  const ts = Number(match[1]);
  if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > maxAgeSeconds) {
      return false;
    }
  }
  const expected = signWebhookPayload(secret, ts, rawBody);
  const a = Buffer.from(signatureHeader.trim(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function escapeIcsText(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatIcsUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}Z`
  );
}

function resolveSlotDayOffset(slot: string, baseDateUtc: Date): number {
  const lower = (slot || '').toLowerCase();
  if (/\btoday\b/.test(lower)) return 0;
  if (/\btomorrow\b/.test(lower)) return 1;
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let idx = 0; idx < weekdays.length; idx++) {
    if (lower.includes(weekdays[idx])) {
      const currentDay = baseDateUtc.getUTCDay();
      const diff = (idx - currentDay + 7) % 7;
      return diff === 0 ? 7 : diff;
    }
  }
  return 1;
}

function parseSlotStartDate(slot: string, createdAtMs: number): Date {
  // Shift base to IST (+05:30) to determine local clinic calendar day accurately
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istNow = new Date((createdAtMs || Date.now()) + istOffsetMs);
  const dayOffset = resolveSlotDayOffset(slot, istNow);

  let hour = 10;
  let minute = 0;
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(slot || '');
  if (match) {
    hour = parseInt(match[1], 10);
    minute = parseInt(match[2], 10);
    const meridiem = (match[3] || '').toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
  }

  const utcMs =
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + dayOffset, hour, minute, 0) -
    istOffsetMs;
  return new Date(utcMs);
}

/**
 * Generates an RFC-5545 .ics calendar invite for a confirmed or cancelled clinic appointment.
 */
export function buildCalendarIcs(
  appointment: AppointmentRecord,
  tenant: Pick<TenantConfig, 'name' | 'humanHandoffContact'>
): string {
  const dtStart = parseSlotStartDate(appointment.slot, appointment.createdAt);
  const dtEnd = new Date(dtStart.getTime() + 30 * 60 * 1000);
  const dtStamp = formatIcsUtc(new Date(appointment.createdAt || Date.now()));
  const method = appointment.status === 'cancelled' ? 'CANCEL' : 'REQUEST';
  const status = appointment.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';

  const summary = escapeIcsText(
    `${tenant.name}: Appointment with ${appointment.doctor} (${appointment.patientName})`
  );
  const description = escapeIcsText(
    `Booking Ref: ${appointment.id}\nDoctor: ${appointment.doctor}\nSlot: ${appointment.slot}\nPatient: ${appointment.patientName}\nSupport Desk: ${tenant.humanHandoffContact.department} (${tenant.humanHandoffContact.phone})`
  );

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VaniVoice AI//Clinic Appointment Ledger//EN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${appointment.id}@vanivoice.local`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${formatIcsUtc(dtStart)}`,
    `DTEND:${formatIcsUtc(dtEnd)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${escapeIcsText(tenant.name)}`,
    `STATUS:${status}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export interface WebhookDispatchInput {
  targetUrl: string;
  signingSecret: string;
  secretHeaderName?: string;
  payloadJson: string;
  idempotencyKey: string;
  allowLocal?: boolean;
  maxAttempts?: number;
  backoffMs?: number[];
  timeoutMs?: number;
}

export interface WebhookDispatchOutcome {
  status: 'delivered' | 'failed';
  attemptCount: number;
  lastStatusCode: number | null;
  lastError: string | null;
  latencyMs: number;
}

/**
 * Dispatches a signed outbound webhook with bounded exponential backoff retries and SSRF validation.
 */
export async function dispatchWebhookWithRetry(
  input: WebhookDispatchInput
): Promise<WebhookDispatchOutcome> {
  const startedAt = performance.now();
  const validation = await resolveAndValidateOutboundWebhookUrl(input.targetUrl, Boolean(input.allowLocal));
  if (!validation.valid || !validation.normalizedUrl) {
    return {
      status: 'failed',
      attemptCount: 1,
      lastStatusCode: null,
      lastError: validation.reason || 'Invalid webhook URL.',
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
    };
  }

  const maxAttempts = Math.min(5, Math.max(1, input.maxAttempts ?? 3));
  const backoff = input.backoffMs ?? [0, 150, 400];
  const timeoutMs = input.timeoutMs ?? 4000;
  const headerName = (input.secretHeaderName || 'X-VaniVoice-Signature').trim() || 'X-VaniVoice-Signature';

  let lastStatusCode: number | null = null;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const baseDelay = backoff[attempt - 1] ?? 0;
    if (baseDelay > 0) {
      const jitter = crypto.randomInt(0, Math.max(10, Math.round(baseDelay * 0.25)));
      await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
    }

    const timestampSec = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(input.signingSecret, timestampSec, input.payloadJson);

    try {
      const response = await fetch(validation.normalizedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [headerName]: signature,
          'X-Idempotency-Key': input.idempotencyKey,
        },
        body: input.payloadJson,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });

      lastStatusCode = response.status;
      await response.body?.cancel().catch(() => {});

      if (response.ok) {
        return {
          status: 'delivered',
          attemptCount: attempt,
          lastStatusCode,
          lastError: null,
          latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        };
      }
      lastError = `Webhook target responded with HTTP ${response.status}`;
      // Do not retry non-transient 4xx client errors
      if (response.status >= 400 && response.status < 500) {
        return {
          status: 'failed',
          attemptCount: attempt,
          lastStatusCode,
          lastError,
          latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    status: 'failed',
    attemptCount: maxAttempts,
    lastStatusCode,
    lastError: lastError || 'Webhook delivery failed after bounded retries.',
    latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
  };
}
