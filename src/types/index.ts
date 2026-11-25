export type SupportedLanguage = 'en' | 'hi' | 'or' | 'bn' | 'hinglish';

export interface LanguageMeta {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  flag: string;
  sttCode: string;
  ttsVoiceName?: string;
  greetingExample: string;
}

export interface TenantTool {
  id: string;
  name: string;
  displayName: string;
  description: string;
  parameters: {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'date';
    description: string;
    required: boolean;
  }[];
  handlerType: 'mock_appointment' | 'mock_order' | 'mock_admission' | 'mock_ticket' | 'custom_api';
}

export interface DocumentChunk {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  addedAt: string;
}

export interface TenantConfig {
  id: string;
  name: string;
  tagline: string;
  category: 'clinic' | 'coaching' | 'logistics' | 'university' | 'custom';
  primaryColor: string;
  accentColor: string;
  logoIcon: string;
  agentName: string;
  voicePersona: {
    gender: 'female' | 'male';
    speed: number;
    pitch: number;
    tone: string;
    provider: 'Sarvam AI' | 'Google Cloud TTS' | 'Web Speech' | 'ElevenLabs';
  };
  supportedLanguages: SupportedLanguage[];
  defaultLanguage: SupportedLanguage;
  systemPrompt: string;
  greetings: Record<SupportedLanguage, string>;
  fillers: Record<SupportedLanguage, string[]>;
  knowledgeBase: DocumentChunk[];
  tools: TenantTool[];
  humanHandoffContact: {
    department: string;
    phone: string;
    email: string;
  };
  webhookConfig?: {
    enabled: boolean;
    url: string;
    providerType: 'clinic_ehr_webhook' | 'logistics_webhook' | 'generic_webhook';
    secretHeaderName: string;
    signingSecret?: string;
  };
  isPublicSummaryOnly?: boolean;
}

export interface CallTurn {
  id: string;
  speaker: 'user' | 'agent' | 'system';
  text: string;
  language: SupportedLanguage;
  timestamp: number;
  latencyMs?: number;
  fillerUsed?: string;
  toolInvoked?: {
    toolName: string;
    params: Record<string, any>;
    result: any;
  };
  interrupted?: boolean;
}

export interface LatencyBreakdown {
  ragMs: number;
  modelResponseMs: number;
  totalTurnaroundMs: number;
  mode?: 'gemini_live' | 'offline_demo' | 'safety_fastpath';
  streaming?: boolean;
  // Kept optional for backwards-compatibility with older log payloads
  vadMs?: number;
  sttMs?: number;
  llmFirstTokenMs?: number;
  ttsFirstAudioMs?: number;
}

export interface HandoffTicket {
  id: string;
  tenantId: string;
  tenantName?: string;
  sessionId: string;
  reason: string;
  priority: 'critical' | 'high' | 'normal';
  summary: string;
  department: string;
  phone: string;
  status: 'queued' | 'acknowledged' | 'resolved';
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'caller' | 'tenant_admin' | 'super_admin';
  allowedTenants: string[];
  sessionId: string;
  authProvider?: 'firebase_oidc' | 'workspace_local' | 'caller_session';
}

export interface CallLog {
  id: string;
  tenantId: string;
  tenantName: string;
  callerNumber: string;
  callerName: string;
  startedAt: string;
  durationSeconds: number;
  languagesUsed: SupportedLanguage[];
  detectedIntent: string;
  turns: CallTurn[];
  isSampleData?: boolean;
  metrics: {
    averageLatencyMs: number;
    p95LatencyMs: number;
    bargeInCount: number;
    toolsExecutedCount: number;
    taskCompleted: boolean;
    handedOffToHuman: boolean;
    satisfactionScore: number;
  };
  capturedMemory: Record<string, string>;
}

export interface BenchmarkCase {
  id: string;
  language: SupportedLanguage;
  scenario: string;
  userInput: string;
  expectedIntent: string;
  expectedTool?: string;
  groundTruthOdiaPhrase?: string;
  difficulty: 'Easy' | 'Medium' | 'Challenging (Code-switch)';
  measuredLatencyMs?: number;
  measuredIntent?: string;
  toolCallCorrect?: boolean;
  intentCorrect?: boolean;
  passed?: boolean;
  actualReply?: string;
  executionStatus?: 'idle' | 'running' | 'completed' | 'error';
}

export interface AppointmentRecord {
  id: string;
  tenantId: string;
  sessionId: string;
  doctor: string;
  slot: string;
  patientName: string;
  status: 'confirmed' | 'cancelled';
  actionId: string;
  createdAt: number;
  expiresAt: number | null;
}

export interface AuditLogEntry {
  id: string;
  traceId: string;
  actorId: string;
  actorRole: string;
  action: string;
  tenantId: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface IntegrationDelivery {
  id: string;
  tenantId: string;
  sessionId?: string | null;
  eventType: string;
  targetUrl: string;
  status: 'pending' | 'delivered' | 'failed' | 'not_configured';
  attemptCount: number;
  lastStatusCode: number | null;
  lastError: string | null;
  latencyMs: number | null;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
}

export interface OperationalMetricsSummary {
  totalSessions: number;
  containmentRatePct: number;
  handoffRatePct: number;
  bookingCompletionRatePct: number;
  confirmedAppointments: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  failedToolCallsCount: number;
  safetyEscalationsCount: number;
  webhookSuccessRatePct: number;
  deliveredCount: number;
  failedDeliveriesCount: number;
}

export interface WorkspaceUserRecord {
  id: string;
  email: string;
  name: string;
  role: 'caller' | 'tenant_admin' | 'super_admin';
  allowedTenants: string[];
  revoked: boolean;
  authProvider?: string;
  createdAt: number;
}
