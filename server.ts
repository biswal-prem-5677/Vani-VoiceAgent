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
  checkHumanEscalationRequest,
  buildHumanEscalationReply,
} from './src/utils/safety.ts';
import { searchKnowledgeBase } from './src/utils/ragEngine.ts';
import { executeTenantTool } from './src/utils/tools.ts';
import { detectLanguage } from './src/utils/languageDetector.ts';
import { extractEntitiesFromInput, processTurn } from './src/utils/callPipeline.ts';
import {
  GEMINI_CHAT_MODEL,
  buildGeminiConversationContents,
  buildTenantSystemInstruction,
  buildGeminiToolDeclarations,
  extractMemoryUpdatesFromToolCall,
} from './src/utils/geminiTurnBuilder.ts';
import {
  hashPassword,
  verifyPassword,
  constantTimeEqualString,
  signSessionToken,
  verifySessionToken,
  canAccessTenant,
  type SessionTokenPayload,
} from './src/utils/auth.ts';
import {
  TurnRequestSchema,
  ConsentRequestSchema,
  SupportTicketSchema,
  TenantConfigSchema,
  CallLogCreateSchema,
  AuthBootstrapSchema,
  AuthLoginSchema,
  TenantAdminCreateSchema,
  HandoffUpdateSchema,
} from './src/utils/schemas.ts';
import type { TenantConfig, CallLog, HandoffTicket } from './src/types/index.ts';

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Runtime signing key (process.env override with ephemeral CSPRNG fallback)
const SESSION_SECRET = process.env.SESSION_SECRET?.trim() || crypto.randomBytes(32).toString('hex');
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE?.trim() || '';

