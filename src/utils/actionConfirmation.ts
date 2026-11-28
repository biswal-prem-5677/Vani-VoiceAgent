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

const VALID_CLINIC_SLOT_TIME_RE = /(?:^|\b)(10:00\s*am|10:30\s*am|11:30\s*am|0?4:00\s*pm|0?5:30\s*pm)(?:\b|$)/i;
const VALID_CLINIC_DAY_PREFIX_RE = /^(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday)\s+/i;

/**
 * Validates that a requested clinic appointment slot maps to an actual OPD slot
 * (Monday-Saturday; excludes arbitrary off-hours like 3:17 AM or Sunday OPD).
 */
export function isValidClinicSlot(slot: string): { valid: boolean; reason?: string } {
  const clean = (slot || '').replace(/\s+/g, ' ').trim();
  if (!clean) {
    return { valid: false, reason: 'Appointment slot is empty.' };
  }
  if (/\bsunday\b/i.test(clean)) {
    return {
      valid: false,
      reason: 'Routine outpatient OPD is closed on Sundays. Please pick Monday through Saturday.',
    };
  }
  const timeMatch = VALID_CLINIC_SLOT_TIME_RE.exec(clean);
  if (!timeMatch) {
    return {
      valid: false,
      reason: `Slot "${clean}" is outside configured OPD slots (${DEFAULT_CLINIC_SLOTS.join(', ')}).`,
    };
  }

  // Ensure any remaining non-time prefix only uses valid days or "Morning"/"Evening"
  const withoutTime = clean
    .replace(timeMatch[0], '')
    .replace(/\b(?:morning|evening|at|on|for)\b/gi, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (withoutTime && !VALID_CLINIC_DAY_PREFIX_RE.test(withoutTime + ' ')) {
    return {
      valid: false,
      reason: `Unrecognized slot day "${withoutTime}". Choose Today, Tomorrow, or Monday-Saturday.`,
    };
  }

  return { valid: true };
}

const CONFIRM_NEGATION_RE =
  /\b(?:no|not|don'?t|do\s+not|never|cancel|cancelled|stop|wait|maybe|hold\s+on|nahi|nahin|mat|ruk)\b/i;
const CONFIRM_INDIC_NEGATION_RE = /(?:ନାହିଁ|ରୋକ|ବାତିଲ|ନहीं|मत|रुक|रद्द|না|থামুন|বাতিল)/;
const CONFIRM_AFFIRM_RE =
  /\b(?:yes|confirm|confirmed|proceed|ok|okay|sure|yep|yeah|thik|haan|ha|bilkul|go\s+ahead)\b/i;
const CONFIRM_INDIC_AFFIRM_RE =
  /(?:ହଁ|ନିଶ୍ଚୟ|କରନ୍ତୁ|ହଁ\s*ଆଜ୍ଞା|हाँ|बिल्कुल|कर\s*दीजिए|पक्का|হ্যাঁ|নিশ্চয়|করুন)/;

/**
 * Deterministic confirmation classifier derived strictly from the caller's latest message.
 * Negations/hedges ("Yes, do not confirm", "maybe", "cancel") always return false.
 */
export function evaluateUserConfirmation(userText: string): boolean {
  const clean = (userText || '').trim();
  if (!clean) return false;
  if (CONFIRM_NEGATION_RE.test(clean) || CONFIRM_INDIC_NEGATION_RE.test(clean)) {
    return false;
  }
  return CONFIRM_AFFIRM_RE.test(clean) || CONFIRM_INDIC_AFFIRM_RE.test(clean);
}
