import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';
import { INITIAL_TENANTS } from './src/data/tenants.ts';
import { INITIAL_CALL_LOGS } from './src/data/mockCallLogs.ts';
import { BENCHMARK_CASES } from './src/data/evalBenchmark.ts';
import {
  checkEmergencyCondition,
  checkEmergencyWithContext,
  checkHumanEscalationRequest,
  buildHumanEscalationReply,
} from './src/utils/safety.ts';
import { searchKnowledgeBase } from './src/utils/ragEngine.ts';
import { executeTenantTool, type ToolExecutionResult } from './src/utils/tools.ts';
import { detectLanguage } from './src/utils/languageDetector.ts';
import { extractEntitiesFromInput, processTurn } from './src/utils/callPipeline.ts';
import {
  GEMINI_CHAT_MODEL,
  GEMINI_FALLBACK_MODEL,
  buildGeminiConversationContents,
  buildTenantSystemInstruction,
  buildGeminiToolDeclarations,
  extractMemoryUpdatesFromToolCall,
} from './src/utils/geminiTurnBuilder.ts';
import {
  hashPasswordAsync,
  verifyPasswordAsync,
  constantTimeEqualString,
  signSessionToken,
  verifySessionToken,
  canAccessTenant,
  type SessionTokenPayload,
} from './src/utils/auth.ts';
import {
  canonicalizeToolParams,
  verifyProductionSecurityConfig,
  computeAvailableSlots,
  isSlotAlreadyBooked,
  evaluateUserConfirmation,
  RETENTION_POLICY_DAYS,
} from './src/utils/actionConfirmation.ts';
import {
  TurnRequestSchema,
  ConsentRequestSchema,
  SupportTicketSchema,
  SupportTicketUpdateSchema,
  TenantConfigSchema,
  CallLogCreateSchema,
  AuthBootstrapSchema,
  AuthLoginSchema,
  TenantAdminCreateSchema,
  HandoffUpdateSchema,
  AppointmentUpdateSchema,
} from './src/utils/schemas.ts';
import {
  FirebaseAuthExchangeSchema,
  UserRoleUpdateSchema,
  UserRevokeUpdateSchema,
} from './src/utils/schemas.ts';
import { verifyFirebaseIdToken } from './src/lib/firebase-admin.ts';
import {
  resolveAndValidateOutboundWebhookUrl,
  dispatchWebhookWithRetry,
  buildCalendarIcs,
  encryptSecretAtRest,
  decryptSecretAtRest,
} from './src/utils/externalIntegration.ts';
import { computeOperationalMetrics } from './src/utils/operationalMetrics.ts';
import { logHttpCompletion, logStructuredEvent } from './src/utils/logger.ts';
import type {
  TenantConfig,
  CallLog,
  HandoffTicket,
  SupportedLanguage,
  IntegrationDelivery,
  SupportTicketRecord,
} from './src/types/index.ts';

const app = express();
const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';
app.set('trust proxy', TRUST_PROXY ? 1 : false);
const parsedPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

const RAW_SESSION_SECRET = process.env.SESSION_SECRET?.trim() || '';
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE?.trim() || '';
const ADMIN_BOOTSTRAP_TOKEN = process.env.ADMIN_BOOTSTRAP_TOKEN?.trim() || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase() || '';
const ALLOW_LOCAL_WEBHOOKS = process.env.ALLOW_LOCAL_WEBHOOKS === 'true';
const ALLOW_DEMO_MODE = process.env.ALLOW_DEMO_MODE === 'true';
const ALLOW_DEMO_WEBHOOKS = process.env.ALLOW_DEMO_WEBHOOKS === 'true';
const WEBHOOK_SIGNING_SECRET = process.env.WEBHOOK_SIGNING_SECRET?.trim() || '';
const WEBHOOK_ENCRYPTION_KEY = process.env.WEBHOOK_ENCRYPTION_KEY?.trim() || '';
const DEFAULT_FRAME_ANCESTORS = "'self' https://aistudio.google.com https://*.google.com";
function sanitizeFrameAncestors(raw: string | undefined): string {
  const trimmed = raw?.trim().replace(/^"(.*)"$/, '$1').trim();
  if (!trimmed) return DEFAULT_FRAME_ANCESTORS;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const validSourceRe = /^(?:'self'|'none'|https?:\/\/[a-zA-Z0-9*.-]+(?::\d+)?|\*\.[a-zA-Z0-9.-]+)$/;
  const validTokens = tokens.filter((t) => validSourceRe.test(t));
  return validTokens.length > 0 && validTokens.length === tokens.length
    ? validTokens.join(' ')
    : DEFAULT_FRAME_ANCESTORS;
}
const CSP_FRAME_ANCESTORS = sanitizeFrameAncestors(process.env.CSP_FRAME_ANCESTORS);

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => unknown | Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as Req, res, next)).catch(next);
  };
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  isDev
    ? "script-src 'self' 'unsafe-inline' https://apis.google.com https://www.gstatic.com"
    : "script-src 'self' https://apis.google.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  isDev
    ? "connect-src 'self' ws://localhost:* http://localhost:* https://*.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com wss://*.firebaseio.com"
    : "connect-src 'self' https://*.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com wss://*.firebaseio.com",
  "frame-src 'self' https://accounts.google.com https://*.firebaseapp.com https://*.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  `frame-ancestors ${CSP_FRAME_ANCESTORS}`,
].join('; ');

// Security headers, CSP, redacted JSON request logging & X-Trace-Id propagation
app.use((req: Request & { traceId?: string; authUser?: SessionTokenPayload }, res: Response, next: NextFunction) => {
  const startReq = performance.now();
  const incomingTrace = typeof req.headers['x-trace-id'] === 'string' ? req.headers['x-trace-id'].trim() : '';
  const traceId = /^[a-zA-Z0-9_-]{8,64}$/.test(incomingTrace) ? incomingTrace : crypto.randomUUID();
  req.traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self)');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.on('finish', () => {
    logHttpCompletion({
      req,
      statusCode: res.statusCode,
      durationMs: performance.now() - startReq,
    });
  });
  next();
});

// Body parser with size limits & JSON syntax handling
app.use(express.json({ limit: '500kb' }));
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON request body.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request payload exceeds 500kb limit.' });
  }
  return next(err);
});

// Serve public directory for icons, manifest, robots.txt, and sitemap.xml
app.use(express.static(path.resolve(process.cwd(), 'public')));

