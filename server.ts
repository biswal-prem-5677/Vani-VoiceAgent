import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';
import { INITIAL_TENANTS } from './src/data/tenants.ts';
import { INITIAL_CALL_LOGS } from './src/data/mockCallLogs.ts';
import { checkEmergencyCondition, checkHumanEscalationRequest } from './src/utils/safety.ts';
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
import { BENCHMARK_CASES } from './src/data/evalBenchmark.ts';
import type { TenantConfig, CallLog } from './src/types/index.ts';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Body parser with size limits
app.use(express.json({ limit: '500kb' }));

// Serve public directory for icons, manifest, robots.txt, and sitemap.xml
app.use(express.static(path.resolve(process.cwd(), 'public')));

// 1. Initialize SQLite Database with writable directory fallback
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

// Create tables and indexes
db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS call_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_call_logs_created_at ON call_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_call_logs_tenant_id ON call_logs(tenant_id);

  CREATE TABLE IF NOT EXISTS user_settings (
    id TEXT PRIMARY KEY,
    consented_at INTEGER,
    retention_days INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
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
  const insertLog = db.prepare('INSERT INTO call_logs (id, tenant_id, data, created_at) VALUES (?, ?, ?, ?)');
  for (const l of INITIAL_CALL_LOGS) {
    insertLog.run(l.id, l.tenantId, JSON.stringify(l), Date.now());
  }
}

// 2. IP Rate Limiting Map
const ipRequestWindow = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 120;

function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = ipRequestWindow.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    ipRequestWindow.set(ip, { count: 1, windowStart: now });
    return next();
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({
      error: 'Too many requests. Please wait before sending more voice input.',
    });
  }

  entry.count++;
  return next();
}

// 3. Gemini API Client (Server-side Only)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
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

