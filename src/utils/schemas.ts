import { z } from 'zod';

export const SupportedLanguageSchema = z.enum(['en', 'hi', 'or', 'bn', 'hinglish']);

export const TurnHistoryItemSchema = z.object({
  id: z.string().max(80).optional(),
  speaker: z.enum(['user', 'agent', 'system']),
  text: z.string().max(1500),
  language: SupportedLanguageSchema.optional(),
  timestamp: z.number().optional(),
  toolInvoked: z.object({
    toolName: z.string().max(80),
    params: z.record(z.string(), z.any()).optional(),
    result: z.any().optional(),
  }).optional(),
});

export const TurnRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(80),
  userText: z.string().trim().min(1, 'Missing userText').max(1000, 'Input text exceeds 1000 character limit'),
  language: SupportedLanguageSchema.optional().default('en'),
  memory: z.record(z.string().max(64), z.string().max(240))
    .refine(obj => Object.keys(obj).length <= 20, 'Memory exceeds max 20 slots')
    .optional()
    .default({}),
  history: z.array(TurnHistoryItemSchema).max(24, 'Conversation history limited to 24 turns').optional().default([]),
  idempotencyKey: z.string().trim().max(80).optional(),
  demoMode: z.boolean().optional().default(false),
});

export const ConsentRequestSchema = z.object({
  consented: z.boolean(),
  retentionDays: z.union([z.literal(0), z.literal(7), z.literal(30), z.literal(90)]),
  tenantId: z.string().trim().min(1).max(80).optional(),
});

export const SupportTicketSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().email('Please enter a valid email address').max(160),
  subject: z.string().trim().max(180).optional().default('General Inquiry'),
  message: z.string().trim().min(1, 'Message is required').max(3000),
  tenantId: z.string().trim().max(80).optional(),
});

export const DocumentChunkSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().min(1).max(4000),
  category: z.string().trim().min(1).max(80),
  tags: z.array(z.string().trim().max(40)).max(20),
  addedAt: z.string().max(40),
});

export const TenantToolSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_]+$/),
  displayName: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(400),
  parameters: z.array(z.object({
    name: z.string().trim().min(1).max(60),
    type: z.enum(['string', 'number', 'boolean', 'date']),
    description: z.string().trim().max(240),
    required: z.boolean(),
  })).max(10),
  handlerType: z.enum(['mock_appointment', 'mock_order', 'mock_admission', 'mock_ticket', 'custom_api']),
});

export const TenantConfigSchema = z.object({
  id: z.string().trim().min(2).max(80).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid tenant ID format'),
  name: z.string().trim().min(2).max(120),
  tagline: z.string().trim().max(200).optional().default(''),
  category: z.enum(['clinic', 'coaching', 'logistics', 'university', 'custom']),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#10b981'),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#10b981'),
  logoIcon: z.string().max(40).optional().default('Building2'),
  agentName: z.string().trim().min(1).max(60),
  voicePersona: z.object({
    gender: z.enum(['female', 'male']),
    speed: z.number().min(0.5).max(2.0),
    pitch: z.number().min(0.5).max(2.0),
    tone: z.string().max(180),
    provider: z.enum(['Sarvam AI', 'Google Cloud TTS', 'Web Speech', 'ElevenLabs']),
  }),
  supportedLanguages: z.array(SupportedLanguageSchema).min(1).max(5),
  defaultLanguage: SupportedLanguageSchema,
  systemPrompt: z.string().trim().min(1).max(2500),
  greetings: z.record(z.string(), z.string().max(600)),
  fillers: z.record(z.string(), z.array(z.string().max(240)).max(10)),
  knowledgeBase: z.array(DocumentChunkSchema).max(50, 'Maximum 50 knowledge chunks per tenant'),
  tools: z.array(TenantToolSchema).max(15),
  humanHandoffContact: z.object({
    department: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(3).max(40),
    email: z.string().trim().email().max(140),
  }),
  webhookConfig: z.object({
    enabled: z.boolean().default(false),
    url: z.string().trim().max(500).default(''),
    providerType: z.enum(['clinic_ehr_webhook', 'logistics_webhook', 'generic_webhook']).default('clinic_ehr_webhook'),
    secretHeaderName: z.string().trim().min(1).max(80).default('X-VaniVoice-Signature'),
    signingSecret: z.string().trim().max(256).optional(),
  }).optional(),
});

export const CallLogCreateSchema = z.object({
  id: z.string().trim().min(3).max(100),
  tenantId: z.string().trim().min(1).max(80),
  tenantName: z.string().trim().min(1).max(120),
  callerNumber: z.string().max(80),
  callerName: z.string().max(120),
  startedAt: z.string().max(60),
  durationSeconds: z.number().min(0).max(86400),
  languagesUsed: z.array(SupportedLanguageSchema).min(1).max(5),
  detectedIntent: z.string().max(80),
  turns: z.array(z.any()).min(1).max(60),
  isSampleData: z.boolean().optional(),
  metrics: z.object({
    averageLatencyMs: z.number().min(0).max(120000),
    p95LatencyMs: z.number().min(0).max(120000),
    bargeInCount: z.number().min(0).max(500),
    toolsExecutedCount: z.number().min(0).max(100),
    taskCompleted: z.boolean(),
    handedOffToHuman: z.boolean(),
    satisfactionScore: z.number().min(1).max(5),
  }),
  capturedMemory: z.record(z.string().max(64), z.string().max(240)).optional().default({}),
});

export const AuthBootstrapSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  bootstrapToken: z.string().trim().max(256).optional(),
});

export const AuthLoginSchema = z.object({
  email: z.string().trim().email().max(160).optional(),
  password: z.string().min(1).max(128),
});

export const TenantAdminCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(128),
  role: z.enum(['tenant_admin', 'super_admin']).default('tenant_admin'),
  allowedTenants: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
});

export const HandoffUpdateSchema = z.object({
  status: z.enum(['queued', 'acknowledged', 'resolved']),
  notes: z.string().trim().max(500).optional(),
});

export const AppointmentUpdateSchema = z.object({
  status: z.enum(['confirmed', 'cancelled']),
});

export const FirebaseAuthExchangeSchema = z.object({
  idToken: z.string().trim().min(20).max(8192),
});

export const UserRoleUpdateSchema = z.object({
  role: z.enum(['caller', 'tenant_admin', 'super_admin']),
  allowedTenants: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});

export const UserRevokeUpdateSchema = z.object({
  revoked: z.boolean(),
});