// -------------------------------------------------------------
// 1. Initialize SQLite Database (WAL mode, busy_timeout, fail-loud prod DATA_DIR)
// -------------------------------------------------------------
const configuredDataDir = process.env.DATA_DIR?.trim();
const isCloudRun = Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_JOB);
let DATA_DIR = configuredDataDir ? path.resolve(configuredDataDir) : path.resolve(process.cwd(), 'data');
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch (dirErr) {
  if (!isDev && !isCloudRun && process.env.ALLOW_EPHEMERAL_TMP_DB !== 'true') {
    console.error(
      `PRODUCTION STARTUP BLOCKED: Persistent DATA_DIR "${DATA_DIR}" is not writable (${String(dirErr)}). Mount a writable volume or set DATA_DIR.`
    );
    process.exit(1);
  }
  console.warn(`DATA_DIR "${DATA_DIR}" is not writable; falling back to /tmp/vanivoice-data.`);
  DATA_DIR = path.join('/tmp', 'vanivoice-data');
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

const db = new DatabaseSync(path.join(DATA_DIR, 'vanivoice.db'));
try {
  db.exec('PRAGMA journal_mode = WAL;');
} catch {
  // Fallback to default journal mode if filesystem disallows WAL shared-memory files
}
db.exec(`
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS call_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    session_id TEXT,
    expires_at INTEGER,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS consent_records (
    session_id TEXT PRIMARY KEY,
    tenant_id TEXT,
    consented INTEGER NOT NULL,
    retention_days INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS handoff_tickets (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    tenant_name TEXT NOT NULL,
    session_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    priority TEXT NOT NULL,
    summary TEXT NOT NULL,
    department TEXT NOT NULL,
    phone TEXT NOT NULL,
    status TEXT NOT NULL,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pending_actions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    params_hash TEXT NOT NULL,
    idempotency_key TEXT,
    status TEXT NOT NULL,
    result_json TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    allowed_tenants TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    doctor TEXT NOT NULL,
    slot TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    status TEXT NOT NULL,
    action_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    tenant_id TEXT,
    target_id TEXT,
    metadata TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS integration_deliveries (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    session_id TEXT,
    event_type TEXT NOT NULL,
    target_url TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL,
    last_status_code INTEGER,
    last_error TEXT,
    latency_ms INTEGER,
    idempotency_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER
  );
`);

// Safe additive column migrations for pre-existing local SQLite databases
function ensureColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('call_logs', 'session_id', 'TEXT');
ensureColumn('call_logs', 'expires_at', 'INTEGER');
ensureColumn('support_tickets', 'tenant_id', 'TEXT');
ensureColumn('support_tickets', 'session_id', 'TEXT');
ensureColumn('support_tickets', 'expires_at', 'INTEGER');
ensureColumn('handoff_tickets', 'expires_at', 'INTEGER');
ensureColumn('handoff_tickets', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('appointments', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('pending_actions', 'created_request_id', 'TEXT');
ensureColumn('pending_actions', 'expires_at', 'INTEGER');
ensureColumn('users', 'revoked', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'auth_provider', "TEXT NOT NULL DEFAULT 'workspace_local'");
ensureColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 1');

// Backfill retention expiry for any pre-existing safety/support tickets missing expires_at
db.prepare('UPDATE handoff_tickets SET expires_at = created_at + ? WHERE expires_at IS NULL').run(
  RETENTION_POLICY_DAYS.safetyTicketDays * 24 * 60 * 60 * 1000
);
db.prepare('UPDATE support_tickets SET expires_at = created_at + ? WHERE expires_at IS NULL').run(
  RETENTION_POLICY_DAYS.supportTicketDays * 24 * 60 * 60 * 1000
);
db.prepare('UPDATE pending_actions SET expires_at = created_at + ? WHERE expires_at IS NULL').run(
  RETENTION_POLICY_DAYS.pendingActionHours * 60 * 60 * 1000
);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_call_logs_created_at ON call_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_call_logs_tenant_id ON call_logs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_call_logs_expires_at ON call_logs(expires_at);
  CREATE INDEX IF NOT EXISTS idx_handoff_tickets_tenant_id ON handoff_tickets(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_handoff_tickets_session_id ON handoff_tickets(session_id);
  CREATE INDEX IF NOT EXISTS idx_handoff_tickets_expires_at ON handoff_tickets(expires_at);
  CREATE INDEX IF NOT EXISTS idx_support_tickets_session_id ON support_tickets(session_id);
  CREATE INDEX IF NOT EXISTS idx_support_tickets_expires_at ON support_tickets(expires_at);
  CREATE INDEX IF NOT EXISTS idx_pending_actions_session ON pending_actions(session_id, tenant_id, tool_name, params_hash);
  CREATE INDEX IF NOT EXISTS idx_pending_actions_idem ON pending_actions(session_id, tenant_id, idempotency_key);
  CREATE INDEX IF NOT EXISTS idx_pending_actions_expires_at ON pending_actions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_appointments_tenant_doc ON appointments(tenant_id, doctor, status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_unique_active_slot ON appointments(tenant_id, LOWER(doctor), LOWER(slot)) WHERE status = 'confirmed';
  CREATE INDEX IF NOT EXISTS idx_appointments_session_id ON appointments(session_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_integrations_tenant_id ON integration_deliveries(tenant_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_integrations_session_id ON integration_deliveries(session_id);
`);

function hasSuperAdminAccount(): boolean {
  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'super_admin' AND revoked = 0")
    .get() as { cnt: number };
  return row.cnt > 0;
}

if (hasSuperAdminAccount()) {
  db.prepare("INSERT OR IGNORE INTO system_meta (key, value) VALUES ('bootstrap_completed', 'true')").run();
}

function isBootstrapCompleted(): boolean {
  if (hasSuperAdminAccount()) return true;
  const meta = db.prepare("SELECT value FROM system_meta WHERE key = 'bootstrap_completed'").get() as
    | { value: string }
    | undefined;
  return meta?.value === 'true';
}

const startupSecurity = verifyProductionSecurityConfig({
  isDev,
  sessionSecret: RAW_SESSION_SECRET,
  adminPasscode: ADMIN_PASSCODE,
  bootstrapToken: ADMIN_BOOTSTRAP_TOKEN,
  hasExistingSuperAdmin: isBootstrapCompleted(),
});

if (!startupSecurity.ok) {
  for (const errMsg of startupSecurity.errors) {
    console.error(errMsg);
  }
  process.exit(1);
}
for (const warnMsg of startupSecurity.warnings) {
  console.warn(warnMsg);
}

const SESSION_SECRET = RAW_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
function getWebhookEncryptionSecret(): string {
  return WEBHOOK_ENCRYPTION_KEY || SESSION_SECRET;
}

// Seed default tenants if empty
const tenantCountRow = db.prepare('SELECT COUNT(*) as cnt FROM tenants').get() as { cnt: number };
if (tenantCountRow.cnt === 0) {
  const insertTenant = db.prepare('INSERT INTO tenants (id, data, updated_at) VALUES (?, ?, ?)');
  for (const t of INITIAL_TENANTS) {
    insertTenant.run(t.id, JSON.stringify(t), Date.now());
  }
}

// Seed sample call logs if empty
const logCountRow = db.prepare('SELECT COUNT(*) as cnt FROM call_logs').get() as { cnt: number };
if (logCountRow.cnt === 0) {
  const insertLog = db.prepare(
    'INSERT INTO call_logs (id, tenant_id, session_id, expires_at, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const l of INITIAL_CALL_LOGS) {
    insertLog.run(l.id, l.tenantId, 'sample_seed', null, JSON.stringify(l), Date.now());
  }
}

// Retention purge worker across transcripts, safety handoffs, support tickets, appointments, and stale pending confirmations
function purgeExpiredRecords(): number {
  const now = Date.now();
  const stalePendingCutoff = now - RETENTION_POLICY_DAYS.pendingActionHours * 60 * 60 * 1000;
  try {
    let total = 0;
    total += Number(db.prepare('DELETE FROM call_logs WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now).changes || 0);
    total += Number(db.prepare('DELETE FROM handoff_tickets WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now).changes || 0);
    total += Number(db.prepare('DELETE FROM support_tickets WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now).changes || 0);
    total += Number(db.prepare('DELETE FROM appointments WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now).changes || 0);
    total += Number(db.prepare('DELETE FROM integration_deliveries WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now).changes || 0);
    total += Number(
      db
        .prepare(
          "DELETE FROM pending_actions WHERE (expires_at IS NOT NULL AND expires_at <= ?) OR (status = 'pending' AND created_at <= ?)"
        )
        .run(now, stalePendingCutoff).changes || 0
    );
    return total;
  } catch (err) {
    logStructuredEvent('error', 'retention.purge_failed', { error: String(err) });
    return 0;
  }
}

purgeExpiredRecords();
setInterval(() => {
  purgeExpiredRecords();
}, 15 * 60 * 1000).unref();

// -------------------------------------------------------------
// 2. Bounded Rate Limiting & Per-Email Login Throttle
// -------------------------------------------------------------
interface RateBucket {
  count: number;
  windowStart: number;
}

const rateLimitStores: Map<string, RateBucket>[] = [];
const failedLoginByEmail = new Map<string, RateBucket>();

function parsePositiveEnvInt(raw: string | undefined, fallback: number): number {
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createRateLimiter(maxRequests: number, windowMs: number, message: string) {
  const store = new Map<string, RateBucket>();
  rateLimitStores.push(store);

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now - entry.windowStart > windowMs) {
      store.set(ip, { count: 1, windowStart: now });
      return next();
    }

    if (entry.count >= maxRequests) {
      return res.status(429).json({ error: message, code: 'RATE_LIMITED', retryable: true });
    }

    entry.count++;
    return next();
  };
}

setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const store of rateLimitStores) {
    for (const [key, bucket] of store.entries()) {
      if (bucket.windowStart < cutoff) {
        store.delete(key);
      }
    }
  }
  const loginCutoff = Date.now() - 15 * 60 * 1000;
  for (const [emailKey, bucket] of failedLoginByEmail.entries()) {
    if (bucket.windowStart < loginCutoff) {
      failedLoginByEmail.delete(emailKey);
    }
  }
}, 60 * 1000).unref();

const generalApiLimiter = createRateLimiter(
  parsePositiveEnvInt(process.env.RATE_LIMIT_GENERAL, 180),
  60 * 1000,
  'API rate limit exceeded. Please retry shortly.'
);
const turnLimiter = createRateLimiter(
  parsePositiveEnvInt(process.env.RATE_LIMIT_TURN, 60),
  60 * 1000,
  'Too many voice turns per minute. Please wait before continuing.'
);
const authLimiter = createRateLimiter(
  parsePositiveEnvInt(process.env.RATE_LIMIT_AUTH, 15),
  60 * 1000,
  'Too many authentication attempts. Please wait one minute.'
);
const callerSessionLimiter = createRateLimiter(
  parsePositiveEnvInt(process.env.RATE_LIMIT_CALLER_SESSION, 30),
  60 * 1000,
  'Too many caller session requests. Please wait before starting another session.'
);
const supportLimiter = createRateLimiter(
  parsePositiveEnvInt(process.env.RATE_LIMIT_SUPPORT, 10),
  60 * 1000,
  'Too many support ticket submissions. Please wait before retrying.'
);

app.use('/api', generalApiLimiter);

// -------------------------------------------------------------
// 3. Gemini API Client (Server-side Only)
// -------------------------------------------------------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
let aiClient: GoogleGenAI | null = null;
let primaryModelCooldownUntil = 0;
let primaryModelConsecutiveFailures = 0;

if (GEMINI_API_KEY) {
  try {
    aiClient = new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  } catch (err) {
    console.error('Failed to initialize Gemini client on server:', err);
  }
}

// -------------------------------------------------------------
// 4. Auth, Firebase OIDC, Live Revocation & Webhook Helpers
// -------------------------------------------------------------
interface AuthenticatedRequest extends Request {
  authUser?: SessionTokenPayload;
  traceId?: string;
}

interface DbUserRow {
  id: string;
  email: string;
  name: string;
  role: 'caller' | 'tenant_admin' | 'super_admin';
  allowed_tenants: string;
  revoked: number;
  auth_provider: string;
  token_version: number;
}

function upsertFirebaseUserRecord(claims: { uid: string; email: string; name: string }): DbUserRow | null {
  const existing = db
    .prepare(
      'SELECT id, email, name, role, allowed_tenants, revoked, auth_provider, token_version FROM users WHERE email = ? OR id = ?'
    )
    .get(claims.email.toLowerCase(), `fb_${claims.uid}`) as DbUserRow | undefined;

  if (existing) {
    if (existing.revoked === 1) return existing;
    return existing;
  }

  const isPrimaryAdmin = Boolean(ADMIN_EMAIL && claims.email.toLowerCase() === ADMIN_EMAIL);
  const role: DbUserRow['role'] = isPrimaryAdmin ? 'super_admin' : 'caller';
  const allowedTenantsJson = JSON.stringify(isPrimaryAdmin ? ['*'] : []);
  const id = `fb_${claims.uid}`;
  db.prepare(
    'INSERT INTO users (id, email, name, role, allowed_tenants, password_hash, revoked, auth_provider, token_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, claims.email.toLowerCase(), claims.name, role, allowedTenantsJson, 'oidc_federated', 0, 'firebase_oidc', 1, Date.now());

  return {
    id,
    email: claims.email.toLowerCase(),
    name: claims.name,
    role,
    allowed_tenants: allowedTenantsJson,
    revoked: 0,
    auth_provider: 'firebase_oidc',
    token_version: 1,
  };
}

async function resolveAuthUser(req: Request): Promise<SessionTokenPayload | null> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();

  // 1. Check workspace-signed session token first (fast HMAC path)
  const localClaims = verifySessionToken(token, SESSION_SECRET);
  if (localClaims) {
    // Re-read live DB role, token_version & revocation status on every request
    if (localClaims.sub !== 'usr_env_admin' && (localClaims.sub.startsWith('usr_') || localClaims.sub.startsWith('fb_'))) {
      const row = db
        .prepare('SELECT id, email, name, role, allowed_tenants, revoked, token_version FROM users WHERE id = ?')
        .get(localClaims.sub) as DbUserRow | undefined;
      if (row) {
        if (row.revoked === 1) return null;
        if (typeof localClaims.ver === 'number' && row.token_version !== localClaims.ver) {
          return null;
        }
        return {
          ...localClaims,
          email: row.email,
          name: row.name,
          role: row.role,
          allowedTenants: safeJsonParse<string[]>(row.allowed_tenants, []),
          ver: row.token_version,
        };
      }
    }
    return localClaims;
  }

  // 2. Check Firebase OIDC ID token
  const fbClaims = await verifyFirebaseIdToken(token);
  if (!fbClaims) return null;

  const userRow = upsertFirebaseUserRecord(fbClaims);
  if (!userRow || userRow.revoked === 1) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  return {
    sub: userRow.id,
    sessionId: `fb_${fbClaims.uid}`,
    email: userRow.email,
    name: userRow.name,
    role: userRow.role,
    allowedTenants: safeJsonParse<string[]>(userRow.allowed_tenants, []),
    ver: userRow.token_version,
    iat: nowSec,
    exp: nowSec + 3600,
  };
}

const requireAuthenticated = asyncHandler<AuthenticatedRequest>(async (req, res, next) => {
  const user = await resolveAuthUser(req);
  if (!user) {
    return res.status(401).json({
      error: 'Authentication required. Initialize a caller session or sign in as workspace administrator.',
      code: 'UNAUTHENTICATED',
    });
  }
  req.authUser = user;
  return next();
});

const requireAdmin = asyncHandler<AuthenticatedRequest>(async (req, res, next) => {
  const user = await resolveAuthUser(req);
  if (!user) {
    return res.status(401).json({
      error: 'Administrator sign-in required for this endpoint.',
      code: 'UNAUTHENTICATED',
    });
  }
  if (user.role !== 'tenant_admin' && user.role !== 'super_admin') {
    return res.status(403).json({
      error: 'Forbidden: tenant administrator or workspace super-admin role required.',
      code: 'FORBIDDEN',
    });
  }
  req.authUser = user;
  return next();
});

const requireSuperAdmin = asyncHandler<AuthenticatedRequest>(async (req, res, next) => {
  const user = await resolveAuthUser(req);
  if (!user) {
    return res.status(401).json({
      error: 'Workspace administrator sign-in required.',
      code: 'UNAUTHENTICATED',
    });
  }
  if (user.role !== 'super_admin') {
    return res.status(403).json({
      error: 'Forbidden: super-admin role required for global workspace operations.',
      code: 'FORBIDDEN',
    });
  }
  req.authUser = user;
  return next();
});

function deserializeTenantRow(rawData: string): TenantConfig | null {
  const parsed = safeJsonParse<TenantConfig | null>(rawData, null);
  if (!parsed) return null;
  if (parsed.webhookConfig?.signingSecret) {
    parsed.webhookConfig = {
      ...parsed.webhookConfig,
      signingSecret: decryptSecretAtRest(parsed.webhookConfig.signingSecret, getWebhookEncryptionSecret()),
    };
  }
  return parsed;
}

function serializeTenantForStorage(tenant: TenantConfig): string {
  const clone: TenantConfig = {
    ...tenant,
    ...(tenant.webhookConfig
      ? {
          webhookConfig: {
            ...tenant.webhookConfig,
            ...(tenant.webhookConfig.signingSecret?.trim()
              ? {
                  signingSecret: encryptSecretAtRest(
                    tenant.webhookConfig.signingSecret.trim(),
                    getWebhookEncryptionSecret()
                  ),
                }
              : {}),
          },
        }
      : {}),
  };
  return JSON.stringify(clone);
}

function getTenantByIdStrict(tenantId: string): TenantConfig | null {
  const row = db.prepare('SELECT data FROM tenants WHERE id = ?').get(tenantId) as { data: string } | undefined;
  if (!row) return null;
  return deserializeTenantRow(row.data);
}

function toPublicTenantSummary(tenant: TenantConfig): TenantConfig {
  return {
    ...tenant,
    systemPrompt: '[Protected — sign in as tenant admin to inspect or edit prompt]',
    knowledgeBase: [],
    humanHandoffContact: {
      department: tenant.humanHandoffContact.department,
      phone: tenant.humanHandoffContact.phone,
      email: 'Protected (sign in as admin)',
    },
    webhookConfig: tenant.webhookConfig
      ? {
          enabled: tenant.webhookConfig.enabled,
          providerType: tenant.webhookConfig.providerType,
          url: tenant.webhookConfig.enabled ? '[Protected Webhook Endpoint]' : '',
          secretHeaderName: tenant.webhookConfig.secretHeaderName,
        }
      : undefined,
    isPublicSummaryOnly: true,
  };
}

function toSafeAdminTenant(tenant: TenantConfig): TenantConfig {
  if (!tenant.webhookConfig) return tenant;
  return {
    ...tenant,
    webhookConfig: {
      ...tenant.webhookConfig,
      signingSecret: tenant.webhookConfig.signingSecret ? '********' : undefined,
    },
  };
}

function insertWebhookDeliveryRecord(params: {
  id: string;
  tenantId: string;
  sessionId?: string | null;
  eventType: string;
  targetUrl: string;
  status: IntegrationDelivery['status'];
  attemptCount: number;
  lastStatusCode: number | null;
  lastError: string | null;
  latencyMs: number | null;
  idempotencyKey: string;
  payloadJson: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}): IntegrationDelivery {
  db.prepare(
    `INSERT INTO integration_deliveries
      (id, tenant_id, session_id, event_type, target_url, status, attempt_count, last_status_code, last_error, latency_ms, idempotency_key, payload_json, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.id,
    params.tenantId,
    params.sessionId ?? null,
    params.eventType,
    params.targetUrl,
    params.status,
    params.attemptCount,
    params.lastStatusCode,
    params.lastError,
    params.latencyMs,
    params.idempotencyKey,
    params.payloadJson,
    params.createdAt,
    params.updatedAt,
    params.expiresAt
  );
  return {
    id: params.id,
    tenantId: params.tenantId,
    sessionId: params.sessionId || null,
    eventType: params.eventType,
    targetUrl: params.targetUrl,
    status: params.status,
    attemptCount: params.attemptCount,
    lastStatusCode: params.lastStatusCode,
    lastError: params.lastError,
    latencyMs: params.latencyMs,
    idempotencyKey: params.idempotencyKey,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
  };
}

async function enqueueAndDispatchWebhook(params: {
  tenant: TenantConfig;
  sessionId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<IntegrationDelivery> {
  const now = Date.now();
  const expiresAt = now + RETENTION_POLICY_DAYS.appointmentDays * 24 * 60 * 60 * 1000;
  const id = `del_${crypto.randomUUID().slice(0, 12)}`;
  const cfg = params.tenant.webhookConfig;
  const payloadJson = JSON.stringify({
    eventType: params.eventType,
    tenantId: params.tenant.id,
    tenantName: params.tenant.name,
    timestamp: new Date(now).toISOString(),
    idempotencyKey: params.idempotencyKey,
    data: params.payload,
  });

  if (!cfg || !cfg.enabled || !cfg.url?.trim()) {
    return insertWebhookDeliveryRecord({
      id,
      tenantId: params.tenant.id,
      sessionId: params.sessionId || null,
      eventType: params.eventType,
      targetUrl: '',
      status: 'not_configured',
      attemptCount: 0,
      lastStatusCode: null,
      lastError: null,
      latencyMs: null,
      idempotencyKey: params.idempotencyKey,
      payloadJson,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
  }

  const secret = cfg.signingSecret?.trim() || WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    return insertWebhookDeliveryRecord({
      id,
      tenantId: params.tenant.id,
      sessionId: params.sessionId || null,
      eventType: params.eventType,
      targetUrl: cfg.url,
      status: 'failed',
      attemptCount: 0,
      lastStatusCode: null,
      lastError: 'Webhook signing secret is not configured (set tenant signingSecret or WEBHOOK_SIGNING_SECRET).',
      latencyMs: null,
      idempotencyKey: params.idempotencyKey,
      payloadJson,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
  }

  const outcome = await dispatchWebhookWithRetry({
    targetUrl: cfg.url,
    signingSecret: secret,
    secretHeaderName: cfg.secretHeaderName,
    payloadJson,
    idempotencyKey: params.idempotencyKey,
    allowLocal: ALLOW_LOCAL_WEBHOOKS,
    maxAttempts: 3,
    backoffMs: [0, 150, 350],
    timeoutMs: 2500,
  });

  return insertWebhookDeliveryRecord({
    id,
    tenantId: params.tenant.id,
    sessionId: params.sessionId || null,
    eventType: params.eventType,
    targetUrl: cfg.url,
    status: outcome.status,
    attemptCount: outcome.attemptCount,
    lastStatusCode: outcome.lastStatusCode,
    lastError: outcome.lastError,
    latencyMs: outcome.latencyMs,
    idempotencyKey: params.idempotencyKey,
    payloadJson,
    createdAt: now,
    updatedAt: Date.now(),
    expiresAt,
  });
}

/**
 * Persists a pending delivery record synchronously and dispatches the webhook asynchronously
 * so outbound HTTP timeouts/retries never block real-time voice turn responses.
 */
function queueWebhookDeliveryAsync(params: {
  tenant: TenantConfig;
  sessionId?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}): IntegrationDelivery | null {
  const cfg = params.tenant.webhookConfig;
  if (!cfg || !cfg.enabled || !cfg.url?.trim()) {
    return null;
  }
  const now = Date.now();
  const expiresAt = now + RETENTION_POLICY_DAYS.appointmentDays * 24 * 60 * 60 * 1000;
  const id = `del_${crypto.randomUUID().slice(0, 12)}`;
  const payloadJson = JSON.stringify({
    eventType: params.eventType,
    tenantId: params.tenant.id,
    tenantName: params.tenant.name,
    timestamp: new Date(now).toISOString(),
    idempotencyKey: params.idempotencyKey,
    data: params.payload,
  });

  const secret = cfg.signingSecret?.trim() || WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    return insertWebhookDeliveryRecord({
      id,
      tenantId: params.tenant.id,
      sessionId: params.sessionId || null,
      eventType: params.eventType,
      targetUrl: cfg.url,
      status: 'failed',
      attemptCount: 0,
      lastStatusCode: null,
      lastError: 'Webhook signing secret is not configured (set tenant signingSecret or WEBHOOK_SIGNING_SECRET).',
      latencyMs: null,
      idempotencyKey: params.idempotencyKey,
      payloadJson,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
  }

  const pending = insertWebhookDeliveryRecord({
    id,
    tenantId: params.tenant.id,
    sessionId: params.sessionId || null,
    eventType: params.eventType,
    targetUrl: cfg.url,
    status: 'pending',
    attemptCount: 0,
    lastStatusCode: null,
    lastError: null,
    latencyMs: null,
    idempotencyKey: params.idempotencyKey,
    payloadJson,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  });

  void dispatchWebhookWithRetry({
    targetUrl: cfg.url,
    signingSecret: secret,
    secretHeaderName: cfg.secretHeaderName,
    payloadJson,
    idempotencyKey: params.idempotencyKey,
    allowLocal: ALLOW_LOCAL_WEBHOOKS,
    maxAttempts: 3,
    backoffMs: [0, 150, 350],
    timeoutMs: 2500,
  })
    .then(outcome => {
      try {
        db.prepare(
          'UPDATE integration_deliveries SET status = ?, attempt_count = ?, last_status_code = ?, last_error = ?, latency_ms = ?, updated_at = ? WHERE id = ?'
        ).run(
          outcome.status,
          outcome.attemptCount,
          outcome.lastStatusCode,
          outcome.lastError,
          outcome.latencyMs,
          Date.now(),
          id
        );
      } catch {
        // ignore if DB already closed during shutdown
      }
    })
    .catch(err => {
      try {
        db.prepare(
          'UPDATE integration_deliveries SET status = ?, attempt_count = 1, last_error = ?, updated_at = ? WHERE id = ?'
        ).run('failed', String(err).slice(0, 300), Date.now(), id);
      } catch {
        // ignore
      }
    });

  return pending;
}

function writeAuditLog(params: {
  req?: AuthenticatedRequest;
  actorId?: string;
  actorRole?: string;
  action: string;
  tenantId?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    const id = `aud_${crypto.randomUUID().slice(0, 12)}`;
    const traceId = params.req?.traceId || crypto.randomUUID();
    const actorId = params.actorId || params.req?.authUser?.sub || 'anonymous';
    const actorRole = params.actorRole || params.req?.authUser?.role || 'public';
    db.prepare(
      'INSERT INTO audit_logs (id, trace_id, actor_id, actor_role, action, tenant_id, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id,
      traceId,
      actorId,
      actorRole,
      params.action,
      params.tenantId || null,
      params.targetId || null,
      JSON.stringify(params.metadata || {}),
      Date.now()
    );
  } catch {
    // non-fatal audit failure
  }
}

function generateUniqueTicketId(prefix: 'HND' | 'VANI', table: 'handoff_tickets' | 'support_tickets'): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const existing = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(candidate);
    if (!existing) return candidate;
  }
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function createHandoffTicket(params: {
  tenant: TenantConfig;
  sessionId: string;
  reason: string;
  priority: 'critical' | 'high' | 'normal';
  summary: string;
  isDemo?: boolean;
}): HandoffTicket {
  const now = Date.now();
  const expiresAt = now + RETENTION_POLICY_DAYS.safetyTicketDays * 24 * 60 * 60 * 1000;
  const id = generateUniqueTicketId('HND', 'handoff_tickets');
  const ticket: HandoffTicket = {
    id,
    tenantId: params.tenant.id,
    tenantName: params.tenant.name,
    sessionId: params.sessionId,
    reason: params.reason,
    priority: params.priority,
    summary: params.summary.slice(0, 400),
    department: params.tenant.humanHandoffContact.department,
    phone: params.tenant.humanHandoffContact.phone,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO handoff_tickets
      (id, tenant_id, tenant_name, session_id, reason, priority, summary, department, phone, status, notes, created_at, updated_at, expires_at, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    ticket.id,
    ticket.tenantId,
    ticket.tenantName || params.tenant.name,
    ticket.sessionId,
    ticket.reason,
    ticket.priority,
    ticket.summary,
    ticket.department,
    ticket.phone,
    ticket.status,
    null,
    ticket.createdAt,
    ticket.updatedAt,
    expiresAt,
    params.isDemo ? 1 : 0
  );

  return ticket;
}

function getBookedSlotsForDoctor(tenantId: string, doctor?: string): string[] {
  const cleanDoc = doctor?.trim() || '';
  if (!cleanDoc) {
    const rows = db
      .prepare("SELECT slot FROM appointments WHERE tenant_id = ? AND status = 'confirmed'")
      .all(tenantId) as { slot: string }[];
    return rows.map(r => r.slot);
  }
  const escapedDoc = cleanDoc.replace(/[\\%_]/g, '\\$&');
  const rows = db
    .prepare(
      "SELECT slot FROM appointments WHERE tenant_id = ? AND status = 'confirmed' AND (LOWER(doctor) = LOWER(?) OR LOWER(doctor) LIKE LOWER(?) ESCAPE '\\')"
    )
    .all(tenantId, cleanDoc, `%${escapedDoc}%`) as { slot: string }[];
  return rows.map(r => r.slot);
}

interface PendingActionRow {
  id: string;
  session_id: string;
  tenant_id: string;
  tool_name: string;
  params_hash: string;
  idempotency_key: string | null;
  status: string;
  result_json: string | null;
  created_at: number;
  created_request_id: string | null;
  expires_at: number | null;
}

function executeServerToolWithDurability(params: {
  calledName: string;
  callArgs: Record<string, any>;
  tenant: TenantConfig;
  sessionId: string;
  activeLang: SupportedLanguage;
  userConfirmed: boolean;
  isDemo?: boolean;
  idempotencyKey?: string;
  req?: AuthenticatedRequest;
}): ToolExecutionResult {
  const { calledName, callArgs, tenant, sessionId, activeLang, userConfirmed, isDemo, idempotencyKey, req } = params;

  if (calledName === 'check_slot_availability') {
    const booked = getBookedSlotsForDoctor(tenant.id, typeof callArgs.doctor === 'string' ? callArgs.doctor : undefined);
    const availableSlots = computeAvailableSlots(booked);
    return executeTenantTool(calledName, callArgs, tenant.name, activeLang, { availableSlots });
  }

  const requiresConfirmationGate =
    calledName === 'book_appointment' || calledName === 'reschedule_delivery';

  if (!requiresConfirmationGate) {
    return executeTenantTool(calledName, callArgs, tenant.name, activeLang);
  }

  // Never trust model/client-supplied `confirmed` flag; derive confirmation strictly from user's latest turn
  callArgs.confirmed = false;

  const { paramsHash } = canonicalizeToolParams(calledName, callArgs);
  const requestedActionId = typeof callArgs.actionId === 'string' ? callArgs.actionId.trim() : '';

  let pendingRow: PendingActionRow | undefined;

  if (requestedActionId) {
    const byId = db
      .prepare('SELECT * FROM pending_actions WHERE id = ? AND session_id = ? AND tenant_id = ? AND tool_name = ?')
      .get(requestedActionId, sessionId, tenant.id, calledName) as PendingActionRow | undefined;

    if (byId) {
      if (byId.status === 'completed' && byId.params_hash === paramsHash && byId.result_json) {
        const parsedCached = safeJsonParse<ToolExecutionResult | null>(byId.result_json, null);
        if (parsedCached) return parsedCached;
      }
      if (byId.params_hash === paramsHash) {
        pendingRow = byId;
      }
    }
  }

  if (!pendingRow) {
    pendingRow = db
      .prepare(
        "SELECT * FROM pending_actions WHERE session_id = ? AND tenant_id = ? AND tool_name = ? AND params_hash = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
      )
      .get(sessionId, tenant.id, calledName, paramsHash) as PendingActionRow | undefined;
  }

  if (
    userConfirmed &&
    pendingRow &&
    pendingRow.status === 'pending' &&
    (!pendingRow.created_request_id || pendingRow.created_request_id !== req?.traceId)
  ) {
    callArgs.confirmed = true;
  } else if (userConfirmed && idempotencyKey) {
    const completedRow = db
      .prepare(
        "SELECT result_json FROM pending_actions WHERE session_id = ? AND tenant_id = ? AND tool_name = ? AND params_hash = ? AND idempotency_key = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1"
      )
      .get(sessionId, tenant.id, calledName, paramsHash, idempotencyKey) as { result_json: string } | undefined;
    const parsedCached = safeJsonParse<ToolExecutionResult | null>(completedRow?.result_json, null);
    if (parsedCached) return parsedCached;
  }

  const generatedBookingRef =
    calledName === 'book_appointment' && callArgs.confirmed
      ? `KAL-APT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
      : undefined;

  const toolResult = executeTenantTool(calledName, callArgs, tenant.name, activeLang, {
    bookingRef: generatedBookingRef,
  });

  if (toolResult.requiresConfirmation) {
    const now = Date.now();
    const pendingExpiresAt = now + RETENTION_POLICY_DAYS.pendingActionHours * 60 * 60 * 1000;
    const actionId = pendingRow?.id || `act_${crypto.randomUUID().slice(0, 12)}`;
    if (!pendingRow) {
      db.prepare(
        'INSERT INTO pending_actions (id, session_id, tenant_id, tool_name, params_hash, idempotency_key, status, result_json, created_at, created_request_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        actionId,
        sessionId,
        tenant.id,
        calledName,
        paramsHash,
        null,
        'pending',
        null,
        now,
        req?.traceId || null,
        pendingExpiresAt
      );
    }
    toolResult.data = {
      ...(toolResult.data || {}),
      actionId,
      paramsHash,
    };
    return toolResult;
  }

  if (toolResult.success && callArgs.confirmed && pendingRow) {
    if (calledName === 'book_appointment') {
      const doctor = String(callArgs.doctor).trim();
      const slot = String(callArgs.slot).trim();
      const patientName = String(callArgs.patientName).trim();

      db.exec('BEGIN IMMEDIATE');
      try {
        const bookedSlots = getBookedSlotsForDoctor(tenant.id, doctor);
        if (isSlotAlreadyBooked(slot, bookedSlots)) {
          db.prepare("UPDATE pending_actions SET status = 'conflict' WHERE id = ? AND status = 'pending'").run(
            pendingRow.id
          );
          db.exec('COMMIT');
          const remaining = computeAvailableSlots(bookedSlots);
          return {
            success: false,
            toolName: calledName,
            outputMessage:
              remaining.length > 0
                ? `Sorry, ${slot} with ${doctor} is already booked. Available open slots: ${remaining.join(', ')}.`
                : `Sorry, ${slot} with ${doctor} is already booked and no open slots remain today.`,
            data: {
              conflict: true,
              doctor,
              slot,
              availableSlots: remaining,
              actionId: pendingRow.id,
            },
          };
        }

        const currentAction = db
          .prepare('SELECT status, result_json FROM pending_actions WHERE id = ?')
          .get(pendingRow.id) as { status: string; result_json: string | null } | undefined;
        if (!currentAction || currentAction.status !== 'pending') {
          db.exec('ROLLBACK');
          const parsedCached = safeJsonParse<ToolExecutionResult | null>(currentAction?.result_json, null);
          if (parsedCached) return parsedCached;
          return {
            success: false,
            toolName: calledName,
            outputMessage: 'This confirmation was already processed. Please start a new booking request if needed.',
            data: { actionId: pendingRow.id },
          };
        }

        const bookingRef = String(
          toolResult.data?.bookingRef || generatedBookingRef || `KAL-APT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
        );
        const now = Date.now();
        const expiresAt = now + RETENTION_POLICY_DAYS.appointmentDays * 24 * 60 * 60 * 1000;

        db.prepare(
          'INSERT INTO appointments (id, tenant_id, session_id, doctor, slot, patient_name, status, action_id, created_at, expires_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          bookingRef,
          tenant.id,
          sessionId,
          doctor,
          slot,
          patientName,
          'confirmed',
          pendingRow.id,
          now,
          expiresAt,
          isDemo ? 1 : 0
        );

        toolResult.data = {
          ...(toolResult.data || {}),
          bookingRef,
          actionId: pendingRow.id,
        };
        db.prepare(
          "UPDATE pending_actions SET status = 'completed', idempotency_key = ?, result_json = ? WHERE id = ? AND status = 'pending'"
        ).run(idempotencyKey || null, JSON.stringify(toolResult), pendingRow.id);
        db.exec('COMMIT');

        writeAuditLog({
          req,
          actorId: sessionId,
          actorRole: req?.authUser?.role || 'caller',
          action: 'appointment.booked',
          tenantId: tenant.id,
          targetId: bookingRef,
          metadata: { doctor, slot, actionId: pendingRow.id, demoMode: Boolean(isDemo) },
        });
        return toolResult;
      } catch (err: any) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // ignore if already rolled back
        }
        const errMsg = String(err?.message || err || '');
        if (/UNIQUE constraint failed/i.test(errMsg)) {
          const bookedSlots = getBookedSlotsForDoctor(tenant.id, doctor);
          const remaining = computeAvailableSlots(bookedSlots);
          return {
            success: false,
            toolName: calledName,
            outputMessage:
              remaining.length > 0
                ? `Sorry, ${slot} with ${doctor} was just booked by another caller. Available open slots: ${remaining.join(', ')}.`
                : `Sorry, ${slot} with ${doctor} is already booked and no open slots remain today.`,
            data: {
              conflict: true,
              doctor,
              slot,
              availableSlots: remaining,
              actionId: pendingRow.id,
            },
          };
        }
        throw err;
      }
    }

    // reschedule_delivery or other gated action
    const claim = db
      .prepare("UPDATE pending_actions SET status = 'completed', idempotency_key = ? WHERE id = ? AND status = 'pending'")
      .run(idempotencyKey || null, pendingRow.id);

    if (Number(claim.changes || 0) === 0) {
      const existing = db
        .prepare('SELECT result_json FROM pending_actions WHERE id = ?')
        .get(pendingRow.id) as { result_json: string } | undefined;
      const parsedCached = safeJsonParse<ToolExecutionResult | null>(existing?.result_json, null);
      if (parsedCached) return parsedCached;
    }

    toolResult.data = {
      ...(toolResult.data || {}),
      actionId: pendingRow.id,
    };
    db.prepare('UPDATE pending_actions SET result_json = ? WHERE id = ?').run(
      JSON.stringify(toolResult),
      pendingRow.id
    );
    writeAuditLog({
      req,
      actorId: sessionId,
      actorRole: req?.authUser?.role || 'caller',
      action: `tool.${calledName}.confirmed`,
      tenantId: tenant.id,
      targetId: pendingRow.id,
      metadata: { orderId: callArgs.orderId, newDate: callArgs.newDate, demoMode: Boolean(isDemo) },
    });
  }

  return toolResult;
}

// -------------------------------------------------------------
// 5. Authentication & Session Endpoints
// -------------------------------------------------------------
app.get(
  '/api/session',
  asyncHandler(async (req, res) => {
    const user = await resolveAuthUser(req);
    const bootstrapDone = isBootstrapCompleted();
    const isAdminUser = Boolean(user && (user.role === 'tenant_admin' || user.role === 'super_admin'));
    res.json({
      authenticated: Boolean(user),
      authRequiredForAdmin: true,
      adminBootstrapNeeded: !ADMIN_PASSCODE && !bootstrapDone,
      bootstrapRequiresToken: Boolean(ADMIN_BOOTSTRAP_TOKEN),
      passcodeConfigured: Boolean(ADMIN_PASSCODE),
      oidcEnabled: true,
      user: user
        ? {
            id: user.sub,
            sessionId: user.sessionId,
            name: user.name,
            email: user.email,
            role: user.role,
            allowedTenants: user.allowedTenants,
          }
        : null,
      retentionPolicy: {
        defaultDays: RETENTION_POLICY_DAYS.defaultTranscriptDays,
        safetyTicketDays: RETENTION_POLICY_DAYS.safetyTicketDays,
        supportTicketDays: RETENTION_POLICY_DAYS.supportTicketDays,
        appointmentDays: RETENTION_POLICY_DAYS.appointmentDays,
        options: [7, 30, 90, 0],
      },
      serverAiActive: Boolean(aiClient),
      ...(isAdminUser ? { modelUsed: GEMINI_CHAT_MODEL } : {}),
    });
  })
);

app.post('/api/auth/caller-session', callerSessionLimiter, (_req, res) => {
  const sessionId = `sess_${crypto.randomUUID()}`;
  const token = signSessionToken(
    {
      sub: sessionId,
      sessionId,
      email: 'caller@session.local',
      name: 'Voice Caller Session',
      role: 'caller',
      allowedTenants: [],
    },
    SESSION_SECRET,
    4 * 3600
  );

  res.status(201).json({
    token,
    user: {
      id: sessionId,
      sessionId,
      name: 'Voice Caller Session',
      email: 'caller@session.local',
      role: 'caller',
      allowedTenants: [],
    },
  });
});

// Precomputed dummy scrypt hash for constant-time missing-user login verification
const DUMMY_PASSWORD_HASH =
  '00000000000000000000000000000000:' + '0'.repeat(128);

app.post(
  '/api/auth/bootstrap',
  authLimiter,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    if (ADMIN_PASSCODE) {
      return res.status(403).json({
        error: 'Workspace passcode is configured via ADMIN_PASSCODE. Use standard sign-in instead.',
      });
    }

    const parsed = AuthBootstrapSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid setup input.' });
    }

    const { name, email, password, bootstrapToken } = parsed.data;
    if (ADMIN_BOOTSTRAP_TOKEN) {
      if (!bootstrapToken || !constantTimeEqualString(bootstrapToken, ADMIN_BOOTSTRAP_TOKEN)) {
        return res.status(403).json({
          error: 'Invalid or missing administrator bootstrap token.',
        });
      }
    }

    const normalizedEmail = email.toLowerCase();
    const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
    const sessionId = `sess_${crypto.randomUUID()}`;
    const passwordHash = await hashPasswordAsync(password);

    db.exec('BEGIN IMMEDIATE');
    try {
      if (isBootstrapCompleted()) {
        db.exec('ROLLBACK');
        return res.status(409).json({
          error: 'Workspace administrator account has already been claimed. Please sign in.',
        });
      }
      db.prepare(
        'INSERT INTO users (id, email, name, role, allowed_tenants, password_hash, revoked, auth_provider, token_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(userId, normalizedEmail, name, 'super_admin', JSON.stringify(['*']), passwordHash, 0, 'workspace_local', 1, Date.now());
      db.prepare("INSERT OR REPLACE INTO system_meta (key, value) VALUES ('bootstrap_completed', 'true')").run();
      db.exec('COMMIT');
    } catch {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      return res.status(409).json({ error: 'Administrator email already exists.' });
    }

    writeAuditLog({
      req,
      actorId: userId,
      actorRole: 'super_admin',
      action: 'auth.bootstrap',
      targetId: userId,
      metadata: { protectedByToken: Boolean(ADMIN_BOOTSTRAP_TOKEN) },
    });

    const token = signSessionToken(
      {
        sub: userId,
        sessionId,
        email: normalizedEmail,
        name,
        role: 'super_admin',
        allowedTenants: ['*'],
        ver: 1,
      },
      SESSION_SECRET
    );

    res.status(201).json({
      token,
      user: {
        id: userId,
        sessionId,
        name,
        email: normalizedEmail,
        role: 'super_admin',
        allowedTenants: ['*'],
      },
    });
  })
);

app.post(
  '/api/auth/login',
  authLimiter,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const parsed = AuthLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid credentials payload.' });
    }

    const { email, password } = parsed.data;
    const sessionId = `sess_${crypto.randomUUID()}`;

    // 1. Check ADMIN_PASSCODE override if configured on server
    if (ADMIN_PASSCODE && constantTimeEqualString(password, ADMIN_PASSCODE)) {
      const adminEmail = (email || 'admin@workspace.local').toLowerCase();
      const token = signSessionToken(
        {
          sub: 'usr_env_admin',
          sessionId,
          email: adminEmail,
          name: 'Workspace Administrator',
          role: 'super_admin',
          allowedTenants: ['*'],
        },
        SESSION_SECRET
      );
      writeAuditLog({
        req,
        actorId: 'usr_env_admin',
        actorRole: 'super_admin',
        action: 'auth.login',
        metadata: { method: 'admin_passcode' },
      });
      return res.json({
        token,
        user: {
          id: 'usr_env_admin',
          sessionId,
          name: 'Workspace Administrator',
          email: adminEmail,
          role: 'super_admin',
          allowedTenants: ['*'],
        },
      });
    }

    // 2. Check registered SQLite user
    if (!email) {
      return res.status(401).json({ error: 'Email and password are required to sign in.' });
    }

    const normalizedEmail = email.toLowerCase();
    const now = Date.now();
    const emailThrottle = failedLoginByEmail.get(normalizedEmail);
    if (emailThrottle && now - emailThrottle.windowStart <= 15 * 60 * 1000 && emailThrottle.count >= 5) {
      return res.status(429).json({
        error: 'Too many failed sign-in attempts for this account. Wait 15 minutes before trying again.',
        code: 'RATE_LIMITED',
        retryable: true,
      });
    }

    const row = db
      .prepare('SELECT id, email, name, role, allowed_tenants, password_hash, revoked, token_version FROM users WHERE email = ?')
      .get(normalizedEmail) as
      | {
          id: string;
          email: string;
          name: string;
          role: 'tenant_admin' | 'super_admin' | 'caller';
          allowed_tenants: string;
          password_hash: string;
          revoked: number;
          token_version: number;
        }
      | undefined;

    const hashToCheck = row?.password_hash || DUMMY_PASSWORD_HASH;
    const validPassword = await verifyPasswordAsync(password, hashToCheck);

    if (!row || !validPassword) {
      const existingBucket = failedLoginByEmail.get(normalizedEmail);
      if (!existingBucket || now - existingBucket.windowStart > 15 * 60 * 1000) {
        failedLoginByEmail.set(normalizedEmail, { count: 1, windowStart: now });
      } else {
        existingBucket.count += 1;
      }
      writeAuditLog({
        req,
        actorId: row?.id || 'unknown',
        actorRole: 'public',
        action: 'auth.login_failed',
        metadata: { email: normalizedEmail },
      });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (row.revoked === 1) {
      return res.status(403).json({ error: 'Your workspace access has been revoked by an administrator.', code: 'USER_REVOKED' });
    }

    failedLoginByEmail.delete(normalizedEmail);
    const allowedTenants = safeJsonParse<string[]>(row.allowed_tenants, []);
    const token = signSessionToken(
      {
        sub: row.id,
        sessionId,
        email: row.email,
        name: row.name,
        role: row.role,
        allowedTenants,
        ver: row.token_version || 1,
      },
      SESSION_SECRET
    );

    writeAuditLog({
      req,
      actorId: row.id,
      actorRole: row.role,
      action: 'auth.login',
      metadata: { method: 'password' },
    });

    return res.json({
      token,
      user: {
        id: row.id,
        sessionId,
        name: row.name,
        email: row.email,
        role: row.role,
        allowedTenants,
        authProvider: 'workspace_local',
      },
    });
  })
);

app.post(
  '/api/auth/firebase',
  authLimiter,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const parsed = FirebaseAuthExchangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Valid Firebase OIDC idToken is required.' });
    }

    const fbClaims = await verifyFirebaseIdToken(parsed.data.idToken);
    if (!fbClaims) {
      return res.status(401).json({ error: 'Invalid or unverified Google OIDC token.' });
    }

    const userRow = upsertFirebaseUserRecord(fbClaims);
    if (!userRow) {
      return res.status(500).json({ error: 'Failed to provision federated user record.' });
    }
    if (userRow.revoked === 1) {
      return res.status(403).json({
        error: 'Workspace access for this Google account has been revoked.',
        code: 'USER_REVOKED',
      });
    }

    const allowedTenants = safeJsonParse<string[]>(userRow.allowed_tenants, []);
    const sessionId = `fb_${fbClaims.uid}`;
    const token = signSessionToken(
      {
        sub: userRow.id,
        sessionId,
        email: userRow.email,
        name: userRow.name,
        role: userRow.role,
        allowedTenants,
        ver: userRow.token_version || 1,
      },
      SESSION_SECRET
    );

    writeAuditLog({
      req,
      actorId: userRow.id,
      actorRole: userRow.role,
      action: 'auth.firebase_oidc',
      targetId: userRow.id,
      metadata: { email: userRow.email },
    });

    return res.json({
      token,
      user: {
        id: userRow.id,
        sessionId,
        name: userRow.name,
        email: userRow.email,
        role: userRow.role,
        allowedTenants,
        authProvider: 'firebase_oidc',
      },
    });
  })
);

