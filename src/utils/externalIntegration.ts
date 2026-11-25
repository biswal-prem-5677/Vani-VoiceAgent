import crypto from 'node:crypto';
import type { AppointmentRecord, TenantConfig } from '../types/index.ts';

export interface WebhookValidationResult {
  valid: boolean;
  reason?: string;
  normalizedUrl?: string;
}

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^\[::1\]$/,
  /^fc00:/i,
  /^fe80:/i,
  /^metadata\.google\.internal$/i,
];

/**
 * Validates outbound webhook URLs against SSRF targets.
 * Blocks loopback, RFC-1918 private networks, link-local, and cloud metadata endpoints
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

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && !(allowLocal && protocol === 'http:')) {
    return {
      valid: false,
      reason: 'Outbound webhooks require HTTPS in production.',
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!allowLocal && PRIVATE_HOST_PATTERNS.some(re => re.test(hostname))) {
    return {
      valid: false,
      reason: `Blocked private or internal host "${hostname}" for SSRF protection.`,
    };
  }

  return { valid: true, normalizedUrl: parsed.toString() };
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
  rawBody: string
): boolean {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec((signatureHeader || '').trim());
  if (!match) return false;
  const ts = Number(match[1]);
  const expected = signWebhookPayload(secret, ts, rawBody);
  const a = Buffer.from(signatureHeader.trim(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function escapeIcsText(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
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

function parseSlotStartDate(slot: string, createdAtMs: number): Date {
  const base = new Date(createdAtMs || Date.now());
  // Schedule tomorrow morning by default or match HH:MM AM/PM
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + 1, 4, 30, 0));
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(slot || '');
  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const meridiem = (match[3] || '').toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    // Store clean IST-adjusted UTC approximation (IST is UTC+05:30)
    const utcMs = Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate() + 1,
      hour,
      minute,
      0
    ) - (5 * 60 + 30) * 60 * 1000;
    return new Date(utcMs);
  }
  return start;
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
    `Booking Ref: ${appointment.id}\\nDoctor: ${appointment.doctor}\\nSlot: ${appointment.slot}\\nPatient: ${appointment.patientName}\\nSupport Desk: ${tenant.humanHandoffContact.department} (${tenant.humanHandoffContact.phone})`
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
  const validation = validateOutboundWebhookUrl(input.targetUrl, Boolean(input.allowLocal));
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
    const delay = backoff[attempt - 1] ?? 0;
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
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
        signal: AbortSignal.timeout(timeoutMs),
      });

      lastStatusCode = response.status;
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