// Security headers (iframe-compatible for preview environments)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self)');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
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
// 1. Initialize SQLite Database with writable directory fallback
// -------------------------------------------------------------
let DATA_DIR = path.resolve(process.cwd(), 'data');
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch {
  DATA_DIR = path.join('/tmp', 'vanivoice-data');
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

const db = new DatabaseSync(path.join(DATA_DIR, 'vanivoice.db'));

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

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_call_logs_created_at ON call_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_call_logs_tenant_id ON call_logs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_call_logs_expires_at ON call_logs(expires_at);
  CREATE INDEX IF NOT EXISTS idx_handoff_tickets_tenant_id ON handoff_tickets(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_pending_actions_session ON pending_actions(session_id, tenant_id, tool_name);
`);

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

// Retention purge worker
function purgeExpiredCallLogs(): number {
  try {
    const info = db
      .prepare('DELETE FROM call_logs WHERE expires_at IS NOT NULL AND expires_at <= ?')
      .run(Date.now());
    return Number(info.changes || 0);
  } catch {
    return 0;
  }
}

purgeExpiredCallLogs();
setInterval(() => {
  purgeExpiredCallLogs();
}, 15 * 60 * 1000).unref();

// -------------------------------------------------------------
// 2. Bounded Rate Limiting with Periodic Stale-Key Cleanup
// -------------------------------------------------------------
interface RateBucket {
  count: number;
  windowStart: number;
}

const rateLimitStores: Map<string, RateBucket>[] = [];

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
}, 60 * 1000).unref();

const generalApiLimiter = createRateLimiter(180, 60 * 1000, 'API rate limit exceeded. Please retry shortly.');
const turnLimiter = createRateLimiter(60, 60 * 1000, 'Too many voice turns per minute. Please wait before continuing.');
const authLimiter = createRateLimiter(15, 60 * 1000, 'Too many authentication attempts. Please wait one minute.');

app.use('/api', generalApiLimiter);

// -------------------------------------------------------------
// 3. Gemini API Client (Server-side Only)
// -------------------------------------------------------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
let aiClient: GoogleGenAI | null = null;
let primaryModelCooldownUntil = 0;

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
// 4. Auth & Tenant Helpers
// -------------------------------------------------------------
interface AuthenticatedRequest extends Request {
  authUser?: SessionTokenPayload;
}

function getAuthUser(req: Request): SessionTokenPayload | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return verifySessionToken(token, SESSION_SECRET);
}

function requireAuthenticated(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({
      error: 'Authentication required. Initialize a caller session or sign in as workspace administrator.',
      code: 'UNAUTHENTICATED',
    });
  }
  req.authUser = user;
  return next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const user = getAuthUser(req);
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
}

function requireSuperAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const user = getAuthUser(req);
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
}

function getTenantByIdStrict(tenantId: string): TenantConfig | null {
  const row = db.prepare('SELECT data FROM tenants WHERE id = ?').get(tenantId) as { data: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.data) as TenantConfig;
  } catch {
    return null;
  }
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
    isPublicSummaryOnly: true,
  };
}

function hasSuperAdminAccount(): boolean {
  const row = db
    .prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'super_admin'")
    .get() as { cnt: number };
  return row.cnt > 0;
}

function createHandoffTicket(params: {
  tenant: TenantConfig;
  sessionId: string;
  reason: string;
  priority: 'critical' | 'high' | 'normal';
  summary: string;
}): HandoffTicket {
  const now = Date.now();
  const id = `HND-${Math.floor(100000 + Math.random() * 900000)}`;
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
      (id, tenant_id, tenant_name, session_id, reason, priority, summary, department, phone, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    ticket.updatedAt
  );

  return ticket;
}

function stableParamsHash(obj: Record<string, any>): string {
  const { confirmed: _ignored, ...rest } = obj || {};
  const sorted = Object.keys(rest)
    .sort()
    .reduce<Record<string, any>>((acc, k) => {
      acc[k] = rest[k];
      return acc;
    }, {});
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 24);
}

// -------------------------------------------------------------
// 5. Authentication & Session Endpoints
// -------------------------------------------------------------
app.get('/api/session', (req, res) => {
  const user = getAuthUser(req);
  const superAdminClaimed = hasSuperAdminAccount();
  res.json({
    authenticated: Boolean(user),
    authRequiredForAdmin: true,
    adminBootstrapNeeded: !ADMIN_PASSCODE && !superAdminClaimed,
    passcodeConfigured: Boolean(ADMIN_PASSCODE),
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
      defaultDays: 30,
      options: [7, 30, 90, 0],
    },
    serverAiActive: Boolean(aiClient),
    modelUsed: GEMINI_CHAT_MODEL,
  });
});

app.post('/api/auth/caller-session', (_req, res) => {
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

app.post('/api/auth/bootstrap', authLimiter, (req, res) => {
  if (ADMIN_PASSCODE) {
    return res.status(403).json({
      error: 'Workspace passcode is configured via ADMIN_PASSCODE. Use standard sign-in instead.',
    });
  }

  const parsed = AuthBootstrapSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid setup input.' });
  }

  const { name, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  if (hasSuperAdminAccount()) {
    return res.status(409).json({
      error: 'Workspace administrator account has already been claimed. Please sign in.',
    });
  }

  const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
  const sessionId = `sess_${crypto.randomUUID()}`;
  const passwordHash = hashPassword(password);

  try {
    db.prepare(
      'INSERT INTO users (id, email, name, role, allowed_tenants, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, normalizedEmail, name, 'super_admin', JSON.stringify(['*']), passwordHash, Date.now());
  } catch {
    return res.status(409).json({ error: 'Administrator email already exists.' });
  }

  const token = signSessionToken(
    {
      sub: userId,
      sessionId,
      email: normalizedEmail,
      name,
      role: 'super_admin',
      allowedTenants: ['*'],
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
});

app.post('/api/auth/login', authLimiter, (req, res) => {
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

  const row = db
    .prepare('SELECT id, email, name, role, allowed_tenants, password_hash FROM users WHERE email = ?')
    .get(email.toLowerCase()) as
    | {
        id: string;
        email: string;
        name: string;
        role: 'tenant_admin' | 'super_admin';
        allowed_tenants: string;
        password_hash: string;
      }
    | undefined;

  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const allowedTenants = JSON.parse(row.allowed_tenants) as string[];
  const token = signSessionToken(
    {
      sub: row.id,
      sessionId,
      email: row.email,
      name: row.name,
      role: row.role,
      allowedTenants,
    },
    SESSION_SECRET
  );

  return res.json({
    token,
    user: {
      id: row.id,
      sessionId,
      name: row.name,
      email: row.email,
      role: row.role,
      allowedTenants,
    },
  });
});

app.get('/api/auth/users', requireSuperAdmin, (_req, res) => {
  const rows = db
    .prepare('SELECT id, email, name, role, allowed_tenants, created_at FROM users ORDER BY created_at DESC')
    .all() as any[];
  res.json(
    rows.map(r => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      allowedTenants: JSON.parse(r.allowed_tenants),
      createdAt: r.created_at,
    }))
  );
});

app.post('/api/auth/users', requireSuperAdmin, (req, res) => {
  const parsed = TenantAdminCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid user payload.' });
  }
  const { name, email, password, role, allowedTenants } = parsed.data;
  const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
  const passwordHash = hashPassword(password);

  try {
    db.prepare(
      'INSERT INTO users (id, email, name, role, allowed_tenants, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(userId, email.toLowerCase(), name, role, JSON.stringify(allowedTenants), passwordHash, Date.now());
    return res.status(201).json({
      success: true,
      user: { id: userId, email: email.toLowerCase(), name, role, allowedTenants },
    });
  } catch {
    return res.status(409).json({ error: 'A user with that email already exists.' });
  }
});

// -------------------------------------------------------------
// 6. Multi-Tenant Endpoints (Public Summaries vs Scoped Admin)
// -------------------------------------------------------------
app.get('/api/tenants', (req, res) => {
  const user = getAuthUser(req);
  const rows = db.prepare('SELECT data FROM tenants').all() as { data: string }[];
  const allTenants = rows.map(r => JSON.parse(r.data) as TenantConfig);

  if (user && (user.role === 'super_admin' || user.role === 'tenant_admin')) {
    const scoped = allTenants.filter(t => canAccessTenant(user, t.id));
    return res.json(scoped);
  }

  return res.json(allTenants.map(toPublicTenantSummary));
});

app.get('/api/tenants/:id', requireAdmin, (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  if (!canAccessTenant(req.authUser, id)) {
    return res.status(403).json({ error: 'Forbidden: you do not have access to this tenant.' });
  }
  const tenant = getTenantByIdStrict(id);
  if (!tenant) {
    return res.status(404).json({ error: 'Tenant not found.' });
  }
  return res.json(tenant);
});

app.post('/api/tenants', requireSuperAdmin, (req, res) => {
  const parsed = TenantConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid tenant payload' });
  }
  const newTenant = parsed.data as TenantConfig;
  if (getTenantByIdStrict(newTenant.id)) {
    return res.status(409).json({ error: 'Tenant ID already exists.' });
  }
  db.prepare('INSERT INTO tenants (id, data, updated_at) VALUES (?, ?, ?)').run(
    newTenant.id,
    JSON.stringify(newTenant),
    Date.now()
  );
  return res.status(201).json({ success: true, tenant: newTenant });
});

app.post('/api/tenants/:id', requireAdmin, (req: AuthenticatedRequest, res) => {
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
  db.prepare('INSERT OR REPLACE INTO tenants (id, data, updated_at) VALUES (?, ?, ?)').run(
    id,
    JSON.stringify(updated),
    Date.now()
  );
  return res.json({ success: true, tenant: updated });
});

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

  if (requestedTenantId && !canAccessTenant(user, requestedTenantId)) {
    return res.status(403).json({ error: 'Forbidden: cannot access logs for requested tenant.' });
  }

  const rows = requestedTenantId
    ? (db
        .prepare('SELECT tenant_id, data FROM call_logs WHERE tenant_id = ? ORDER BY created_at DESC')
        .all(requestedTenantId) as { tenant_id: string; data: string }[])
    : (db
        .prepare('SELECT tenant_id, data FROM call_logs ORDER BY created_at DESC')
        .all() as { tenant_id: string; data: string }[]);

  const logs = rows
    .filter(r => canAccessTenant(user, r.tenant_id))
    .map(r => JSON.parse(r.data) as CallLog);

  return res.json(logs);
});

app.get('/api/session/logs', requireAuthenticated, (req: AuthenticatedRequest, res) => {
  const sessionId = req.authUser!.sessionId;
  const rows = db
    .prepare('SELECT data FROM call_logs WHERE session_id = ? ORDER BY created_at DESC')
    .all(sessionId) as { data: string }[];
  return res.json(rows.map(r => JSON.parse(r.data)));
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

  const now = Date.now();
  const expiresAt = now + consent.retention_days * 24 * 60 * 60 * 1000;

  db.prepare(
    'INSERT OR REPLACE INTO call_logs (id, tenant_id, session_id, expires_at, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(log.id, log.tenantId, sessionId, expiresAt, JSON.stringify(log), now);

  return res.status(201).json({
    success: true,
    persisted: true,
    expiresAt,
  });
});

app.delete('/api/session/data', requireAuthenticated, (req: AuthenticatedRequest, res) => {
  const sessionId = req.authUser!.sessionId;
  db.prepare('DELETE FROM call_logs WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM consent_records WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM pending_actions WHERE session_id = ?').run(sessionId);
  return res.json({
    success: true,
    message: 'All transcripts and preferences for your current session have been deleted.',
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
  return res.json({ success: true, message: 'Authorized tenant call logs deleted.' });
});

app.post('/api/user/wipe-all', requireSuperAdmin, (_req, res) => {
  try {
    db.exec('DELETE FROM call_logs');
    db.exec('DELETE FROM consent_records');
    db.exec('DELETE FROM support_tickets');
    db.exec('DELETE FROM handoff_tickets');
    db.exec('DELETE FROM pending_actions');
    db.exec('DELETE FROM tenants');

    const insertTenant = db.prepare('INSERT INTO tenants (id, data, updated_at) VALUES (?, ?, ?)');
    for (const t of INITIAL_TENANTS) {
      insertTenant.run(t.id, JSON.stringify(t), Date.now());
    }

    return res.json({
      success: true,
      message: 'All workspace transcripts, consent logs, handoff queues, support tickets, and custom tenants have been permanently wiped.',
      wipedAt: Date.now(),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to complete data deletion: ' + String(err) });
  }
});

// -------------------------------------------------------------
// 8. Staff Handoff Queue Endpoints (Tenant-Scoped Admin)
// -------------------------------------------------------------
app.get('/api/handoffs', requireAdmin, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const tenantFilter = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : undefined;

  if (tenantFilter && !canAccessTenant(user, tenantFilter)) {
    return res.status(403).json({ error: 'Forbidden: cannot read handoffs for requested tenant.' });
  }

  const rows = tenantFilter
    ? (db.prepare('SELECT * FROM handoff_tickets WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantFilter) as any[])
    : (db.prepare('SELECT * FROM handoff_tickets ORDER BY created_at DESC').all() as any[]);

  const filtered = rows
    .filter(r => canAccessTenant(user, r.tenant_id))
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
      notes: r.notes || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

  return res.json(filtered);
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
// 9. Health & Support Endpoints
// -------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  try {
    const tenantsCount = (db.prepare('SELECT COUNT(*) as cnt FROM tenants').get() as { cnt: number }).cnt;
    const logsCount = (db.prepare('SELECT COUNT(*) as cnt FROM call_logs').get() as { cnt: number }).cnt;
    const ticketsCount = (db.prepare('SELECT COUNT(*) as cnt FROM support_tickets').get() as { cnt: number }).cnt;
    const handoffsOpenCount = (
      db.prepare("SELECT COUNT(*) as cnt FROM handoff_tickets WHERE status != 'resolved'").get() as { cnt: number }
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
    res.status(500).json({ status: 'degraded', error: String(err) });
  }
});

app.post('/api/support/ticket', (req, res) => {
  const parsed = SupportTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid support ticket payload.' });
  }

  const { name, email, subject, message, tenantId } = parsed.data;
  const ticketId = `VANI-${Math.floor(100000 + Math.random() * 900000)}`;

  db.prepare(
    'INSERT INTO support_tickets (id, tenant_id, name, email, subject, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(ticketId, tenantId || null, name, email, subject || 'General Inquiry', message, 'open', Date.now());

  return res.status(201).json({
    success: true,
    ticketId,
    message: `Ticket ${ticketId} created successfully. Stored in server support queue for ${email}.`,
  });
});

// -------------------------------------------------------------
// 10. POST /api/turn - Authenticated, Tenant-Isolated Turn Pipeline
// -------------------------------------------------------------
app.post('/api/turn', requireAuthenticated, turnLimiter, async (req: AuthenticatedRequest, res: Response) => {
  const startTurn = performance.now();
  const parsed = TurnRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid turn payload.' });
  }

  const { tenantId, userText, language, memory, history, idempotencyKey, demoMode } = parsed.data;
  const sessionId = req.authUser!.sessionId;

  // Strict tenant resolution (no silent fallback to tenant 0)
  const tenant = getTenantByIdStrict(tenantId);
  if (!tenant) {
    return res.status(404).json({
      error: `Unknown tenantId "${tenantId}". Select a valid tenant before sending turns.`,
      code: 'TENANT_NOT_FOUND',
      retryable: false,
    });
  }

  // Idempotency short-circuit for repeated submissions
  if (idempotencyKey) {
    const cachedAction = db
      .prepare('SELECT result_json FROM pending_actions WHERE session_id = ? AND tenant_id = ? AND idempotency_key = ? AND status = ?')
      .get(sessionId, tenant.id, idempotencyKey, 'completed') as { result_json: string } | undefined;
    if (cachedAction?.result_json) {
      try {
        return res.json(JSON.parse(cachedAction.result_json));
      } catch {
        // continue if malformed
      }
    }
  }

  // 1. Language Detection & mid-call switch
  const langAnalysis = detectLanguage(userText, language);
  const activeLang = langAnalysis.detected;

  // 2. Safety Check: Emergency Medical Symptoms -> Durable Handoff Queue Ticket
  const emergencyPreview = checkEmergencyCondition(userText, activeLang, tenant);
  if (emergencyPreview) {
    const ticket = createHandoffTicket({
      tenant,
      sessionId,
      reason: `Emergency indicator: ${emergencyPreview.symptomDetected || 'Critical symptom'}`,
      priority: 'critical',
      summary: userText,
    });
    const emergencyWithTicket = checkEmergencyCondition(userText, activeLang, tenant, ticket.id)!;
    const elapsed = Math.max(1, Math.round(performance.now() - startTurn));

    return res.json({
      reply: emergencyWithTicket.emergencyMessage,
      language: activeLang,
      switchedLanguage: langAnalysis.switched,
      toolCalls: [],
      shouldHandoff: true,
      handoffReason: emergencyWithTicket.actionRequired,
      handoffTicket: ticket,
      isEmergency: true,
      intent: 'emergency_medical',
      memoryUpdates: {
        ...memory,
        emergencyReported: emergencyWithTicket.symptomDetected || 'Critical symptom detected',
        handoffTicketId: ticket.id,
        escalationStatus: `Queued (${ticket.id})`,
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
    const ticket = createHandoffTicket({
      tenant,
      sessionId,
      reason: 'Caller requested human staff specialist',
      priority: 'high',
      summary: userText,
    });
    const elapsed = Math.max(1, Math.round(performance.now() - startTurn));

    return res.json({
      reply: buildHumanEscalationReply(activeLang, tenant, ticket.id),
      language: activeLang,
      switchedLanguage: langAnalysis.switched,
      toolCalls: [],
      shouldHandoff: true,
      handoffReason: `Callback ticket ${ticket.id} queued for ${tenant.humanHandoffContact.department}`,
      handoffTicket: ticket,
      intent: 'human_escalation',
      memoryUpdates: {
        ...memory,
        handoffTicketId: ticket.id,
        escalationStatus: `Queued (${ticket.id})`,
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

  // 5. Explicit Offline Demo Mode when GEMINI_API_KEY is absent
  if (!aiClient) {
    if (demoMode) {
      const demoOut = processTurn({
        userInput: userText,
        tenant,
        currentLanguage: language,
        callMemory: workingMemory,
        turnHistory: history as any[],
      });
      return res.json({
        reply: demoOut.spokenReply,
        language: demoOut.detectedLanguage,
        switchedLanguage: demoOut.switchedLanguage,
        toolCalls: demoOut.toolInvokedName
          ? [{ name: demoOut.toolInvokedName, result: demoOut.toolResult }]
          : [],
        shouldHandoff: demoOut.shouldHandoff,
        handoffReason: demoOut.handoffReason,
        intent: demoOut.detectedIntent,
        model: 'offline-deterministic-demo',
        memoryUpdates: demoOut.updatedMemory,
        latencyBreakdown: demoOut.latencyBreakdown,
      });
    }

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
        return await invokeModelWithTimeout(GEMINI_CHAT_MODEL, contents, true, 3500);
      } catch (firstErr: any) {
        const msg = String(firstErr?.message || firstErr || '');
        const status = Number(firstErr?.status || 0);
        console.warn(`Primary model ${GEMINI_CHAT_MODEL} error:`, status, msg.slice(0, 200));

        if (status === 401 || status === 403 || /PERMISSION_DENIED|API_KEY_INVALID/i.test(msg)) {
          throw firstErr;
        }

        if (status === 503 || status === 429 || /UNAVAILABLE|RESOURCE_EXHAUSTED|Timeout|abort/i.test(msg)) {
          primaryModelCooldownUntil = Date.now() + 120_000;
        }
      }
    }

    activeModelUsed = 'gemini-3.1-flash-lite';
    try {
      return await invokeModelWithTimeout('gemini-3.1-flash-lite', contents, false, 10000);
    } catch (liteErr: any) {
      const msg = String(liteErr?.message || liteErr || '');
      const status = Number(liteErr?.status || 0);
      const isTransient =
        status === 503 ||
        status === 429 ||
        status >= 500 ||
        /UNAVAILABLE|RESOURCE_EXHAUSTED|ECONNRESET|ETIMEDOUT|fetch failed|Timeout|abort/i.test(msg);
      if (!isTransient) throw liteErr;
      await new Promise(resolve => setTimeout(resolve, 450));
      return await invokeModelWithTimeout('gemini-3.1-flash-lite', contents, false, 10000);
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

        const callArgs: Record<string, any> = { ...(fc.args || {}) };
        const requiresConfirmationGate =
          calledName === 'book_appointment' || calledName === 'reschedule_delivery';

        // Durable confirmation state check in SQLite
        if (requiresConfirmationGate) {
          const paramsHash = stableParamsHash(callArgs);
          const pendingRow = db
            .prepare(
              'SELECT id FROM pending_actions WHERE session_id = ? AND tenant_id = ? AND tool_name = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
            )
            .get(sessionId, tenant.id, calledName, 'pending') as { id: string } | undefined;

          if (callArgs.confirmed && !pendingRow) {
            // Require explicit confirmation turn before committing irreversible mock state change
            callArgs.confirmed = false;
          }

          const toolResult = executeTenantTool(calledName, callArgs, tenant.name, activeLang);

          if (toolResult.requiresConfirmation) {
            const actionId = pendingRow?.id || `act_${crypto.randomUUID().slice(0, 12)}`;
            db.prepare(
              'INSERT OR REPLACE INTO pending_actions (id, session_id, tenant_id, tool_name, params_hash, idempotency_key, status, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            ).run(actionId, sessionId, tenant.id, calledName, paramsHash, null, 'pending', null, Date.now());
          } else if (toolResult.success && pendingRow) {
            db.prepare(
              'UPDATE pending_actions SET status = ?, idempotency_key = ? WHERE id = ?'
            ).run('completed', idempotencyKey || null, pendingRow.id);
          }

          workingMemory = extractMemoryUpdatesFromToolCall(calledName, callArgs, toolResult, workingMemory);
          executedToolCalls.push({ name: calledName, result: toolResult });
          functionResponseParts.push({
            functionResponse: { name: calledName, response: toolResult as unknown as Record<string, any> },
          });
          continue;
        }

        const toolResult = executeTenantTool(calledName, callArgs, tenant.name, activeLang);
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
      db.prepare(
        'INSERT OR REPLACE INTO pending_actions (id, session_id, tenant_id, tool_name, params_hash, idempotency_key, status, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        `idem_${crypto.randomUUID().slice(0, 12)}`,
        sessionId,
        tenant.id,
        primaryToolName || 'turn',
        idempotencyKey,
        idempotencyKey,
        'completed',
        JSON.stringify(responseBody),
        Date.now()
      );
    }

    return res.json(responseBody);
  } catch (llmErr: any) {
    const errMsg = String(llmErr?.message || llmErr || 'Unknown Gemini API error');
    const errStatus = Number(llmErr?.status || 0);
    const safeDetail = errMsg.slice(0, 320);
    console.error('Gemini server call failed:', errStatus, safeDetail);

    if (errStatus === 429 || /RESOURCE_EXHAUSTED|quota/i.test(errMsg)) {
      return res.status(429).json({
        error: 'AI quota or rate limit reached. Wait a moment and retry, or check API billing.',
        code: 'RESOURCE_EXHAUSTED',
        detail: safeDetail,
        retryable: true,
      });
    }
    if (errStatus === 401 || errStatus === 403 || /PERMISSION_DENIED|API_KEY_INVALID/i.test(errMsg)) {
      return res.status(403).json({
        error: 'Gemini API authentication failed. Verify GEMINI_API_KEY configuration.',
        code: 'API_KEY_INVALID',
        detail: safeDetail,
        retryable: false,
      });
    }
    if (errStatus === 404 || /NOT_FOUND/i.test(errMsg)) {
      return res.status(502).json({
        error: `Configured Gemini model (${GEMINI_CHAT_MODEL}) was unavailable upstream.`,
        code: 'MODEL_NOT_FOUND',
        detail: safeDetail,
        retryable: false,
      });
    }
    if (errStatus === 400 || /INVALID_ARGUMENT/i.test(errMsg)) {
      return res.status(400).json({
        error: 'The AI model rejected the request parameters.',
        code: 'INVALID_ARGUMENT',
        detail: safeDetail,
        retryable: false,
      });
    }

    return res.status(502).json({
      error: 'Unable to generate a response right now due to an upstream AI service error. Please retry.',
      code: 'UPSTREAM_AI_ERROR',
      detail: safeDetail,
      retryable: true,
    });
  }
});

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

    let detectedIntent = 'general_inquiry';
    let toolInvoked: string | undefined = undefined;
    let actualReply = '';

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

// -------------------------------------------------------------
// 12. Dev vs Production Middleware
// -------------------------------------------------------------
async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VaniVoice AI server running on port ${PORT} [${isDev ? 'development' : 'production'}]`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