app.get('/api/auth/users', requireSuperAdmin, (_req, res) => {
  const rows = db
    .prepare('SELECT id, email, name, role, allowed_tenants, revoked, auth_provider, created_at FROM users ORDER BY created_at DESC')
    .all() as any[];
  res.json(
    rows.map(r => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      allowedTenants: safeJsonParse<string[]>(r.allowed_tenants, []),
      revoked: r.revoked === 1,
      authProvider: r.auth_provider || 'workspace_local',
      createdAt: r.created_at,
    }))
  );
});

app.post(
  '/api/auth/users',
  requireSuperAdmin,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const parsed = TenantAdminCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid user payload.' });
    }
    const { name, email, password, role, allowedTenants } = parsed.data;
    const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
    const passwordHash = await hashPasswordAsync(password);

    try {
      db.prepare(
        'INSERT INTO users (id, email, name, role, allowed_tenants, password_hash, revoked, auth_provider, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)'
      ).run(userId, email.toLowerCase(), name, role, JSON.stringify(allowedTenants), passwordHash, 'workspace_local', Date.now());
      writeAuditLog({
        req,
        action: 'auth.user_created',
        targetId: userId,
        metadata: { role, allowedTenants },
      });
      return res.status(201).json({
        success: true,
        user: { id: userId, email: email.toLowerCase(), name, role, allowedTenants, revoked: false },
      });
    } catch {
      return res.status(409).json({ error: 'A user with that email already exists.' });
    }
  })
);

