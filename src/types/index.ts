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
  vadMs: number;
  sttMs: number;
  ragMs: number;
  llmFirstTokenMs: number;
  ttsFirstAudioMs: number;
  totalTurnaroundMs: number;
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
  // Real execution metrics
  measuredLatencyMs?: number;
  measuredIntent?: string;
  toolCallCorrect?: boolean;
  intentCorrect?: boolean;
  passed?: boolean;
  actualReply?: string;
  executionStatus?: 'idle' | 'running' | 'completed' | 'error';
}

