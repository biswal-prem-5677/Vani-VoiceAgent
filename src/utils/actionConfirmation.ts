import crypto from 'node:crypto';

export const DEFAULT_CLINIC_SLOTS: readonly string[] = [
  '10:00 AM',
  '11:30 AM',
  '04:00 PM',
  '05:30 PM',
];

export const RETENTION_POLICY_DAYS = {
  defaultTranscriptDays: 30,
  safetyTicketDays: 30,
  supportTicketDays: 90,
  appointmentDays: 90,
  pendingActionHours: 24,
} as const;

export interface CanonicalParamsResult {
  canonicalParams: Record<string, unknown>;
  canonicalJson: string;
  paramsHash: string;
}

function normalizeValue(key: string, value: unknown): unknown {
  if (typeof value === 'string') {
    const collapsed = value.replace(/\s+/g, ' ').trim();
    if (key === 'orderId') {
      return collapsed.toUpperCase();
    }
    if (key === 'doctor' || key === 'slot' || key === 'patientName' || key === 'newDate') {
      return collapsed.toLowerCase();
    }
    return collapsed;
  }
  if (Array.isArray(value)) {
    return value.map(item => normalizeValue(key, item));
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = normalizeValue(k, obj[k]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Canonicalizes tool arguments and computes a deterministic SHA-256 hash.
 * Confirmation control fields (`confirmed`, `actionId`) are excluded so
 * request and confirmation turns with identical business parameters share the same hash,
 * while any parameter tampering produces a distinct hash.
 */
export function canonicalizeToolParams(
  toolName: string,
  params: Record<string, unknown>
): CanonicalParamsResult {
  const safeParams = params || {};
  const canonicalParams = Object.keys(safeParams)
    .filter(k => k !== 'confirmed' && k !== 'actionId')
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      const normalized = normalizeValue(k, safeParams[k]);
      if (normalized !== undefined && normalized !== '') {
        acc[k] = normalized;
      }
      return acc;
    }, {});

  const canonicalJson = JSON.stringify({ toolName, params: canonicalParams });
  const paramsHash = crypto.createHash('sha256').update(canonicalJson).digest('hex').slice(0, 32);

  return { canonicalParams, canonicalJson, paramsHash };
}

export interface ProductionSecurityCheckInput {
  isDev: boolean;
  sessionSecret: string;
  adminPasscode: string;
  bootstrapToken: string;
  hasExistingSuperAdmin: boolean;
}

export interface ProductionSecurityCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function verifyProductionSecurityConfig(
  input: ProductionSecurityCheckInput
): ProductionSecurityCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input.isDev) {
    if (!input.sessionSecret || input.sessionSecret.length < 32) {
      warnings.push(
        'DEV MODE: SESSION_SECRET is unset or shorter than 32 chars; using an ephemeral signing key for this dev process.'
      );
    }
    if (!input.adminPasscode && !input.bootstrapToken && !input.hasExistingSuperAdmin) {
      warnings.push(
        'DEV MODE: First-run admin bootstrap is open locally. Configure ADMIN_PASSCODE or ADMIN_BOOTSTRAP_TOKEN before production.'
      );
    }
    return { ok: true, errors, warnings };
  }

  if (!input.sessionSecret || input.sessionSecret.length < 32) {
    errors.push(
      'PRODUCTION STARTUP BLOCKED: SESSION_SECRET must be set and at least 32 characters long.'
    );
  }

  if (!input.adminPasscode && !input.bootstrapToken && !input.hasExistingSuperAdmin) {
    errors.push(
      'PRODUCTION STARTUP BLOCKED: Configure ADMIN_PASSCODE or ADMIN_BOOTSTRAP_TOKEN (or initialize a super_admin user) before starting in production.'
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function computeAvailableSlots(
  bookedSlots: string[],
  candidateSlots: readonly string[] = DEFAULT_CLINIC_SLOTS
): string[] {
  const normalizedBooked = new Set(
    bookedSlots.map(s => s.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean)
  );
  return candidateSlots.filter(
    slot => !normalizedBooked.has(slot.replace(/\s+/g, ' ').trim().toLowerCase())
  );
}

export function isSlotAlreadyBooked(requestedSlot: string, bookedSlots: string[]): boolean {
  const normalized = requestedSlot.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return false;
  return bookedSlots.some(s => s.replace(/\s+/g, ' ').trim().toLowerCase() === normalized);
}