app.patch('/api/auth/users/:id/role', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const parsed = UserRoleUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid role payload.' });
  }

  const row = db
    .prepare('SELECT id, email, role, revoked, allowed_tenants FROM users WHERE id = ?')
    .get(id) as { id: string; email: string; role: string; revoked: number; allowed_tenants: string } | undefined;
  if (!row) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (id === req.authUser?.sub && parsed.data.role !== 'super_admin') {
    return res.status(409).json({ error: 'Administrators cannot demote their own super-admin account.' });
  }

  if (row.role === 'super_admin' && row.revoked === 0 && parsed.data.role !== 'super_admin') {
    const activeSuperAdmins = (
      db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'super_admin' AND revoked = 0").get() as { cnt: number }
    ).cnt;
    if (activeSuperAdmins <= 1) {
      return res.status(409).json({ error: 'Cannot demote the last active workspace super-admin.' });
    }
  }

  const nextTenants =
    parsed.data.role === 'super_admin'
      ? ['*']
      : parsed.data.role === 'caller'
      ? []
      : parsed.data.allowedTenants && parsed.data.allowedTenants.length > 0
      ? parsed.data.allowedTenants
      : safeJsonParse<string[]>(row.allowed_tenants, []);

  db.prepare('UPDATE users SET role = ?, allowed_tenants = ?, token_version = token_version + 1 WHERE id = ?').run(
    parsed.data.role,
    JSON.stringify(nextTenants),
    id
  );
  writeAuditLog({
    req,
    action: 'auth.user_role_updated',
    targetId: id,
    metadata: { role: parsed.data.role, allowedTenants: nextTenants },
  });

  return res.json({
    success: true,
    user: { id: row.id, email: row.email, role: parsed.data.role, allowedTenants: nextTenants },
  });
});

app.post('/api/auth/users/:id/revoke', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  if (id === req.authUser?.sub) {
    return res.status(400).json({ error: 'Administrators cannot revoke their own active session.' });
  }
  const parsed = UserRevokeUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'revoked boolean is required.' });
  }

  const row = db.prepare('SELECT id, email, role, revoked FROM users WHERE id = ?').get(id) as
    | { id: string; email: string; role: string; revoked: number }
    | undefined;
  if (!row) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (parsed.data.revoked && row.role === 'super_admin' && row.revoked === 0) {
    const activeSuperAdmins = (
      db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'super_admin' AND revoked = 0").get() as { cnt: number }
    ).cnt;
    if (activeSuperAdmins <= 1) {
      return res.status(409).json({ error: 'Cannot revoke the last active workspace super-admin.' });
    }
  }

  db.prepare('UPDATE users SET revoked = ?, token_version = token_version + 1 WHERE id = ?').run(
    parsed.data.revoked ? 1 : 0,
    id
  );
  writeAuditLog({
    req,
    action: parsed.data.revoked ? 'auth.user_revoked' : 'auth.user_restored',
    targetId: id,
    metadata: { revoked: parsed.data.revoked },
  });

  return res.json({ success: true, id: row.id, revoked: parsed.data.revoked });
});