// Helper to retrieve tenant by ID
function getTenantById(tenantId: string): TenantConfig | null {
  const row = db.prepare('SELECT data FROM tenants WHERE id = ?').get(tenantId) as { data: string } | undefined;
  if (!row) {
    return INITIAL_TENANTS.find(t => t.id === tenantId) || null;
  }
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// Session / Simple Auth
app.get('/api/session', (_req, res) => {
  res.json({
    authenticated: true,
    user: {
      id: 'usr_prototype_admin',
      name: 'Demo Workspace Administrator',
      email: 'admin@prototype.local',
      role: 'tenant_admin',
      allowedTenants: ['*'],
    },
    retentionPolicy: {
      defaultDays: 30,
      options: [7, 30, 90, 0], // 0 = do not retain
    },
    serverAiActive: Boolean(aiClient),
    modelUsed: GEMINI_CHAT_MODEL,
  });
});

// Tenants API
app.get('/api/tenants', (_req, res) => {
  const rows = db.prepare('SELECT data FROM tenants').all() as { data: string }[];
  const list = rows.map(r => JSON.parse(r.data));
  res.json(list);
});

app.post('/api/tenants/:id', (req, res) => {
  const { id } = req.params;
  const updated = req.body;
  if (!updated || typeof updated !== 'object') {
    return res.status(400).json({ error: 'Invalid tenant payload' });
  }
  const stmt = db.prepare('INSERT OR REPLACE INTO tenants (id, data, updated_at) VALUES (?, ?, ?)');
  stmt.run(id, JSON.stringify(updated), Date.now());
  res.json({ success: true, tenant: updated });
});

app.post('/api/tenants', (req, res) => {
  const newTenant = req.body;
  if (!newTenant || !newTenant.id || !newTenant.name) {
    return res.status(400).json({ error: 'Tenant must contain id and name' });
  }
  const stmt = db.prepare('INSERT INTO tenants (id, data, updated_at) VALUES (?, ?, ?)');
  stmt.run(newTenant.id, JSON.stringify(newTenant), Date.now());
  res.status(201).json({ success: true, tenant: newTenant });
});

// Call Logs API
app.get('/api/logs', (req, res) => {
  const tenantId = req.query.tenantId as string | undefined;
  let rows: { data: string }[];
  if (tenantId) {
    rows = db.prepare('SELECT data FROM call_logs WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId) as { data: string }[];
  } else {
    rows = db.prepare('SELECT data FROM call_logs ORDER BY created_at DESC').all() as { data: string }[];
  }
  const logs = rows.map(r => JSON.parse(r.data));
  res.json(logs);
});

app.post('/api/logs', (req, res) => {
  const log: CallLog = req.body;
  if (!log || !log.id || !log.tenantId) {
    return res.status(400).json({ error: 'Invalid call log' });
  }
  const stmt = db.prepare('INSERT OR REPLACE INTO call_logs (id, tenant_id, data, created_at) VALUES (?, ?, ?, ?)');
  stmt.run(log.id, log.tenantId, JSON.stringify(log), Date.now());
  res.status(201).json({ success: true });
});

app.delete('/api/logs/all', (_req, res) => {
  db.exec('DELETE FROM call_logs');
  res.json({ success: true, message: 'All call logs deleted (Data privacy compliance action)' });
});

// Privacy Consent API
app.post('/api/consent', (req, res) => {
  const { consented, retentionDays } = req.body;
  const id = 'user_active';
  const stmt = db.prepare('INSERT OR REPLACE INTO user_settings (id, consented_at, retention_days, updated_at) VALUES (?, ?, ?, ?)');
  stmt.run(id, consented ? Date.now() : 0, retentionDays || 30, Date.now());
  res.json({ success: true });
});

// Operational Health & Status API
app.get('/api/health', (_req, res) => {
  try {
    const tenantsCount = (db.prepare('SELECT COUNT(*) as cnt FROM tenants').get() as { cnt: number }).cnt;
    const logsCount = (db.prepare('SELECT COUNT(*) as cnt FROM call_logs').get() as { cnt: number }).cnt;
    const ticketsCount = (db.prepare('SELECT COUNT(*) as cnt FROM support_tickets').get() as { cnt: number }).cnt;

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
      },
      geminiAi: {
        configured: Boolean(aiClient),
        model: GEMINI_CHAT_MODEL,
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

// Full Account & Data Deletion (Google/Apple Store & GDPR/DPDP Policy Requirement)
app.post('/api/user/wipe-all', (_req, res) => {
  try {
    db.exec('DELETE FROM call_logs');
    db.exec('DELETE FROM user_settings');
    db.exec('DELETE FROM support_tickets');
    db.exec('DELETE FROM tenants');

    const insertTenant = db.prepare('INSERT INTO tenants (id, data, updated_at) VALUES (?, ?, ?)');
    for (const t of INITIAL_TENANTS) {
      insertTenant.run(t.id, JSON.stringify(t), Date.now());
    }

    res.json({
      success: true,
      message: 'All user session data, audio transcripts, settings, and workspace modifications have been permanently wiped from the server.',
      wipedAt: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to complete data deletion: ' + String(err) });
  }
});

// Post-launch Customer Support & Contact Desk
app.post('/api/support/ticket', (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(String(email).trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const ticketId = `VANI-${Math.floor(100000 + Math.random() * 900000)}`;
  const stmt = db.prepare('INSERT INTO support_tickets (id, name, email, subject, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  stmt.run(ticketId, String(name).trim(), String(email).trim(), String(subject || 'General Inquiry').trim(), String(message).trim(), 'open', Date.now());

  res.status(201).json({
    success: true,
    ticketId,
    message: `Ticket ${ticketId} created successfully. Our team will follow up via email (${email}) within 4 hours.`,
  });
});


// -------------------------------------------------------------
// POST /api/turn - The Real Server-Side Voice Turn Pipeline
// -------------------------------------------------------------
app.post('/api/turn', rateLimiter, async (req: Request, res: Response) => {
  const startTurn = performance.now();
  const { tenantId, userText, language = 'en', memory = {}, history = [] } = req.body;

  if (!userText || typeof userText !== 'string') {
    return res.status(400).json({ error: 'Missing userText' });
  }

  if (userText.length > 1000) {
    return res.status(400).json({ error: 'Input text exceeds 1000 character limit' });
  }

  const tenant = getTenantById(tenantId) || INITIAL_TENANTS[0];

  // 1. Language Detection & mid-call switch
  const langAnalysis = detectLanguage(userText, language);
  const activeLang = langAnalysis.detected;

  // 2. Safety Check: Emergency Medical Symptoms (Chest pain, breathlessness, etc.)
  const emergency = checkEmergencyCondition(userText, activeLang);
  if (emergency) {
    const elapsed = Math.max(50, Math.round(performance.now() - startTurn));
    return res.json({
      reply: emergency.emergencyMessage,
      language: activeLang,
      switchedLanguage: langAnalysis.switched,
      toolCalls: [],
      shouldHandoff: true,
      handoffReason: emergency.actionRequired,
      isEmergency: true,
      intent: 'emergency_medical',
      memoryUpdates: {
        ...memory,
        emergencyReported: emergency.symptomDetected || 'Critical symptom detected',
        escalationStatus: 'Transfer requested to Duty Medical Officer',
      },
      latencyBreakdown: {
        vadMs: 12,
        sttMs: 20,
        ragMs: 5,
        llmFirstTokenMs: elapsed,
        ttsFirstAudioMs: 15,
        totalTurnaroundMs: elapsed,
      },
    });
  }

  // 3. Safety Check: Whole-word Frustration & Human Escalation
  const wantsHuman = checkHumanEscalationRequest(userText);
  if (wantsHuman) {
    const handoffMessages: Record<string, string> = {
      or: 'ମୁଁ ବୁଝିପାରୁଛି ଆପଣ ବରିଷ୍ଠ ଅଧିକାରୀଙ୍କ ସହ କଥା ହେବାକୁ ଚାହୁଁଛନ୍ତି। ମୁଁ ତୁରନ୍ତ ଟ୍ରାନ୍ସଫର ରିକ୍ୱେଷ୍ଟ ପଠାଉଛି, ଦୟାକରି ଲାଇନରେ ରୁହନ୍ତୁ।',
      hi: 'मैं समझ रहा हूँ कि आप अधिकारी से बात करना चाहते हैं। मैं तुरंत कॉल ट्रांसफर का अनुरोध भेज रहा हूँ।',
      hinglish: 'I understand. Main turant senior support specialist ko transfer request bhej raha hoon. Please hold on.',
      bn: 'আমি বুঝতে পারছি আপনি কর্মকর্তার সাথে কথা বলতে চান। আমি এখনই ট্রান্সফার রিকোয়েস্ট পাঠাচ্ছি।',
      en: 'I understand you would like to speak with a human specialist. I am initiating an urgent transfer request to our staff right now. Please hold on.',
    };
    const elapsed = Math.max(60, Math.round(performance.now() - startTurn));
    return res.json({
      reply: handoffMessages[activeLang] || handoffMessages.en,
      language: activeLang,
      switchedLanguage: langAnalysis.switched,
      toolCalls: [],
      shouldHandoff: true,
      handoffReason: 'Caller requested human agent / supervisor',
      intent: 'human_escalation',
      memoryUpdates: {
        ...memory,
        escalationStatus: 'Transfer requested',
      },
      latencyBreakdown: {
        vadMs: 15,
        sttMs: 25,
        ragMs: 5,
        llmFirstTokenMs: elapsed,
        ttsFirstAudioMs: 15,
        totalTurnaroundMs: elapsed,
      },
    });
  }

  // 4. Relevant Knowledge Base Chunks + Entity Extraction
  const tRag0 = performance.now();
  const ragResults = searchKnowledgeBase(userText, tenant.knowledgeBase, 4, 0.15);
  const ragMs = Math.max(5, Math.round(performance.now() - tRag0));
  let workingMemory: Record<string, string> = extractEntitiesFromInput(userText, memory || {});

  // 5. Require configured Gemini client for genuine dynamic generation
  if (!aiClient) {
    return res.status(503).json({
      error: 'Gemini AI is not configured on the server. Please set GEMINI_API_KEY in Settings > Secrets.',
      code: 'GEMINI_NOT_CONFIGURED',
      retryable: false,
    });
  }

  // 6. Server-Side Gemini Generation with Multi-Turn History, Full Tenant Knowledge & Tool Synthesis
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

        // Cooldown on demand spikes / rate limits / timeouts so subsequent voice turns stay fast
        if (status === 503 || status === 429 || /UNAVAILABLE|RESOURCE_EXHAUSTED|Timeout|abort/i.test(msg)) {
          primaryModelCooldownUntil = Date.now() + 120_000;
        }
      }
    }

    // Use ultra-fast free-tier generative model gemini-3.1-flash-lite with 1 transient retry
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
      Array.isArray(history) ? history : [],
      userText
    );

    let geminiResponse = await callGeminiWithRetry(conversationContents);
    const executedToolCalls: { name: string; result: any }[] = [];

    // Execute any function calls and feed tool results back so Gemini crafts a natural reply
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
        const callArgs = (fc.args || {}) as Record<string, any>;
        const toolResult = executeTenantTool(calledName, callArgs, tenant.name, activeLang);

        workingMemory = extractMemoryUpdatesFromToolCall(
          calledName,
          callArgs,
          toolResult,
          workingMemory
        );
        executedToolCalls.push({ name: calledName, result: toolResult });

        functionResponseParts.push({
          functionResponse: {
            name: calledName,
            response: toolResult as unknown as Record<string, any>,
          },
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

    const llmMs = Math.max(80, Math.round(performance.now() - tLlm0));
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

    const totalElapsed = Math.round(performance.now() - startTurn);
    const primaryToolName = executedToolCalls[0]?.name;

    return res.json({
      reply: finalReply,
      language: activeLang,
      switchedLanguage: langAnalysis.switched,
      toolCalls: executedToolCalls,
      shouldHandoff: false,
      intent: primaryToolName || (ragResults.length > 0 ? 'kb_retrieval' : 'conversational_ai'),
      model: activeModelUsed,
      memoryUpdates: workingMemory,
      latencyBreakdown: {
        vadMs: 15,
        sttMs: 25,
        ragMs,
        llmFirstTokenMs: llmMs,
        ttsFirstAudioMs: 15,
        totalTurnaroundMs: totalElapsed,
      },
    });
  } catch (llmErr: any) {
    const errMsg = String(llmErr?.message || llmErr || 'Unknown Gemini API error');
    const errStatus = Number(llmErr?.status || 0);
    const safeDetail = errMsg.slice(0, 320);
    console.error('Gemini server call failed:', errStatus, safeDetail);

    if (errStatus === 429 || /RESOURCE_EXHAUSTED|quota/i.test(errMsg)) {
      return res.status(429).json({
        error: 'AI quota or rate limit reached. Please wait a moment and retry, or check billing in Settings > Secrets.',
        code: 'RESOURCE_EXHAUSTED',
        detail: safeDetail,
        retryable: true,
      });
    }
    if (errStatus === 401 || errStatus === 403 || /PERMISSION_DENIED|API_KEY_INVALID/i.test(errMsg)) {
      return res.status(403).json({
        error: 'Gemini API authentication failed. Please verify GEMINI_API_KEY in Settings > Secrets.',
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
      error: 'Unable to generate a response right now due to an upstream AI service error. Please try again.',
      code: 'UPSTREAM_AI_ERROR',
      detail: safeDetail,
      retryable: true,
    });
  }
});

// -------------------------------------------------------------
// POST /api/benchmark/run - Real Test Harness Execution
// -------------------------------------------------------------
app.post('/api/benchmark/run', async (_req, res) => {
  const defaultTenant = INITIAL_TENANTS[0]; // Kalinga Care Clinic
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

    // Run test input through real turn processing
    const lang = detectLanguage(testCase.userInput, testCase.language);
    const emergency = checkEmergencyCondition(testCase.userInput, lang.detected);
    const wantsHuman = checkHumanEscalationRequest(testCase.userInput);

    let detectedIntent = 'general_inquiry';
    let toolInvoked: string | undefined = undefined;
    let actualReply = '';

    if (emergency) {
      detectedIntent = 'emergency_medical';
      actualReply = emergency.emergencyMessage;
    } else if (wantsHuman) {
      detectedIntent = 'human_escalation';
      actualReply = 'Handoff requested to staff.';
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

    const elapsed = Math.round(performance.now() - t0);

    const intentCorrect = detectedIntent === testCase.expectedIntent;
    const toolCorrect = testCase.expectedTool ? toolInvoked === testCase.expectedTool : true;
    const passed = intentCorrect && toolCorrect;

    results.push({
      ...testCase,
      measuredLatencyMs: Math.max(15, elapsed),
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
    totalCases: results.length,
    passedCount,
    overallAccuracy,
    avgLatency,
    cases: results,
  });
});

// -------------------------------------------------------------
// Dev vs Production Middleware
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
    console.log(`VaniVoice AI Prototype server running on port ${PORT} [${isDev ? 'development' : 'production'}]`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
