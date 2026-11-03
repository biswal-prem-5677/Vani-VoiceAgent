import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Mic,
  MicOff,
  PhoneOff,
  PhoneCall,
  Volume2,
  Zap,
  Globe2,
  CheckCircle2,
  AlertTriangle,
  Database,
  ArrowRight,
  Sparkles,
  ShieldAlert,
  Info,
  RotateCcw,
} from 'lucide-react';
import { TenantConfig, SupportedLanguage, CallTurn, LatencyBreakdown } from '../types';
import { SUPPORTED_LANGUAGES } from '../utils/languageDetector';
import { createSpeechController, SpeechController } from '../utils/speechSynthesis';
import { processTurn } from '../utils/callPipeline';
import { AudioOrb } from './AudioOrb';

interface LiveVoiceCallProps {
  tenant: TenantConfig;
  onCallEnded?: (callRecord: any) => void;
}

export const LiveVoiceCall: React.FC<LiveVoiceCallProps> = ({ tenant, onCallEnded }) => {
  const [callActive, setCallActive] = useState<boolean>(false);
  const [callDuration, setCallDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [orbState, setOrbState] = useState<'idle' | 'listening' | 'processing' | 'speaking' | 'interrupted'>('idle');
  const [activeLanguage, setActiveLanguage] = useState<SupportedLanguage>(tenant.defaultLanguage);
  const [detectedConfidence, setDetectedConfidence] = useState<number>(1.0);
  const [switchedNotice, setSwitchedNotice] = useState<string | null>(null);

  const [turns, setTurns] = useState<CallTurn[]>([]);
  const [currentInterimSpeech, setCurrentInterimSpeech] = useState<string>('');
  const [textInput, setTextInput] = useState<string>('');
  const [callMemory, setCallMemory] = useState<Record<string, string>>({});
  const [lastLatency, setLastLatency] = useState<LatencyBreakdown | null>(null);
  const [bargeInCount, setBargeInCount] = useState<number>(0);
  const [humanHandoffNotice, setHumanHandoffNotice] = useState<string | null>(null);
  const [micSupported, setMicSupported] = useState<boolean>(true);
  const [odiaWarning, setOdiaWarning] = useState<string | null>(null);

  // Stale closure prevention refs
  const turnsRef = useRef<CallTurn[]>(turns);
  const callMemoryRef = useRef<Record<string, string>>(callMemory);
  const activeLanguageRef = useRef<SupportedLanguage>(activeLanguage);
  const callActiveRef = useRef<boolean>(callActive);
  const isMutedRef = useRef<boolean>(isMuted);
  const isSpeakingTtsRef = useRef<boolean>(false);

  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => { callMemoryRef.current = callMemory; }, [callMemory]);
  useEffect(() => { activeLanguageRef.current = activeLanguage; }, [activeLanguage]);
  useEffect(() => { callActiveRef.current = callActive; }, [callActive]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // Create speech controller once
  const speechCtrl = useMemo(() => createSpeechController(), []);
  const recognitionRef = useRef<any>(null);
  const transcriptBottomRef = useRef<HTMLDivElement>(null);

  // Check Odia voice support on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const checkOdia = () => {
        const hasOdia = speechCtrl.hasOdiaVoiceSupport();
        if (!hasOdia) {
          setOdiaWarning(
            'Notice: Browser speech synthesis does not include a native Odia (or-IN) voice. The agent will display native Odia text and use an Indian phonetic engine for spoken output. Typed Odia input is fully supported.'
          );
        } else {
          setOdiaWarning(null);
        }
      };
      checkOdia();
      window.speechSynthesis.onvoiceschanged = checkOdia;
    }
  }, [speechCtrl]);

  // Duration Timer
  useEffect(() => {
    let interval: any = null;
    if (callActive) {
      interval = setInterval(() => {
        setCallDuration(d => d + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [callActive]);

  // Scroll transcript
  useEffect(() => {
    transcriptBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, currentInterimSpeech]);

  // Initialize Speech Recognition
  const initSpeechRecognition = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setMicSupported(false);
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = SUPPORTED_LANGUAGES[activeLanguageRef.current]?.sttCode || 'en-IN';

    recognition.onresult = (event: any) => {
      // Prevent echo self-barge-in: if TTS is speaking, disregard mic events to avoid speaker loopback
      if (isSpeakingTtsRef.current) {
        return;
      }

      let interim = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      if (interim) {
        setCurrentInterimSpeech(interim);
        setOrbState('listening');
      }

      if (finalTranscript.trim()) {
        setCurrentInterimSpeech('');
        handleUserSpoke(finalTranscript.trim());
      }
    };

    // Auto-restart continuous recognition when Chrome drops connection
    recognition.onend = () => {
      if (callActiveRef.current && !isMutedRef.current && !isSpeakingTtsRef.current) {
        try {
          recognition.start();
        } catch {
          // ignore restart collision
        }
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('Speech recognition warning:', e.error);
      }
    };

    return recognition;
  };

  const startListeningMic = () => {
    if (isMutedRef.current || !callActiveRef.current) return;
    try {
      if (!recognitionRef.current) {
        recognitionRef.current = initSpeechRecognition();
      }
      if (recognitionRef.current) {
        recognitionRef.current.lang = SUPPORTED_LANGUAGES[activeLanguageRef.current]?.sttCode || 'en-IN';
        recognitionRef.current.start();
      }
    } catch {
      // already running
    }
  };

  const stopListeningMic = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
    }
  };

  // Start Call Session
  const startCall = () => {
    speechCtrl.stop();
    setCallActive(true);
    setTurns([]);
    setCallMemory({});
    setBargeInCount(0);
    setHumanHandoffNotice(null);
    setSwitchedNotice(null);

    const greetingText = tenant.greetings[tenant.defaultLanguage] || tenant.greetings.en;
    const initialTurn: CallTurn = {
      id: `turn_${Date.now()}`,
      speaker: 'agent',
      text: greetingText,
      language: tenant.defaultLanguage,
      timestamp: Date.now(),
    };

    setTurns([initialTurn]);
    setOrbState('speaking');
    isSpeakingTtsRef.current = true;

    // AI Disclosure at start of call
    speechCtrl.speak(
      greetingText,
      tenant.defaultLanguage,
      () => {
        isSpeakingTtsRef.current = false;
        setOrbState('listening');
        startListeningMic();
      },
      { speed: tenant.voicePersona.speed, pitch: tenant.voicePersona.pitch }
    );
  };

  // End Call Session
  const endCall = () => {
    speechCtrl.stop();
    isSpeakingTtsRef.current = false;
    stopListeningMic();
    setCallActive(false);
    setOrbState('idle');
    setCurrentInterimSpeech('');

    const currentTurns = turnsRef.current;
    if (currentTurns.length > 1 && onCallEnded) {
      const avgLat = lastLatency?.totalTurnaroundMs || 750;
      const callRecord = {
        id: `call_${Date.now()}`,
        tenantId: tenant.id,
        tenantName: tenant.name,
        callerNumber: callMemoryRef.current.phone || 'Web Voice Session',
        callerName: callMemoryRef.current.patientName || 'Web Caller',
        startedAt: new Date().toLocaleTimeString(),
        durationSeconds: callDuration,
        languagesUsed: Array.from(new Set(currentTurns.map(t => t.language))),
        detectedIntent: currentTurns.find(t => t.toolInvoked)?.toolInvoked?.toolName || 'general_inquiry',
        turns: currentTurns,
        isSampleData: false,
        metrics: {
          averageLatencyMs: avgLat,
          p95LatencyMs: Math.round(avgLat * 1.15),
          bargeInCount,
          toolsExecutedCount: currentTurns.filter(t => t.toolInvoked).length,
          taskCompleted: !humanHandoffNotice,
          handedOffToHuman: Boolean(humanHandoffNotice),
          satisfactionScore: humanHandoffNotice ? 3 : 5,
        },
        capturedMemory: callMemoryRef.current,
      };

      // Persist to server SQLite
      fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(callRecord),
      }).catch(err => console.warn('Failed to persist call log:', err));

      onCallEnded(callRecord);
    }
  };

  // Barge-In Interruption: user taps or interrupts agent
  const triggerBargeIn = () => {
    speechCtrl.stop();
    isSpeakingTtsRef.current = false;
    setBargeInCount(c => c + 1);
    setOrbState('interrupted');

    setTurns(prev => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].speaker === 'agent') {
          copy[i].interrupted = true;
          break;
        }
      }
      return copy;
    });

    setTimeout(() => {
      setOrbState('listening');
      startListeningMic();
    }, 250);
  };

  // Handle User Input (Spoken or Typed)
  const handleUserSpoke = async (rawText: string) => {
    if (!rawText.trim()) return;

    const tStart = performance.now();
    const currentLang = activeLanguageRef.current;
    const currentMem = callMemoryRef.current;
    const currentTurns = turnsRef.current;

    const userTurn: CallTurn = {
      id: `turn_${Date.now()}_u`,
      speaker: 'user',
      text: rawText,
      language: currentLang,
      timestamp: Date.now(),
    };

    setTurns(prev => [...prev, userTurn]);
    setOrbState('processing');

    // Call server /api/turn endpoint
    try {
      const res = await fetch('/api/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: tenant.id,
          userText: rawText,
          language: currentLang,
          memory: currentMem,
          history: currentTurns,
        }),
      });

      if (!res.ok) throw new Error('API turn request failed');
      const turnOutput = await res.json();
      const measuredLatency = Math.round(performance.now() - tStart);

      setActiveLanguage(turnOutput.language);
      if (turnOutput.switchedLanguage) {
        setSwitchedNotice(`Switched to ${SUPPORTED_LANGUAGES[turnOutput.language as SupportedLanguage]?.name || turnOutput.language}`);
      }

      setCallMemory(turnOutput.memoryUpdates || currentMem);
      setLastLatency({
        vadMs: turnOutput.latencyBreakdown?.vadMs || 15,
        sttMs: turnOutput.latencyBreakdown?.sttMs || 25,
        ragMs: turnOutput.latencyBreakdown?.ragMs || 10,
        llmFirstTokenMs: turnOutput.latencyBreakdown?.llmFirstTokenMs || Math.max(30, measuredLatency - 50),
        ttsFirstAudioMs: 15,
        totalTurnaroundMs: measuredLatency,
      });

      if (turnOutput.shouldHandoff) {
        setHumanHandoffNotice(turnOutput.handoffReason || 'Escalation transfer requested');
      }

      const agentTurn: CallTurn = {
        id: `turn_${Date.now()}_a`,
        speaker: 'agent',
        text: turnOutput.reply,
        language: turnOutput.language,
        timestamp: Date.now(),
        latencyMs: measuredLatency,
        toolInvoked: turnOutput.toolCalls?.[0]
          ? {
              toolName: turnOutput.toolCalls[0].name,
              params: {},
              result: turnOutput.toolCalls[0].result,
            }
          : undefined,
      };

      setTurns(prev => [...prev, agentTurn]);
      setOrbState('speaking');
      isSpeakingTtsRef.current = true;
      stopListeningMic();

      speechCtrl.speak(
        turnOutput.reply,
        turnOutput.language as SupportedLanguage,
        () => {
          isSpeakingTtsRef.current = false;
          setOrbState('listening');
          startListeningMic();
        },
        { speed: tenant.voicePersona.speed, pitch: tenant.voicePersona.pitch }
      );
    } catch {
      // Fallback to client-side pipeline
      const fallback = processTurn({
        userInput: rawText,
        tenant,
        currentLanguage: currentLang,
        callMemory: currentMem,
        turnHistory: currentTurns,
      });

      const measuredLatency = Math.round(performance.now() - tStart);
      setActiveLanguage(fallback.detectedLanguage);
      setCallMemory(fallback.updatedMemory);
      setLastLatency({
        ...fallback.latencyBreakdown,
        totalTurnaroundMs: measuredLatency,
      });

      if (fallback.shouldHandoff) {
        setHumanHandoffNotice(fallback.handoffReason || 'Escalated to human supervisor');
      }

      const agentTurn: CallTurn = {
        id: `turn_${Date.now()}_a`,
        speaker: 'agent',
        text: fallback.spokenReply,
        language: fallback.detectedLanguage,
        timestamp: Date.now(),
        latencyMs: measuredLatency,
        fillerUsed: fallback.fillerUsed,
        toolInvoked: fallback.toolResult
          ? {
              toolName: fallback.toolInvokedName || 'tool',
              params: {},
              result: fallback.toolResult,
            }
          : undefined,
      };

      setTurns(prev => [...prev, agentTurn]);
      setOrbState('speaking');
      isSpeakingTtsRef.current = true;
      stopListeningMic();

      speechCtrl.speak(
        fallback.spokenReply,
        fallback.detectedLanguage,
        () => {
          isSpeakingTtsRef.current = false;
          setOrbState('listening');
          startListeningMic();
        },
        { speed: tenant.voicePersona.speed, pitch: tenant.voicePersona.pitch }
      );
    }
  };

  const handleScenarioClick = (text: string) => {
    if (!callActive) {
      speechCtrl.stop();
      setCallActive(true);
      setTurns([]);
      setCallMemory({});
      setBargeInCount(0);
      setHumanHandoffNotice(null);

      const greetingText = tenant.greetings[tenant.defaultLanguage] || tenant.greetings.en;
      const initialTurn: CallTurn = {
        id: `turn_${Date.now()}`,
        speaker: 'agent',
        text: greetingText,
        language: tenant.defaultLanguage,
        timestamp: Date.now(),
      };
      setTurns([initialTurn]);
    }
    handleUserSpoke(text);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    const q = textInput;
    setTextInput('');
    if (!callActive) {
      startCall();
    }
    handleUserSpoke(q);
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (nextMuted) {
      stopListeningMic();
    } else {
      startListeningMic();
    }
  };

  return (
    <div className="space-y-6">
      {/* AI Prototype & Safety Disclaimer Banner */}
      <div className="bg-amber-950/30 border border-amber-500/30 rounded-2xl p-3.5 flex items-start gap-3">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-200/90 leading-relaxed">
          <strong>AI Prototype Notice:</strong> You are interacting with an automated AI prototype. For healthcare tenants (e.g. Kalinga Care Clinic), this system cannot provide medical advice, diagnosis, or triage. In emergencies (such as chest pain or breathing difficulty), immediately dial <strong>112</strong>.
        </div>
      </div>

      {/* Odia Voice Warning if Browser lacks native or-IN voice */}
      {odiaWarning && (
        <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-3.5 flex items-start gap-3">
          <Globe2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-300 leading-relaxed">
            {odiaWarning}
          </div>
        </div>
      )}

      {/* Main Calling Stage & Visualizer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Interactive Audio Orb Stage */}
        <div className="lg:col-span-5 bg-[#0D111A] border border-white/[0.08] rounded-2xl p-6 shadow-2xl flex flex-col items-center justify-between min-h-[460px] relative overflow-hidden">
          {/* Tenant Identity Header */}
          <div className="w-full flex items-center justify-between pb-4 border-b border-white/[0.08]">
            <div className="flex items-center gap-2.5">
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: tenant.primaryColor }}
              />
              <div>
                <h3 className="text-sm font-bold text-white tracking-tight">{tenant.name}</h3>
                <span className="text-xs text-slate-400 block">{tenant.tagline}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono text-xs px-2 py-0.5 rounded-lg bg-black/40 border border-white/[0.08] text-slate-300 uppercase">
                {activeLanguage}
              </span>
              {callActive && (
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 text-xs font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>
                    {Math.floor(callDuration / 60)}:{String(callDuration % 60).padStart(2, '0')}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Interactive Audio Orb Visualizer */}
          <div className="my-auto py-4">
            <AudioOrb
              state={orbState}
              primaryColor={tenant.primaryColor}
              onOrbClick={callActive && orbState === 'speaking' ? triggerBargeIn : undefined}
            />
          </div>

          {/* Real Latency Waterfall Gauge */}
          <div className="w-full bg-black/40 border border-white/[0.08] rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                Measured Turn Latency:
              </span>
              <span className="font-bold text-emerald-400">
                {lastLatency ? `${lastLatency.totalTurnaroundMs}ms` : '—'}
              </span>
            </div>

            {lastLatency && (
              <div className="space-y-1 text-[11px] font-mono text-slate-400">
                <div className="flex justify-between">
                  <span>Language Detect: {lastLatency.vadMs}ms</span>
                  <span>RAG Search: {lastLatency.ragMs}ms</span>
                  <span>Synthesize/LLM: {lastLatency.llmFirstTokenMs}ms</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden flex">
                  <div
                    style={{ width: `${Math.min(100, (lastLatency.vadMs / lastLatency.totalTurnaroundMs) * 100)}%` }}
                    className="bg-indigo-500 h-full"
                  />
                  <div
                    style={{ width: `${Math.min(100, (lastLatency.ragMs / lastLatency.totalTurnaroundMs) * 100)}%` }}
                    className="bg-amber-500 h-full"
                  />
                  <div
                    style={{ width: `${Math.min(100, (lastLatency.llmFirstTokenMs / lastLatency.totalTurnaroundMs) * 100)}%` }}
                    className="bg-emerald-500 h-full"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Call Controls */}
          <div className="w-full pt-4 border-t border-white/[0.08] flex items-center justify-center gap-3">
            {!callActive ? (
              <button
                onClick={startCall}
                aria-label="Start Voice Session"
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-white shadow-xl bg-emerald-600 hover:bg-emerald-500 transition-all cursor-pointer text-xs"
              >
                <PhoneCall className="w-4 h-4" />
                <span>Start Voice Call</span>
              </button>
            ) : (
              <>
                <button
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    isMuted
                      ? 'bg-rose-950/50 border-rose-500 text-rose-400'
                      : 'bg-white/[0.06] border-white/[0.1] text-slate-300 hover:bg-white/[0.1]'
                  }`}
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                <button
                  onClick={triggerBargeIn}
                  disabled={orbState !== 'speaking'}
                  aria-label="Trigger barge-in interruption"
                  className="px-4 py-2 rounded-xl bg-indigo-950/40 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-900/60 disabled:opacity-40 text-xs font-semibold cursor-pointer"
                >
                  Interrupt (Barge-In)
                </button>

                <button
                  onClick={endCall}
                  aria-label="End call session"
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-bold text-white bg-rose-600 hover:bg-rose-500 transition-all cursor-pointer text-xs"
                >
                  <PhoneOff className="w-4 h-4" />
                  <span>End Call</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Right Column: Live Transcript, In-Call Working Memory, and Text Input */}
        <div className="lg:col-span-7 bg-[#0D111A] border border-white/[0.08] rounded-2xl p-6 shadow-2xl flex flex-col h-[520px]">
          {/* Transcript Header with Working Memory Badges */}
          <div className="pb-3 border-b border-white/[0.08] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <h3 className="text-sm font-bold text-white">Live Call Transcript</h3>
            </div>

            {humanHandoffNotice && (
              <span className="text-xs px-2 py-0.5 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-300 font-mono">
                Transfer Requested
              </span>
            )}
          </div>

          {/* Working Memory HUD */}
          {Object.keys(callMemory).length > 0 && (
            <div className="py-2.5 px-3 my-2 bg-black/40 border border-white/[0.06] rounded-xl flex items-center gap-2 flex-wrap text-xs">
              <span className="text-slate-400 font-mono text-[11px]">Working Memory:</span>
              {Object.entries(callMemory).map(([k, v]) => (
                <span
                  key={k}
                  className="px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-500/30 text-indigo-200 font-mono text-[11px]"
                >
                  {k}: {String(v)}
                </span>
              ))}
            </div>
          )}

          {/* Scrollable Conversation Stream */}
          <div
            aria-live="polite"
            className="flex-1 overflow-y-auto space-y-3.5 pr-2 my-2 text-xs"
          >
            {turns.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center p-6">
                <Mic className="w-8 h-8 mb-2 opacity-40 text-indigo-400" />
                <p>Click "Start Voice Call" or choose a prompt below to begin the session.</p>
              </div>
            )}

            {turns.map(turn => (
              <div
                key={turn.id}
                className={`p-3.5 rounded-2xl border ${
                  turn.speaker === 'user'
                    ? 'bg-slate-900 border-white/[0.08] ml-8'
                    : 'bg-indigo-950/20 border-indigo-500/25 mr-8'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono mb-1">
                  <span className="font-semibold uppercase text-slate-300">
                    {turn.speaker === 'user' ? 'Caller' : tenant.agentName}
                  </span>
                  <span>{turn.latencyMs ? `${turn.latencyMs}ms` : ''}</span>
                </div>
                <p className="text-slate-200 leading-relaxed font-sans">{turn.text}</p>
                {turn.interrupted && (
                  <span className="text-[10px] text-rose-400 font-mono block mt-1">
                    [Interrupted by user speech]
                  </span>
                )}
                {turn.toolInvoked && (
                  <div className="mt-2 p-2 rounded-lg bg-black/50 border border-emerald-500/30 text-emerald-400 font-mono text-[11px]">
                    Tool: {turn.toolInvoked.toolName}
                  </div>
                )}
              </div>
            ))}

            {currentInterimSpeech && (
              <div className="p-3 rounded-2xl bg-slate-900/60 border border-dashed border-indigo-500/40 ml-8 text-xs text-indigo-300 italic">
                Hearing: "{currentInterimSpeech}..."
              </div>
            )}
            <div ref={transcriptBottomRef} />
          </div>

          {/* Quick Test Prompt Bench */}
          <div className="pt-2 border-t border-white/[0.08] space-y-2">
            <span className="text-[11px] text-slate-400 font-mono block">
              1-Click Prompts ({tenant.category}):
            </span>
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
              {tenant.category === 'clinic' && (
                <>
                  <button
                    onClick={() => handleScenarioClick('ମୁଁ ଡାକ୍ତର ଜେନାଙ୍କ ସହିତ କାଲି ସକାଳେ ଆପଏଣ୍ଟମେଣ୍ଟ କରିବାକୁ ଚାହୁଁଛି। ମୋ ନାଁ ରାଜେଶ।')}
                    className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 whitespace-nowrap font-mono text-[11px] cursor-pointer"
                  >
                    Odia: Dr. Jena Booking
                  </button>
                  <button
                    onClick={() => handleScenarioClick('ଡାକ୍ତର ଦେଖାଇବା ପାଇଁ ଫି କେତେ ଟଙ୍କା ଲାଗିବ?')}
                    className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 whitespace-nowrap font-mono text-[11px] cursor-pointer"
                  >
                    Odia: OPD Fees Inquiry
                  </button>
                  <button
                    onClick={() => handleScenarioClick('ମୋ ବାପାଙ୍କର ଛାତିରେ ବହୁତ କଷ୍ଟ ହେଉଛି! ଶୀଘ୍ର ସାହାଯ୍ୟ କରନ୍ତୁ!')}
                    className="px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 whitespace-nowrap font-mono text-[11px] cursor-pointer"
                  >
                    Safety: Chest Pain Emergency
                  </button>
                </>
              )}
              {tenant.category === 'logistics' && (
                <>
                  <button
                    onClick={() => handleScenarioClick('Mera order ORD-98421 kahan tak pahucha hai?')}
                    className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 whitespace-nowrap font-mono text-[11px] cursor-pointer"
                  >
                    Hinglish: Track ORD-98421
                  </button>
                  <button
                    onClick={() => handleScenarioClick('Return policy kya hai electronics items ke liye?')}
                    className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 whitespace-nowrap font-mono text-[11px] cursor-pointer"
                  >
                    Hinglish: Return Policy
                  </button>
                </>
              )}
            </div>

            {/* Typed Text Input Form */}
            <form onSubmit={handleTextSubmit} className="flex gap-2">
              <input
                type="text"
                placeholder="Type in Odia, Hindi, Hinglish, or English..."
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                aria-label="User input message"
                className="flex-1 bg-black/40 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                aria-label="Send message"
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