// -------------------------------------------------------------
// 6. Multi-Tenant Endpoints (Public Summaries vs Scoped Admin)
// -------------------------------------------------------------
app.get(
  '/api/tenants',
  asyncHandler(async (req, res) => {
    const user = await resolveAuthUser(req);
    const rows = db.prepare('SELECT data FROM tenants').all() as { data: string }[];
    const allTenants = rows
      .map(r => deserializeTenantRow(r.data))
      .filter((t): t is TenantConfig => Boolean(t));

    if (user && (user.role === 'super_admin' || user.role === 'tenant_admin')) {
      const scoped = allTenants.filter(t => canAccessTenant(user, t.id)).map(toSafeAdminTenant);
      return res.json(scoped);
    }

    return res.json(allTenants.map(toPublicTenantSummary));
  })
);

app.get('/api/tenants/:id', requireAdmin, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  if (!canAccessTenant(req.authUser, id)) {
    return res.status(403).json({ error: 'Forbidden: you do not have access to this tenant.' });
  }
  const tenant = getTenantByIdStrict(id);
  if (!tenant) {
    return res.status(404).json({ error: 'Tenant not found.' });
  }
  return res.json(toSafeAdminTenant(tenant));
});

app.post(
  '/api/tenants',
  requireSuperAdmin,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const parsed = TenantConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid tenant payload' });
    }
    const newTenant = parsed.data as TenantConfig;
    if (newTenant.webhookConfig?.enabled && newTenant.webhookConfig?.url) {
      const check = await resolveAndValidateOutboundWebhookUrl(newTenant.webhookConfig.url, ALLOW_LOCAL_WEBHOOKS);
      if (!check.valid) {
        return res.status(400).json({ error: check.reason || 'Invalid webhook URL.' });
      }
    }
    if (getTenantByIdStrict(newTenant.id)) {
      return res.status(409).json({ error: 'Tenant ID already exists.' });
    }
    db.prepare('INSERT INTO tenants (id, data, updated_at) VALUES (?, ?, ?)').run(
      newTenant.id,
      serializeTenantForStorage(newTenant),
      Date.now()
    );
    writeAuditLog({
      req,
      action: 'tenant.created',
      tenantId: newTenant.id,
      targetId: newTenant.id,
    });
    return res.status(201).json({ success: true, tenant: toSafeAdminTenant(newTenant) });
  })
);

app.post(
  '/api/tenants/:id',
  requireAdmin,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const { id } = req.params;
    if (!canAccessTenant(req.authUser, id)) {
      return res.status(403).json({ error: 'Forbidden: cannot modify another tenant.' });
    }
    const existing = getTenantByIdStrict(id);
    if (!existing) {
      return res.status(404).json({ error: 'Tenant not found.' });
    }

    const parsed = TenantConfigSchema.safeParse({ ...req.body, id });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid tenant payload' });
    }
    const updated = parsed.data as TenantConfig;
    if (updated.webhookConfig) {
      if (updated.webhookConfig.enabled && updated.webhookConfig.url) {
        const check = await resolveAndValidateOutboundWebhookUrl(updated.webhookConfig.url, ALLOW_LOCAL_WEBHOOKS);
        if (!check.valid) {
          return res.status(400).json({ error: check.reason || 'Invalid webhook URL.' });
        }
      }
      if (!updated.webhookConfig.signingSecret || updated.webhookConfig.signingSecret === '********') {
        updated.webhookConfig.signingSecret = existing.webhookConfig?.signingSecret;
      }
    }
    db.prepare('INSERT OR REPLACE INTO tenants (id, data, updated_at) VALUES (?, ?, ?)').run(
      id,
      serializeTenantForStorage(updated),
      Date.now()
    );
    writeAuditLog({
      req,
      action: 'tenant.updated',
      tenantId: id,
      targetId: id,
      metadata: {
        kbChunks: updated.knowledgeBase.length,
        toolsCount: updated.tools.length,
        webhookEnabled: Boolean(updated.webhookConfig?.enabled),
      },
    });
    return res.json({ success: true, tenant: toSafeAdminTenant(updated) });
  })
);

// -------------------------------------------------------------
// 7. Consent, Call Logs & Retention Enforcement
// -------------------------------------------------------------
app.post('/api/consent', requireAuthenticated, (req: AuthenticatedRequest, res) => {
  const parsed = ConsentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid consent payload.' });
  }

  const { consented, retentionDays, tenantId } = parsed.data;
  const sessionId = req.authUser!.sessionId;

  db.prepare(
    'INSERT OR REPLACE INTO consent_records (session_id, tenant_id, consented, retention_days, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(sessionId, tenantId || null, consented ? 1 : 0, retentionDays, Date.now());

  // Immediately purge any stored logs for this session if consent denied or zero retention selected
  if (!consented || retentionDays === 0) {
    db.prepare('DELETE FROM call_logs WHERE session_id = ?').run(sessionId);
  }

  return res.json({
    success: true,
    sessionId,
    consented,
    retentionDays,
  });
});

app.get('/api/logs', requireAdmin, (req: AuthenticatedRequest, res) => {
  const requestedTenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : undefined;
  const user = req.authUser!;
  const rawLimit = Number(req.query.limit ?? 200);
  const rawOffset = Number(req.query.offset ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.trunc(rawLimit))) : 200;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;

  if (requestedTenantId && !canAccessTenant(user, requestedTenantId)) {
    return res.status(403).json({ error: 'Forbidden: cannot access logs for requested tenant.' });
  }

  let rows: { tenant_id: string; data: string }[];
  if (requestedTenantId) {
    rows = db
      .prepare('SELECT tenant_id, data FROM call_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(requestedTenantId, limit, offset) as { tenant_id: string; data: string }[];
  } else if (user.role === 'super_admin' || user.allowedTenants.includes('*')) {
    rows = db
      .prepare('SELECT tenant_id, data FROM call_logs ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as { tenant_id: string; data: string }[];
  } else if (user.allowedTenants.length > 0) {
    const placeholders = user.allowedTenants.map(() => '?').join(', ');
    rows = db
      .prepare(
        `SELECT tenant_id, data FROM call_logs WHERE tenant_id IN (${placeholders}) ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...user.allowedTenants, limit, offset) as { tenant_id: string; data: string }[];
  } else {
    rows = [];
  }

  return res.json(rows.map(r => safeJsonParse<CallLog | null>(r.data, null)).filter((l): l is CallLog => Boolean(l)));
});

app.get('/api/session/logs', requireAuthenticated, (req: AuthenticatedRequest, res) => {
  const sessionId = req.authUser!.sessionId;
  const rows = db
    .prepare('SELECT data FROM call_logs WHERE session_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(sessionId) as { data: string }[];
  return res.json(rows.map(r => safeJsonParse<CallLog | null>(r.data, null)).filter((l): l is CallLog => Boolean(l)));
});

app.post('/api/logs', requireAuthenticated, (req: AuthenticatedRequest, res) => {
  const parsed = CallLogCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid call log payload.' });
  }

  const log = parsed.data as CallLog;
  if (!getTenantByIdStrict(log.tenantId)) {
    return res.status(404).json({ error: 'Tenant not found for call log.' });
  }

  const sessionId = req.authUser!.sessionId;
  const consent = db
    .prepare('SELECT consented, retention_days FROM consent_records WHERE session_id = ?')
    .get(sessionId) as { consented: number; retention_days: number } | undefined;

  if (!consent || consent.consented !== 1) {
    return res.status(200).json({
      success: true,
      persisted: false,
      reason: 'consent_not_granted',
    });
  }

  if (consent.retention_days === 0) {
    return res.status(200).json({
      success: true,
      persisted: false,
      reason: 'zero_retention',
    });
  }

  const existing = db.prepare('SELECT session_id FROM call_logs WHERE id = ?').get(log.id) as
    | { session_id: string | null }
    | undefined;
  if (existing && existing.session_id !== sessionId) {
    return res.status(409).json({
      error: 'Call log ID belongs to a different session.',
      code: 'LOG_ID_CONFLICT',
    });
  }

  const now = Date.now();
  const expiresAt = now + consent.retention_days * 24 * 60 * 60 * 1000;

  db.prepare(
    `INSERT INTO call_logs (id, tenant_id, session_id, expires_at, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tenant_id = excluded.tenant_id,
       expires_at = excluded.expires_at,
       data = excluded.data
     WHERE call_logs.session_id = excluded.session_id`
  ).run(log.id, log.tenantId, sessionId, expiresAt, JSON.stringify(log), now);

  return res.status(201).json({
    success: true,
    persisted: true,
    expiresAt,
  });
});

app.delete('/api/session/data', requireAuthenticated, (req: AuthenticatedRequest, res) => {
  const sessionId = req.authUser!.sessionId;
  const deletedLogs = Number(db.prepare('DELETE FROM call_logs WHERE session_id = ?').run(sessionId).changes || 0);
  const deletedHandoffs = Number(db.prepare('DELETE FROM handoff_tickets WHERE session_id = ?').run(sessionId).changes || 0);
  const deletedSupportTickets = Number(db.prepare('DELETE FROM support_tickets WHERE session_id = ?').run(sessionId).changes || 0);
  const deletedAppointments = Number(db.prepare('DELETE FROM appointments WHERE session_id = ?').run(sessionId).changes || 0);
  const deletedIntegrations = Number(db.prepare('DELETE FROM integration_deliveries WHERE session_id = ?').run(sessionId).changes || 0);
  db.prepare('DELETE FROM consent_records WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM pending_actions WHERE session_id = ?').run(sessionId);

  writeAuditLog({
    req,
    action: 'session.data_deleted',
    targetId: sessionId,
    metadata: { deletedLogs, deletedHandoffs, deletedSupportTickets, deletedAppointments, deletedIntegrations },
  });

  return res.json({
    success: true,
    deleted: {
      callLogs: deletedLogs,
      handoffTickets: deletedHandoffs,
      supportTickets: deletedSupportTickets,
      appointments: deletedAppointments,
      integrations: deletedIntegrations,
    },
    message:
      'All transcripts, safety handoff tickets, support tickets, appointments, outbound webhook deliveries, consent records, and pending confirmations for your active session have been permanently deleted.',
  });
});

app.delete('/api/logs/all', requireAdmin, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  if (user.role === 'super_admin' || user.allowedTenants.includes('*')) {
    db.exec('DELETE FROM call_logs');
  } else {
    const stmt = db.prepare('DELETE FROM call_logs WHERE tenant_id = ?');
    for (const tid of user.allowedTenants) {
      stmt.run(tid);
    }
  }
  writeAuditLog({ req, action: 'logs.deleted' });
  return res.json({ success: true, message: 'Authorized tenant call logs deleted.' });
});

app.post('/api/user/wipe-all', requireSuperAdmin, (req: AuthenticatedRequest, res) => {
  try {
    db.exec('DELETE FROM call_logs');
    db.exec('DELETE FROM consent_records');
    db.exec('DELETE FROM support_tickets');
    db.exec('DELETE FROM handoff_tickets');
    db.exec('DELETE FROM appointments');
    db.exec('DELETE FROM integration_deliveries');
    db.exec('DELETE FROM pending_actions');
    db.exec('DELETE FROM audit_logs');
    db.exec('DELETE FROM tenants');

    const insertTenant = db.prepare('INSERT INTO tenants (id, data, updated_at) VALUES (?, ?, ?)');
    for (const t of INITIAL_TENANTS) {
      insertTenant.run(t.id, JSON.stringify(t), Date.now());
    }

    writeAuditLog({ req, action: 'workspace.wiped' });

    return res.json({
      success: true,
      message:
        'All workspace transcripts, consent logs, handoff queues, appointments, integration deliveries, support tickets, and custom tenants have been permanently wiped.',
      wipedAt: Date.now(),
    });
  } catch (err) {
    logStructuredEvent('error', 'workspace.wipe_failed', { traceId: req.traceId, error: String(err) });
    return res.status(500).json({ error: 'Failed to complete workspace data wipe.' });
  }
});

// -------------------------------------------------------------
// 8. Staff Handoff Queue Endpoints (Tenant-Scoped Admin)
// -------------------------------------------------------------
app.get('/api/handoffs', requireAdmin, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const tenantFilter = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : undefined;
  const rawLimit = Number(req.query.limit ?? 200);
  const rawOffset = Number(req.query.offset ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.trunc(rawLimit))) : 200;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;

  if (tenantFilter && !canAccessTenant(user, tenantFilter)) {
    return res.status(403).json({ error: 'Forbidden: cannot read handoffs for requested tenant.' });
  }

  let rows: any[];
  if (tenantFilter) {
    rows = db
      .prepare('SELECT * FROM handoff_tickets WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(tenantFilter, limit, offset) as any[];
  } else if (user.role === 'super_admin' || user.allowedTenants.includes('*')) {
    rows = db
      .prepare('SELECT * FROM handoff_tickets ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as any[];
  } else if (user.allowedTenants.length > 0) {
    const placeholders = user.allowedTenants.map(() => '?').join(', ');
    rows = db
      .prepare(`SELECT * FROM handoff_tickets WHERE tenant_id IN (${placeholders}) ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...user.allowedTenants, limit, offset) as any[];
  } else {
    rows = [];
  }

  return res.json(
    rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      sessionId: r.session_id,
      reason: r.reason,
      priority: r.priority,
      summary: r.summary,
      department: r.department,
      phone: r.phone,
      status: r.status,
      notes: r.notes || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  );
});

app.patch('/api/handoffs/:id', requireAdmin, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const parsed = HandoffUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid handoff update payload.' });
  }

  const row = db.prepare('SELECT * FROM handoff_tickets WHERE id = ?').get(id) as any | undefined;
  if (!row) {
    return res.status(404).json({ error: 'Handoff ticket not found.' });
  }
  if (!canAccessTenant(req.authUser, row.tenant_id)) {
    return res.status(403).json({ error: 'Forbidden: cannot modify another tenant handoff ticket.' });
  }

  const now = Date.now();
  db.prepare('UPDATE handoff_tickets SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(
    parsed.data.status,
    parsed.data.notes ?? row.notes,
    now,
    id
  );

  writeAuditLog({
    req,
    action: 'handoff.updated',
    tenantId: row.tenant_id,
    targetId: id,
    metadata: { status: parsed.data.status },
  });

  return res.json({
    success: true,
    ticket: {
      id: row.id,
      tenantId: row.tenant_id,
      status: parsed.data.status,
      notes: parsed.data.notes ?? row.notes ?? undefined,
      updatedAt: now,
    },
  });
});

// -------------------------------------------------------------
// 8b. Appointments Ledger & Audit Logs (Tenant-Scoped Admin)
// -------------------------------------------------------------
app.get('/api/appointments', requireAdmin, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const tenantFilter = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : undefined;
  const rawLimit = Number(req.query.limit ?? 200);
  const rawOffset = Number(req.query.offset ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.trunc(rawLimit))) : 200;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;

  if (tenantFilter && !canAccessTenant(user, tenantFilter)) {
    return res.status(403).json({ error: 'Forbidden: cannot read appointments for requested tenant.' });
  }

  let rows: any[];
  if (tenantFilter) {
    rows = db
      .prepare('SELECT * FROM appointments WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(tenantFilter, limit, offset) as any[];
  } else if (user.role === 'super_admin' || user.allowedTenants.includes('*')) {
    rows = db
      .prepare('SELECT * FROM appointments ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as any[];
  } else if (user.allowedTenants.length > 0) {
    const placeholders = user.allowedTenants.map(() => '?').join(', ');
    rows = db
      .prepare(`SELECT * FROM appointments WHERE tenant_id IN (${placeholders}) ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...user.allowedTenants, limit, offset) as any[];
  } else {
    rows = [];
  }

  return res.json(
    rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      sessionId: r.session_id,
      doctor: r.doctor,
      slot: r.slot,
      patientName: r.patient_name,
      status: r.status,
      actionId: r.action_id,
      createdAt: r.created_at,
      expiresAt: r.expires_at ?? null,
    }))
  );
});

app.patch(
  '/api/appointments/:id',
  requireAdmin,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const { id } = req.params;
    const parsed = AppointmentUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid appointment update payload.' });
    }

    const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as any | undefined;
    if (!row) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }
    if (!canAccessTenant(req.authUser, row.tenant_id)) {
      return res.status(403).json({ error: 'Forbidden: cannot modify another tenant appointment.' });
    }

    db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(parsed.data.status, id);
    writeAuditLog({
      req,
      action: 'appointment.updated',
      tenantId: row.tenant_id,
      targetId: id,
      metadata: { status: parsed.data.status },
    });

    const tenant = getTenantByIdStrict(row.tenant_id);
    let delivery: IntegrationDelivery | null = null;
    if (tenant && tenant.webhookConfig?.enabled && tenant.webhookConfig?.url && (!row.is_demo || ALLOW_DEMO_WEBHOOKS)) {
      delivery = await enqueueAndDispatchWebhook({
        tenant,
        sessionId: row.session_id,
        eventType: parsed.data.status === 'cancelled' ? 'appointment.cancelled' : 'appointment.updated',
        idempotencyKey: `apt_${row.id}_${parsed.data.status}_${Date.now()}`,
        payload: {
          appointmentId: row.id,
          doctor: row.doctor,
          slot: row.slot,
          patientName: row.patient_name,
          status: parsed.data.status,
        },
      });
    }

    return res.json({
      success: true,
      appointment: {
        id: row.id,
        tenantId: row.tenant_id,
        doctor: row.doctor,
        slot: row.slot,
        patientName: row.patient_name,
        status: parsed.data.status,
      },
      integrationDelivery: delivery,
    });
  })
);

app.get('/api/appointments/:id/calendar.ics', requireAuthenticated, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as any | undefined;
  if (!row) {
    return res.status(404).json({ error: 'Appointment not found.' });
  }
  const user = req.authUser!;
  const isOwnerSession = row.session_id === user.sessionId;
  if (!isOwnerSession && !canAccessTenant(user, row.tenant_id)) {
    return res.status(403).json({ error: 'Forbidden: cannot export calendar invite for another session.' });
  }
  const tenant = getTenantByIdStrict(row.tenant_id);
  if (!tenant) {
    return res.status(404).json({ error: 'Tenant not found.' });
  }

  const icsContent = buildCalendarIcs(
    {
      id: row.id,
      tenantId: row.tenant_id,
      sessionId: row.session_id,
      doctor: row.doctor,
      slot: row.slot,
      patientName: row.patient_name,
      status: row.status,
      actionId: row.action_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? null,
    },
    tenant
  );

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="appointment-${row.id}.ics"`);
  return res.send(icsContent);
});

app.get('/api/integrations', requireAdmin, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const tenantFilter = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : undefined;
  const rawLimit = Number(req.query.limit ?? 100);
  const rawOffset = Number(req.query.offset ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.trunc(rawLimit))) : 100;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;

  if (tenantFilter && !canAccessTenant(user, tenantFilter)) {
    return res.status(403).json({ error: 'Forbidden: cannot read integrations for requested tenant.' });
  }

  let rows: any[];
  if (tenantFilter) {
    rows = db
      .prepare('SELECT * FROM integration_deliveries WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(tenantFilter, limit, offset) as any[];
  } else if (user.role === 'super_admin' || user.allowedTenants.includes('*')) {
    rows = db
      .prepare('SELECT * FROM integration_deliveries ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as any[];
  } else if (user.allowedTenants.length > 0) {
    const placeholders = user.allowedTenants.map(() => '?').join(', ');
    rows = db
      .prepare(`SELECT * FROM integration_deliveries WHERE tenant_id IN (${placeholders}) ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...user.allowedTenants, limit, offset) as any[];
  } else {
    rows = [];
  }

  const filtered: IntegrationDelivery[] = rows.map(r => ({
    id: r.id,
    tenantId: r.tenant_id,
    sessionId: r.session_id || null,
    eventType: r.event_type,
    targetUrl: r.target_url,
    status: r.status,
    attemptCount: r.attempt_count,
    lastStatusCode: r.last_status_code ?? null,
    lastError: r.last_error ?? null,
    latencyMs: r.latency_ms ?? null,
    idempotencyKey: r.idempotency_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return res.json(filtered);
});

app.post(
  '/api/integrations/:id/retry',
  requireAdmin,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const { id } = req.params;
    const row = db.prepare('SELECT * FROM integration_deliveries WHERE id = ?').get(id) as any | undefined;
    if (!row) {
      return res.status(404).json({ error: 'Integration delivery record not found.' });
    }
    if (!canAccessTenant(req.authUser, row.tenant_id)) {
      return res.status(403).json({ error: 'Forbidden: cannot retry integration for another tenant.' });
    }
    const tenant = getTenantByIdStrict(row.tenant_id);
    if (!tenant || !tenant.webhookConfig?.enabled || !tenant.webhookConfig?.url) {
      return res.status(400).json({ error: 'Outbound webhook is not configured or enabled for this tenant.' });
    }

    const secret = tenant.webhookConfig.signingSecret?.trim() || WEBHOOK_SIGNING_SECRET;
    if (!secret) {
      return res.status(400).json({ error: 'Webhook signing secret is not configured (set tenant secret or WEBHOOK_SIGNING_SECRET).' });
    }
    const outcome = await dispatchWebhookWithRetry({
      targetUrl: tenant.webhookConfig.url,
      signingSecret: secret,
      secretHeaderName: tenant.webhookConfig.secretHeaderName,
      payloadJson: row.payload_json,
      idempotencyKey: row.idempotency_key,
      allowLocal: ALLOW_LOCAL_WEBHOOKS,
      maxAttempts: 2,
      backoffMs: [0, 150],
      timeoutMs: 2500,
    });

    const nextAttempts = Number(row.attempt_count || 0) + outcome.attemptCount;
    const now = Date.now();
    db.prepare(
      'UPDATE integration_deliveries SET target_url = ?, status = ?, attempt_count = ?, last_status_code = ?, last_error = ?, latency_ms = ?, updated_at = ? WHERE id = ?'
    ).run(
      tenant.webhookConfig.url,
      outcome.status,
      nextAttempts,
      outcome.lastStatusCode,
      outcome.lastError,
      outcome.latencyMs,
      now,
      id
    );

    writeAuditLog({
      req,
      action: 'integration.retried',
      tenantId: row.tenant_id,
      targetId: id,
      metadata: { status: outcome.status, statusCode: outcome.lastStatusCode },
    });

    return res.json({
      success: outcome.status === 'delivered',
      delivery: {
        id: row.id,
        tenantId: row.tenant_id,
        sessionId: row.session_id || null,
        eventType: row.event_type,
        targetUrl: tenant.webhookConfig.url,
        status: outcome.status,
        attemptCount: nextAttempts,
        lastStatusCode: outcome.lastStatusCode,
        lastError: outcome.lastError,
        latencyMs: outcome.latencyMs,
        idempotencyKey: row.idempotency_key,
        createdAt: row.created_at,
        updatedAt: now,
      },
    });
  })
);

app.get('/api/metrics/operational', requireAdmin, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const tenantFilter = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : undefined;
  if (tenantFilter && !canAccessTenant(user, tenantFilter)) {
    return res.status(403).json({ error: 'Forbidden: cannot inspect operational metrics for requested tenant.' });
  }

  const isGlobalScope = user.role === 'super_admin' || user.allowedTenants.includes('*');
  const allowed = user.allowedTenants;

  const queryScoped = <T>(table: string, selectCols: string, orderCol = 'created_at DESC LIMIT 1000'): T[] => {
    if (tenantFilter) {
      return db.prepare(`SELECT ${selectCols} FROM ${table} WHERE tenant_id = ? ORDER BY ${orderCol}`).all(tenantFilter) as T[];
    }
    if (isGlobalScope) {
      return db.prepare(`SELECT ${selectCols} FROM ${table} ORDER BY ${orderCol}`).all() as T[];
    }
    if (!allowed || allowed.length === 0) return [];
    const placeholders = allowed.map(() => '?').join(', ');
    return db
      .prepare(`SELECT ${selectCols} FROM ${table} WHERE tenant_id IN (${placeholders}) ORDER BY ${orderCol}`)
      .all(...allowed) as T[];
  };

  const logRows = queryScoped<{ tenant_id: string; data: string }>('call_logs', 'tenant_id, data')
    .map(r => safeJsonParse<CallLog | null>(r.data, null))
    .filter((l): l is CallLog => Boolean(l));
  const handoffRows = queryScoped<any>('handoff_tickets', '*')
    .map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      sessionId: r.session_id,
      reason: r.reason,
      priority: r.priority,
      summary: r.summary,
      department: r.department,
      phone: r.phone,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })) as HandoffTicket[];
  const aptRows = queryScoped<any>('appointments', '*')
    .map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      sessionId: r.session_id,
      doctor: r.doctor,
      slot: r.slot,
      patientName: r.patient_name,
      status: r.status,
      actionId: r.action_id,
      createdAt: r.created_at,
      expiresAt: r.expires_at ?? null,
    }));
  const intRows = queryScoped<any>('integration_deliveries', '*')
    .map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      sessionId: r.session_id,
      eventType: r.event_type,
      targetUrl: r.target_url,
      status: r.status,
      attemptCount: r.attempt_count,
      lastStatusCode: r.last_status_code ?? null,
      lastError: r.last_error ?? null,
      latencyMs: r.latency_ms ?? null,
      idempotencyKey: r.idempotency_key,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })) as IntegrationDelivery[];

  return res.json(
    computeOperationalMetrics({
      logs: logRows,
      handoffs: handoffRows,
      appointments: aptRows,
      integrations: intRows,
    })
  );
});

app.get('/api/audit-logs', requireAdmin, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const tenantFilter = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : undefined;
  const rawLimit = Number(req.query.limit ?? 100);
  const rawOffset = Number(req.query.offset ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.trunc(rawLimit))) : 100;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;

  if (tenantFilter && !canAccessTenant(user, tenantFilter)) {
    return res.status(403).json({ error: 'Forbidden: cannot inspect audit logs for requested tenant.' });
  }

  let rows: any[];
  if (tenantFilter) {
    rows = db
      .prepare('SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(tenantFilter, limit, offset) as any[];
  } else if (user.role === 'super_admin' || user.allowedTenants.includes('*')) {
    rows = db
      .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as any[];
  } else if (user.allowedTenants.length > 0) {
    const placeholders = user.allowedTenants.map(() => '?').join(', ');
    rows = db
      .prepare(`SELECT * FROM audit_logs WHERE tenant_id IN (${placeholders}) ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...user.allowedTenants, limit, offset) as any[];
  } else {
    rows = [];
  }

  return res.json(
    rows.map(r => ({
      id: r.id,
      traceId: r.trace_id,
      actorId: r.actor_id,
      actorRole: r.actor_role,
      action: r.action,
      tenantId: r.tenant_id,
      targetId: r.target_id,
      metadata: safeJsonParse<Record<string, unknown>>(r.metadata, {}),
      createdAt: r.created_at,
    }))
  );
});

// -------------------------------------------------------------
// 9. Health & Support Endpoints
// -------------------------------------------------------------
// Minimal public liveness/readiness check (no infrastructure metadata or DB counts leaked publicly)
app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({
      status: 'operational',
      timestamp: Date.now(),
    });
  } catch {
    res.status(500).json({ status: 'degraded', timestamp: Date.now() });
  }
});

// Authenticated admin diagnostics endpoint
app.get('/api/diagnostics', requireAdmin, (req: AuthenticatedRequest, res) => {
  try {
    const tenantsCount = (db.prepare('SELECT COUNT(*) as cnt FROM tenants').get() as { cnt: number }).cnt;
    const logsCount = (db.prepare('SELECT COUNT(*) as cnt FROM call_logs').get() as { cnt: number }).cnt;
    const ticketsCount = (db.prepare('SELECT COUNT(*) as cnt FROM support_tickets').get() as { cnt: number }).cnt;
    const handoffsOpenCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM handoff_tickets WHERE status != 'resolved'").get() as { cnt: number }
    ).cnt;
    const appointmentsCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM appointments WHERE status = 'confirmed'").get() as { cnt: number }
    ).cnt;

    res.json({
      status: 'operational',
      timestamp: Date.now(),
      uptimeSeconds: Math.round(process.uptime()),
      database: {
        type: 'sqlite',
        status: 'connected',
        tenantsCount,
        logsCount,
        ticketsCount,
        handoffsOpenCount,
        appointmentsCount,
      },
      geminiAi: {
        configured: Boolean(aiClient),
        model: GEMINI_CHAT_MODEL,
        offlineDemoAvailable: true,
      },
      systemMetrics: {
        memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        nodeVersion: process.version,
      },
    });
  } catch (err) {
    logStructuredEvent('error', 'diagnostics.query_failed', { traceId: req.traceId, error: String(err) });
    res.status(500).json({ status: 'degraded', error: 'Diagnostics check failed.' });
  }
});

app.post(
  '/api/support/ticket',
  supportLimiter,
  asyncHandler<AuthenticatedRequest>(async (req, res) => {
    const parsed = SupportTicketSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid support ticket payload.' });
    }

    const user = await resolveAuthUser(req);
    const { name, email, subject, message, tenantId } = parsed.data;
    const ticketId = generateUniqueTicketId('VANI', 'support_tickets');
    const now = Date.now();
    const expiresAt = now + RETENTION_POLICY_DAYS.supportTicketDays * 24 * 60 * 60 * 1000;

    db.prepare(
      'INSERT INTO support_tickets (id, tenant_id, session_id, name, email, subject, message, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      ticketId,
      tenantId || null,
      user?.sessionId || null,
      name,
      email,
      subject || 'General Inquiry',
      message,
      'open',
      now,
      expiresAt
    );

    writeAuditLog({
      req,
      actorId: user?.sessionId || 'guest',
      actorRole: user?.role || 'public',
      action: 'support_ticket.created',
      tenantId: tenantId || null,
      targetId: ticketId,
    });

    return res.status(201).json({
      success: true,
      ticketId,
      expiresAt,
      message: `Ticket ${ticketId} created successfully. Stored in server support queue for ${email} (auto-expires after ${RETENTION_POLICY_DAYS.supportTicketDays} days).`,
    });
  })
);

app.get('/api/support/tickets', requireAdmin, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const tenantFilter = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : undefined;
  const rawLimit = Number(req.query.limit ?? 100);
  const rawOffset = Number(req.query.offset ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.trunc(rawLimit))) : 100;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0;

  if (tenantFilter && !canAccessTenant(user, tenantFilter)) {
    return res.status(403).json({ error: 'Forbidden: cannot read support tickets for requested tenant.' });
  }

  let rows: any[];
  if (tenantFilter) {
    rows = db
      .prepare('SELECT * FROM support_tickets WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(tenantFilter, limit, offset) as any[];
  } else if (user.role === 'super_admin' || user.allowedTenants.includes('*')) {
    rows = db
      .prepare('SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as any[];
  } else if (user.allowedTenants.length > 0) {
    const placeholders = user.allowedTenants.map(() => '?').join(', ');
    rows = db
      .prepare(`SELECT * FROM support_tickets WHERE tenant_id IN (${placeholders}) ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...user.allowedTenants, limit, offset) as any[];
  } else {
    rows = [];
  }

  const tickets: SupportTicketRecord[] = rows.map(r => ({
    id: r.id,
    tenantId: r.tenant_id || null,
    sessionId: r.session_id || null,
    name: r.name,
    email: r.email,
    subject: r.subject,
    message: r.message,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at ?? null,
  }));

  return res.json(tickets);
});

app.patch('/api/support/tickets/:id', requireAdmin, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const parsed = SupportTicketUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid support ticket update payload.' });
  }

  const row = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id) as any | undefined;
  if (!row) {
    return res.status(404).json({ error: 'Support ticket not found.' });
  }

  const user = req.authUser!;
  if (row.tenant_id) {
    if (!canAccessTenant(user, row.tenant_id)) {
      return res.status(403).json({ error: 'Forbidden: cannot modify another tenant support ticket.' });
    }
  } else if (user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden: global support tickets require super-admin access.' });
  }

  db.prepare('UPDATE support_tickets SET status = ? WHERE id = ?').run(parsed.data.status, id);
  writeAuditLog({
    req,
    action: 'support_ticket.updated',
    tenantId: row.tenant_id || null,
    targetId: id,
    metadata: { status: parsed.data.status },
  });

  return res.json({
    success: true,
    ticket: {
      id: row.id,
      tenantId: row.tenant_id || null,
      status: parsed.data.status,
    },
  });
});

// -------------------------------------------------------------
// 10. POST /api/turn - Authenticated, Tenant-Isolated Turn Pipeline
// -------------------------------------------------------------
app.post(
  '/api/turn',
  requireAuthenticated,
  turnLimiter,
  asyncHandler<AuthenticatedRequest>(async (req, res: Response) => {
    const startTurn = performance.now();
    const parsed = TurnRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid turn payload.' });
    }

    const { tenantId, userText, language, memory, history, idempotencyKey, demoMode } = parsed.data;
    const sessionId = req.authUser!.sessionId;

    if (demoMode && !isDev && Boolean(aiClient) && !ALLOW_DEMO_MODE) {
      return res.status(403).json({
        error: 'Offline demo mode is disabled in live production unless ALLOW_DEMO_MODE=true is enabled.',
        code: 'DEMO_MODE_DISABLED',
        retryable: false,
      });
    }

    // Strict tenant resolution (no silent fallback to tenant 0)
    const tenant = getTenantByIdStrict(tenantId);
    if (!tenant) {
      return res.status(404).json({
        error: `Unknown tenantId "${tenantId}". Select a valid tenant before sending turns.`,
        code: 'TENANT_NOT_FOUND',
        retryable: false,
      });
    }

    const turnRequestHash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          tenantId,
          userText,
          language,
          demoMode: Boolean(demoMode),
          memory: memory || {},
          history: history || [],
        })
      )
      .digest('hex')
      .slice(0, 32);

    // Idempotency short-circuit for repeated identical submissions (reject conflicting payload reuse)
    if (idempotencyKey) {
      const cachedAction = db
        .prepare(
          "SELECT params_hash, result_json FROM pending_actions WHERE session_id = ? AND tenant_id = ? AND tool_name = '__turn__' AND idempotency_key = ? AND status = 'completed'"
        )
        .get(sessionId, tenant.id, idempotencyKey) as { params_hash: string; result_json: string } | undefined;
      if (cachedAction) {
        if (cachedAction.params_hash && cachedAction.params_hash !== turnRequestHash) {
          return res.status(409).json({
            error: 'Idempotency-Key reuse detected with a different request payload.',
            code: 'IDEMPOTENCY_CONFLICT',
            retryable: false,
          });
        }
        const parsedCached = safeJsonParse<Record<string, unknown> | null>(cachedAction.result_json, null);
        if (parsedCached) {
          return res.json(parsedCached);
        }
      }
    }

    // 1. Language Detection & mid-call switch
    const langAnalysis = detectLanguage(userText, language);
    const activeLang = langAnalysis.detected;

    // Derive confirmation signal strictly from caller's current utterance
    const userConfirmedTurn = evaluateUserConfirmation(userText);

    // 2. Safety Check: Emergency Medical / Self-Harm Indicators (with 1 prior turn context) -> Durable Handoff Queue Ticket
    const priorUserTexts = (Array.isArray(history) ? history : [])
      .filter((t: any) => t && t.speaker === 'user' && typeof t.text === 'string')
      .map((t: any) => t.text.trim())
      .filter(Boolean);
    const safetyContextTexts = [...priorUserTexts.slice(-1), userText];
    const emergencyPreview = checkEmergencyWithContext(safetyContextTexts, activeLang, tenant);

    if (emergencyPreview) {
      let ticket: HandoffTicket | undefined;
      try {
        ticket = createHandoffTicket({
          tenant,
          sessionId,
          reason: `${emergencyPreview.isSelfHarmRisk ? 'Crisis / self-harm indicator' : 'Emergency indicator'}: ${emergencyPreview.symptomDetected || 'Critical symptom'}`,
          priority: 'critical',
          summary: userText,
          isDemo: Boolean(demoMode),
        });
        writeAuditLog({
          req,
          actorId: sessionId,
          actorRole: req.authUser?.role || 'caller',
          action: 'handoff.created',
          tenantId: tenant.id,
          targetId: ticket.id,
          metadata: { priority: 'critical', isSelfHarmRisk: Boolean(emergencyPreview.isSelfHarmRisk), demoMode: Boolean(demoMode) },
        });
        if ((!demoMode || ALLOW_DEMO_WEBHOOKS) && tenant.webhookConfig?.enabled && tenant.webhookConfig?.url) {
          queueWebhookDeliveryAsync({
            tenant,
            sessionId,
            eventType: 'handoff.created',
            idempotencyKey: `hnd_${ticket.id}`,
            payload: {
              ticketId: ticket.id,
              priority: ticket.priority,
              reason: ticket.reason,
              department: ticket.department,
              demoMode: Boolean(demoMode),
            },
          });
        }
      } catch (handoffErr) {
        logStructuredEvent('error', 'safety.handoff_persist_failed', {
          traceId: req.traceId,
          tenantId: tenant.id,
          error: String(handoffErr),
        });
      }

      const emergencyWithTicket = checkEmergencyWithContext(safetyContextTexts, activeLang, tenant, ticket?.id)!;
      const elapsed = Math.max(1, Math.round(performance.now() - startTurn));

      return res.json({
        reply: emergencyWithTicket.emergencyMessage,
        language: activeLang,
        switchedLanguage: langAnalysis.switched,
        toolCalls: [],
        shouldHandoff: true,
        handoffReason: emergencyWithTicket.actionRequired,
        ...(ticket ? { handoffTicket: ticket } : {}),
        isEmergency: true,
        intent: 'emergency_medical',
        memoryUpdates: {
          ...memory,
          emergencyReported: emergencyWithTicket.symptomDetected || 'Critical symptom detected',
          ...(ticket ? { handoffTicketId: ticket.id, escalationStatus: `Queued (${ticket.id})` } : {}),
        },
        latencyBreakdown: {
          ragMs: 0,
          modelResponseMs: elapsed,
          totalTurnaroundMs: elapsed,
          mode: 'safety_fastpath',
          streaming: false,
        },
      });
    }

    // 3. Safety Check: Whole-word Frustration & Human Escalation -> Durable Handoff Ticket
    if (checkHumanEscalationRequest(userText)) {
      let ticket: HandoffTicket | undefined;
      try {
        ticket = createHandoffTicket({
          tenant,
          sessionId,
          reason: 'Caller requested human staff specialist',
          priority: 'high',
          summary: userText,
          isDemo: Boolean(demoMode),
        });
        writeAuditLog({
          req,
          actorId: sessionId,
          actorRole: req.authUser?.role || 'caller',
          action: 'handoff.created',
          tenantId: tenant.id,
          targetId: ticket.id,
          metadata: { priority: 'high', demoMode: Boolean(demoMode) },
        });
        if ((!demoMode || ALLOW_DEMO_WEBHOOKS) && tenant.webhookConfig?.enabled && tenant.webhookConfig?.url) {
          queueWebhookDeliveryAsync({
            tenant,
            sessionId,
            eventType: 'handoff.created',
            idempotencyKey: `hnd_${ticket.id}`,
            payload: {
              ticketId: ticket.id,
              priority: ticket.priority,
              reason: ticket.reason,
              department: ticket.department,
              demoMode: Boolean(demoMode),
            },
          });
        }
      } catch (handoffErr) {
        logStructuredEvent('error', 'escalation.handoff_persist_failed', {
          traceId: req.traceId,
          tenantId: tenant.id,
          error: String(handoffErr),
        });
      }

      const elapsed = Math.max(1, Math.round(performance.now() - startTurn));
      return res.json({
        reply: buildHumanEscalationReply(activeLang, tenant, ticket?.id),
        language: activeLang,
        switchedLanguage: langAnalysis.switched,
        toolCalls: [],
        shouldHandoff: true,
        handoffReason: ticket
          ? `Callback ticket ${ticket.id} queued for ${tenant.humanHandoffContact.department}`
          : `Escalation routed to ${tenant.humanHandoffContact.department}`,
        ...(ticket ? { handoffTicket: ticket } : {}),
        intent: 'human_escalation',
        memoryUpdates: {
          ...memory,
          ...(ticket ? { handoffTicketId: ticket.id, escalationStatus: `Queued (${ticket.id})` } : {}),
        },
        latencyBreakdown: {
          ragMs: 0,
          modelResponseMs: elapsed,
          totalTurnaroundMs: elapsed,
          mode: 'safety_fastpath',
          streaming: false,
        },
      });
    }

    // 4. Knowledge Retrieval & Entity Extraction
    const tRag0 = performance.now();
    const ragResults = searchKnowledgeBase(userText, tenant.knowledgeBase, 4, 0.15);
    const ragMs = Math.max(1, Math.round(performance.now() - tRag0));
    let workingMemory: Record<string, string> = extractEntitiesFromInput(userText, memory || {});

    // 5. Explicit Offline Demo Mode or missing GEMINI_API_KEY fallback
    if (demoMode) {
      const demoOut = processTurn({
        userInput: userText,
        tenant,
        currentLanguage: language,
        callMemory: workingMemory,
        turnHistory: history as any[],
      });

      let reply = demoOut.spokenReply;
      let finalMemory = demoOut.updatedMemory;
      const demoToolCalls: { name: string; result: any }[] = [];

      if (demoOut.toolInvokedName) {
        const callArgs: Record<string, any> = {
          ...(demoOut.toolParams || {}),
          ...(workingMemory.pendingActionId ? { actionId: workingMemory.pendingActionId } : {}),
        };
        const durableResult = executeServerToolWithDurability({
          calledName: demoOut.toolInvokedName,
          callArgs,
          tenant,
          sessionId,
          activeLang: demoOut.detectedLanguage,
          userConfirmed: userConfirmedTurn,
          isDemo: true,
          idempotencyKey,
          req,
        });
        if (
          ALLOW_DEMO_WEBHOOKS &&
          demoOut.toolInvokedName === 'book_appointment' &&
          durableResult.success &&
          durableResult.data?.bookingRef &&
          tenant.webhookConfig?.enabled &&
          tenant.webhookConfig?.url
        ) {
          queueWebhookDeliveryAsync({
            tenant,
            sessionId,
            eventType: 'appointment.booked',
            idempotencyKey: `apt_${durableResult.data.bookingRef}`,
            payload: {
              bookingRef: durableResult.data.bookingRef,
              doctor: durableResult.data.doctor,
              slot: durableResult.data.slot,
              patientName: durableResult.data.patientName,
              actionId: durableResult.data.actionId,
              demoMode: true,
            },
          });
        }
        reply = durableResult.outputMessage;
        demoToolCalls.push({ name: demoOut.toolInvokedName, result: durableResult });
        finalMemory = extractMemoryUpdatesFromToolCall(
          demoOut.toolInvokedName,
          callArgs,
          durableResult,
          finalMemory
        );
      }

      const demoResponseBody = {
        reply,
        language: demoOut.detectedLanguage,
        switchedLanguage: demoOut.switchedLanguage,
        toolCalls: demoToolCalls,
        shouldHandoff: demoOut.shouldHandoff,
        handoffReason: demoOut.handoffReason,
        intent: demoOut.detectedIntent,
        model: 'offline-deterministic-demo',
        memoryUpdates: finalMemory,
        latencyBreakdown: demoOut.latencyBreakdown,
      };

      if (idempotencyKey) {
        const now = Date.now();
        const expiresAt = now + RETENTION_POLICY_DAYS.pendingActionHours * 60 * 60 * 1000;
        db.prepare(
          'INSERT OR REPLACE INTO pending_actions (id, session_id, tenant_id, tool_name, params_hash, idempotency_key, status, result_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          `idem_${crypto.randomUUID().slice(0, 12)}`,
          sessionId,
          tenant.id,
          '__turn__',
          turnRequestHash,
          idempotencyKey,
          'completed',
          JSON.stringify(demoResponseBody),
          now,
          expiresAt
        );
      }

      return res.json(demoResponseBody);
    }

    if (!aiClient) {
      return res.status(503).json({
        error: 'Gemini AI is not configured on the server (GEMINI_API_KEY missing). Enable Offline Demo Mode in the Voice Console or configure GEMINI_API_KEY.',
        code: 'GEMINI_NOT_CONFIGURED',
        retryable: false,
        offlineDemoAvailable: true,
      });
    }

    // 6. Server-Side Gemini Generation with Per-Tenant Tool Allowlist & Durable Confirmation State
    const allowedToolNames = new Set(tenant.tools.map(t => t.name));
    const toolDeclarations = buildGeminiToolDeclarations(tenant.tools);
    const systemInstruction = buildTenantSystemInstruction({
      tenant,
      activeLang,
      ragResults,
      memory: workingMemory,
    });

    let activeModelUsed = GEMINI_CHAT_MODEL;

    const invokeModelWithTimeout = async (
      modelName: string,
      contents: Content[],
      useLowThinking: boolean,
      timeoutMs: number
    ) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms on ${modelName}`)), timeoutMs);
      try {
        return await aiClient!.models.generateContent({
          model: modelName,
          contents,
          config: {
            systemInstruction,
            abortSignal: controller.signal,
            ...(useLowThinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
            tools: toolDeclarations.length > 0 ? [{ functionDeclarations: toolDeclarations }] : undefined,
          },
        });
      } finally {
        clearTimeout(timer);
      }
    };

    const callGeminiWithRetry = async (contents: Content[]) => {
      const canUsePrimary = Date.now() >= primaryModelCooldownUntil;

      if (canUsePrimary) {
        try {
          activeModelUsed = GEMINI_CHAT_MODEL;
          const result = await invokeModelWithTimeout(GEMINI_CHAT_MODEL, contents, true, 3500);
          primaryModelConsecutiveFailures = 0;
          primaryModelCooldownUntil = 0;
          return result;
        } catch (firstErr: any) {
          const msg = String(firstErr?.message || firstErr || '');
          const status = Number(firstErr?.status || 0);
          logStructuredEvent('warn', 'gemini.primary_error', {
            traceId: req.traceId,
            model: GEMINI_CHAT_MODEL,
            status,
            detail: msg.slice(0, 200),
          });

          if (status === 401 || status === 403 || /PERMISSION_DENIED|API_KEY_INVALID/i.test(msg)) {
            throw firstErr;
          }

          if (
            status === 404 ||
            status === 503 ||
            status === 429 ||
            /NOT_FOUND|UNAVAILABLE|RESOURCE_EXHAUSTED|Timeout|abort/i.test(msg)
          ) {
            primaryModelConsecutiveFailures += 1;
            if (primaryModelConsecutiveFailures >= 3) {
              primaryModelCooldownUntil = Date.now() + 45_000;
            }
          }
        }
      }

      activeModelUsed = GEMINI_FALLBACK_MODEL;
      try {
        return await invokeModelWithTimeout(GEMINI_FALLBACK_MODEL, contents, false, 6500);
      } catch (liteErr: any) {
        const msg = String(liteErr?.message || liteErr || '');
        const status = Number(liteErr?.status || 0);
        const isTimedOut = liteErr?.name === 'AbortError' || /Timeout|abort/i.test(msg);
        const isTransient =
          !isTimedOut &&
          (status === 503 ||
            status === 429 ||
            status >= 500 ||
            /UNAVAILABLE|RESOURCE_EXHAUSTED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg));
        if (!isTransient) throw liteErr;
        await new Promise(resolve => setTimeout(resolve, 350));
        return await invokeModelWithTimeout(GEMINI_FALLBACK_MODEL, contents, false, 6500);
      }
    };

    try {
      const tLlm0 = performance.now();
      let conversationContents: Content[] = buildGeminiConversationContents(
        history as any[],
        userText
      );

      let geminiResponse = await callGeminiWithRetry(conversationContents);
      const executedToolCalls: { name: string; result: any }[] = [];

      for (let round = 0; round < 2; round++) {
        const candidate = geminiResponse.candidates?.[0];
        const functionCalls = candidate?.content?.parts
          ?.filter(p => Boolean(p.functionCall))
          .map(p => p.functionCall!);

        if (!functionCalls || functionCalls.length === 0) {
          break;
        }

        const functionResponseParts: { functionResponse: { name: string; response: Record<string, any> } }[] = [];

        for (const fc of functionCalls) {
          const calledName = fc.name;
          if (!calledName) continue;

          // Per-Tenant Tool Allowlist Check
          if (!allowedToolNames.has(calledName)) {
            const deniedResult = {
              success: false,
              toolName: calledName,
              outputMessage: `Tool "${calledName}" is not permitted for ${tenant.name}.`,
              data: { blocked: true },
            };
            executedToolCalls.push({ name: calledName, result: deniedResult });
            functionResponseParts.push({
              functionResponse: { name: calledName, response: deniedResult },
            });
            continue;
          }

          const callArgs: Record<string, any> = {
            ...(fc.args || {}),
            ...(workingMemory.pendingActionId && !fc.args?.actionId ? { actionId: workingMemory.pendingActionId } : {}),
          };

          const toolResult = executeServerToolWithDurability({
            calledName,
            callArgs,
            tenant,
            sessionId,
            activeLang,
            userConfirmed: userConfirmedTurn,
            isDemo: false,
            idempotencyKey,
            req,
          });
          if (
            calledName === 'book_appointment' &&
            toolResult.success &&
            toolResult.data?.bookingRef &&
            tenant.webhookConfig?.enabled &&
            tenant.webhookConfig?.url
          ) {
            queueWebhookDeliveryAsync({
              tenant,
              sessionId,
              eventType: 'appointment.booked',
              idempotencyKey: `apt_${toolResult.data.bookingRef}`,
              payload: {
                bookingRef: toolResult.data.bookingRef,
                doctor: toolResult.data.doctor,
                slot: toolResult.data.slot,
                patientName: toolResult.data.patientName,
                actionId: toolResult.data.actionId,
              },
            });
          }
          workingMemory = extractMemoryUpdatesFromToolCall(calledName, callArgs, toolResult, workingMemory);
          executedToolCalls.push({ name: calledName, result: toolResult });
          functionResponseParts.push({
            functionResponse: { name: calledName, response: toolResult as unknown as Record<string, any> },
          });
        }

        if (candidate?.content && functionResponseParts.length > 0) {
          conversationContents = [
            ...conversationContents,
            candidate.content,
            { role: 'user', parts: functionResponseParts },
          ];
          geminiResponse = await callGeminiWithRetry(conversationContents);
        } else {
          break;
        }
      }

      const modelResponseMs = Math.max(1, Math.round(performance.now() - tLlm0));
      let finalReply = geminiResponse.text?.trim() || '';

      if (!finalReply && executedToolCalls.length > 0) {
        finalReply = executedToolCalls[executedToolCalls.length - 1]?.result?.outputMessage || '';
      }

      if (!finalReply) {
        return res.status(502).json({
          error: 'The AI model returned an empty response. Please try asking again.',
          code: 'EMPTY_MODEL_RESPONSE',
          retryable: true,
        });
      }

      const totalTurnaroundMs = Math.max(1, Math.round(performance.now() - startTurn));
      const primaryToolName = executedToolCalls[0]?.name;

      const responseBody = {
        reply: finalReply,
        language: activeLang,
        switchedLanguage: langAnalysis.switched,
        toolCalls: executedToolCalls,
        shouldHandoff: false,
        intent: primaryToolName || (ragResults.length > 0 ? 'kb_retrieval' : 'conversational_ai'),
        model: activeModelUsed,
        memoryUpdates: workingMemory,
        latencyBreakdown: {
          ragMs,
          modelResponseMs,
          totalTurnaroundMs,
          mode: 'gemini_live',
          streaming: false,
        },
      };

      if (idempotencyKey) {
        const now = Date.now();
        const expiresAt = now + RETENTION_POLICY_DAYS.pendingActionHours * 60 * 60 * 1000;
        db.prepare(
          'INSERT OR REPLACE INTO pending_actions (id, session_id, tenant_id, tool_name, params_hash, idempotency_key, status, result_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          `idem_${crypto.randomUUID().slice(0, 12)}`,
          sessionId,
          tenant.id,
          '__turn__',
          turnRequestHash,
          idempotencyKey,
          'completed',
          JSON.stringify(responseBody),
          now,
          expiresAt
        );
      }

      return res.json(responseBody);
    } catch (llmErr: any) {
      const errMsg = String(llmErr?.message || llmErr || 'Unknown Gemini API error');
      const errStatus = Number(llmErr?.status || 0);
      logStructuredEvent('error', 'gemini.turn_failed', {
        traceId: req.traceId,
        status: errStatus,
        detail: errMsg.slice(0, 320),
      });

      if (errStatus === 429 || /RESOURCE_EXHAUSTED|quota/i.test(errMsg)) {
        return res.status(429).json({
          error: 'AI quota or rate limit reached. Wait a moment and retry, or switch to Offline Demo Mode.',
          code: 'RESOURCE_EXHAUSTED',
          retryable: true,
          offlineDemoAvailable: true,
        });
      }
      if (errStatus === 401 || errStatus === 403 || /PERMISSION_DENIED|API_KEY_INVALID/i.test(errMsg)) {
        return res.status(403).json({
          error: 'Gemini API authentication failed. Verify GEMINI_API_KEY configuration or switch to Offline Demo Mode.',
          code: 'API_KEY_INVALID',
          retryable: false,
          offlineDemoAvailable: true,
        });
      }
      if (errStatus === 404 || /NOT_FOUND/i.test(errMsg)) {
        return res.status(502).json({
          error: 'Configured Gemini model was unavailable upstream.',
          code: 'MODEL_NOT_FOUND',
          retryable: false,
          offlineDemoAvailable: true,
        });
      }
      if (errStatus === 400 || /INVALID_ARGUMENT/i.test(errMsg)) {
        return res.status(400).json({
          error: 'The AI model rejected the request parameters.',
          code: 'INVALID_ARGUMENT',
          retryable: false,
        });
      }

      return res.status(502).json({
        error: 'Unable to generate a response right now due to an upstream AI service timeout or error. You can retry or switch to Offline Demo Mode.',
        code: 'UPSTREAM_AI_ERROR',
        retryable: true,
        offlineDemoAvailable: true,
      });
    }
  })
);

// -------------------------------------------------------------
// 11. POST /api/benchmark/run - Deterministic Routing Test Harness
// -------------------------------------------------------------
app.post('/api/benchmark/run', requireAuthenticated, async (_req, res) => {
  const defaultTenant = INITIAL_TENANTS[0];
  const results = [];

  for (const testCase of BENCHMARK_CASES) {
    const t0 = performance.now();

    let targetTenant = defaultTenant;
    if (
      testCase.expectedTool === 'track_shipment' ||
      testCase.expectedTool === 'reschedule_delivery' ||
      testCase.scenario.includes('Order') ||
      testCase.scenario.includes('Tracking') ||
      testCase.scenario.includes('Return')
    ) {
      targetTenant = INITIAL_TENANTS.find(t => t.id === 'konark_logistics') || defaultTenant;
    } else if (testCase.expectedTool === 'check_batch_schedule' || testCase.scenario.includes('Batch')) {
      targetTenant = INITIAL_TENANTS.find(t => t.id === 'pragati_coaching') || defaultTenant;
    } else if (testCase.expectedTool === 'check_branch_cutoff' || testCase.scenario.includes('Cutoff') || testCase.scenario.includes('Admission')) {
      targetTenant = INITIAL_TENANTS.find(t => t.id === 'utkal_university') || defaultTenant;
    }

    const lang = detectLanguage(testCase.userInput, testCase.language);
    const emergency = checkEmergencyCondition(testCase.userInput, lang.detected, targetTenant);
    const wantsHuman = checkHumanEscalationRequest(testCase.userInput);

    let detectedIntent: string;
    let toolInvoked: string | undefined = undefined;
    let actualReply: string;

    if (emergency) {
      detectedIntent = 'emergency_medical';
      actualReply = emergency.emergencyMessage;
    } else if (wantsHuman) {
      detectedIntent = 'human_escalation';
      actualReply = buildHumanEscalationReply(lang.detected, targetTenant);
    } else {
      const output = processTurn({
        userInput: testCase.userInput,
        tenant: targetTenant,
        currentLanguage: testCase.language,
        callMemory: {},
        turnHistory: [],
      });
      detectedIntent = output.detectedIntent;
      toolInvoked = output.toolInvokedName;
      actualReply = output.spokenReply;
    }

    const elapsed = Math.max(1, Math.round(performance.now() - t0));
    const intentCorrect = detectedIntent === testCase.expectedIntent;
    const toolCorrect = testCase.expectedTool ? toolInvoked === testCase.expectedTool : true;
    const passed = intentCorrect && toolCorrect;

    results.push({
      ...testCase,
      measuredLatencyMs: elapsed,
      measuredIntent: detectedIntent,
      intentCorrect,
      toolCallCorrect: toolCorrect,
      passed,
      actualReply,
      executionStatus: passed ? 'completed' : 'error',
    });
  }

  const passedCount = results.filter(r => r.passed).length;
  const overallAccuracy = Math.round((passedCount / results.length) * 100);
  const avgLatency = Math.round(results.reduce((acc, r) => acc + (r.measuredLatencyMs || 0), 0) / results.length);

  res.json({
    mode: 'deterministic_routing_harness',
    totalCases: results.length,
    passedCount,
    overallAccuracy,
    avgLatency,
    cases: results,
  });
});

// Return explicit 404 JSON for unknown /api/* routes before SPA static fallback
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.', code: 'NOT_FOUND' });
});

// Global Express error handler (never leak raw stack traces)
app.use((err: any, req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
  logStructuredEvent('error', 'server.unhandled_route_error', {
    traceId: req?.traceId,
    method: req?.method,
    path: req?.path,
    error: String(err?.message || err || 'Unknown error').slice(0, 320),
  });
  if (res.headersSent) return;
  res.status(500).json({
    error: 'Internal server error.',
    code: 'INTERNAL_ERROR',
    traceId: req?.traceId,
  });
});

// -------------------------------------------------------------
// 12. Dev vs Production Middleware
// -------------------------------------------------------------
async function startServer() {
  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    logStructuredEvent('info', 'server.started', {
      port: PORT,
      mode: isDev ? 'development' : 'production',
      geminiConfigured: Boolean(aiClient),
      dataDir: DATA_DIR,
    });
  });

  const gracefulShutdown = (signal: string) => {
    logStructuredEvent('info', 'server.stopping', { signal });
    httpServer.close(() => {
      try {
        db.close();
      } catch {
        // ignore if already closed
      }
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('unhandledRejection', reason => {
    logStructuredEvent('error', 'process.unhandled_rejection', {
      error: String(reason).slice(0, 400),
    });
  });
  process.on('uncaughtException', err => {
    logStructuredEvent('error', 'process.uncaught_exception', {
      error: String(err?.message || err).slice(0, 400),
    });
    gracefulShutdown('uncaughtException');
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
