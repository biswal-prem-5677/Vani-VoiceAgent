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
import {
  TenantConfig,
  SupportedLanguage,
  CallTurn,
  LatencyBreakdown,
  HandoffTicket,
} from '../types';
import { SUPPORTED_LANGUAGES } from '../utils/languageDetector';
import { calculatePercentiles } from '../utils/latencyTracker';
import { createSpeechController } from '../utils/speechSynthesis';
import {
  isBenignRecognitionError,
  isFatalRecognitionError,
  shouldRestartRecognition,
  getRecognitionRestartDelayMs,
} from '../utils/speechRecognition';
import { AudioOrb } from './AudioOrb';

interface LiveVoiceCallProps {
  tenant: TenantConfig;
  authToken: string | null;
  canPersistLogs: boolean;
  geminiConfigured: boolean;
  onCallEnded?: (callRecord: any, persisted: boolean) => void;
  onHandoffCreated?: (ticket: HandoffTicket) => void;
}

export const LiveVoiceCall: React.FC<LiveVoiceCallProps> = ({
  tenant,
  authToken,
  canPersistLogs,
  geminiConfigured,
  onCallEnded,
  onHandoffCreated,
}) => {
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
  const [micErrorNotice, setMicErrorNotice] = useState<string | null>(null);
  const [turnErrorNotice, setTurnErrorNotice] = useState<{
    message: string;
    retryText?: string;
    canEnableDemo?: boolean;
  } | null>(null);
  const [isProcessingTurn, setIsProcessingTurn] = useState<boolean>(false);
  const [offlineDemoMode, setOfflineDemoMode] = useState<boolean>(!geminiConfigured);
  const [queuedHandoffTicket, setQueuedHandoffTicket] = useState<HandoffTicket | null>(null);

  // Refs synced immediately with state to eliminate stale closures in SpeechRecognition and async handlers
  const tenantRef = useRef<TenantConfig>(tenant);
  const authTokenRef = useRef<string | null>(authToken);
  const canPersistLogsRef = useRef<boolean>(canPersistLogs);
  const demoModeRef = useRef<boolean>(offlineDemoMode);
  const onCallEndedRef = useRef<((callRecord: any, persisted: boolean) => void) | undefined>(onCallEnded);
  const onHandoffCreatedRef = useRef<((ticket: HandoffTicket) => void) | undefined>(onHandoffCreated);
  const turnsRef = useRef<CallTurn[]>(turns);
  const callMemoryRef = useRef<Record<string, string>>(callMemory);
  const activeLanguageRef = useRef<SupportedLanguage>(activeLanguage);
  const callActiveRef = useRef<boolean>(callActive);
  const isMutedRef = useRef<boolean>(isMuted);
  const callDurationRef = useRef<number>(callDuration);
  const bargeInCountRef = useRef<number>(bargeInCount);
  const humanHandoffRef = useRef<string | null>(humanHandoffNotice);
  const lastLatencyRef = useRef<LatencyBreakdown | null>(lastLatency);
  const turnLatenciesRef = useRef<number[]>([]);
  const inFlightTurnRef = useRef<boolean>(false);

  // Recognition lifecycle refs
  const isSpeakingTtsRef = useRef<boolean>(false);
  const isRecognizingRef = useRef<boolean>(false);
  const shouldListenRef = useRef<boolean>(false);
  const isUnmountedRef = useRef<boolean>(false);
  const fatalMicErrorRef = useRef<boolean>(false);
  const consecutiveErrorsRef = useRef<number>(0);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnAbortRef = useRef<AbortController | null>(null);
  const handleUserSpokeRef = useRef<(rawText: string) => Promise<void>>(async () => {});

  useEffect(() => { tenantRef.current = tenant; }, [tenant]);
  useEffect(() => { authTokenRef.current = authToken; }, [authToken]);
  useEffect(() => { canPersistLogsRef.current = canPersistLogs; }, [canPersistLogs]);
  useEffect(() => { demoModeRef.current = offlineDemoMode; }, [offlineDemoMode]);
  useEffect(() => { setOfflineDemoMode(!geminiConfigured); }, [geminiConfigured]);
  useEffect(() => { onCallEndedRef.current = onCallEnded; }, [onCallEnded]);
  useEffect(() => { onHandoffCreatedRef.current = onHandoffCreated; }, [onHandoffCreated]);
  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => { callMemoryRef.current = callMemory; }, [callMemory]);
  useEffect(() => { activeLanguageRef.current = activeLanguage; }, [activeLanguage]);
  useEffect(() => { callActiveRef.current = callActive; }, [callActive]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { bargeInCountRef.current = bargeInCount; }, [bargeInCount]);
  useEffect(() => { humanHandoffRef.current = humanHandoffNotice; }, [humanHandoffNotice]);
  useEffect(() => { lastLatencyRef.current = lastLatency; }, [lastLatency]);

  // Synchronous ref+state updaters prevent races between consecutive events in the same tick
  const updateCallActive = (active: boolean) => {
    callActiveRef.current = active;
    setCallActive(active);
  };

  const updateIsMuted = (muted: boolean) => {
    isMutedRef.current = muted;
    setIsMuted(muted);
  };

  const updateActiveLanguage = (lang: SupportedLanguage) => {
    activeLanguageRef.current = lang;
    setActiveLanguage(lang);
  };

  const updateCallMemory = (mem: Record<string, string>) => {
    callMemoryRef.current = mem;
    setCallMemory(mem);
  };

  const updateTurns = (nextOrUpdater: CallTurn[] | ((prev: CallTurn[]) => CallTurn[])) => {
    const next =
      typeof nextOrUpdater === 'function' ? nextOrUpdater(turnsRef.current) : nextOrUpdater;
    turnsRef.current = next;
    setTurns(next);
  };

  const updateHumanHandoff = (reason: string | null) => {
    humanHandoffRef.current = reason;
    setHumanHandoffNotice(reason);
  };

  const updateLastLatency = (latency: LatencyBreakdown | null) => {
    lastLatencyRef.current = latency;
    setLastLatency(latency);
  };

  // Create speech controller once
  const speechCtrl = useMemo(() => createSpeechController(), []);
  const recognitionRef = useRef<any>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

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
      return () => {
        if (window.speechSynthesis.onvoiceschanged === checkOdia) {
          window.speechSynthesis.onvoiceschanged = null;
        }
      };
    }
  }, [speechCtrl]);

  // Duration Timer
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (callActive) {
      interval = setInterval(() => {
        callDurationRef.current += 1;
        setCallDuration(callDurationRef.current);
      }, 1000);
    } else {
      callDurationRef.current = 0;
      setCallDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [callActive]);

  // Scroll transcript container locally without shifting the page viewport
  useEffect(() => {
    if (turns.length === 0 && !currentInterimSpeech) return;
    const el = transcriptContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [turns, currentInterimSpeech]);

  const clearRestartTimer = () => {
    if (restartTimerRef.current !== null) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const canRestartRecognition = () =>
    shouldRestartRecognition({
      callActive: callActiveRef.current,
      isMuted: isMutedRef.current,
      isSpeakingTts: isSpeakingTtsRef.current,
      isUnmounted: isUnmountedRef.current,
      fatalError: fatalMicErrorRef.current,
      consecutiveErrors: consecutiveErrorsRef.current,
    });

  const scheduleRecognitionRestart = (overrideDelayMs?: number) => {
    clearRestartTimer();
    if (!shouldListenRef.current || !canRestartRecognition()) {
      return;
    }

    const delayMs =
      overrideDelayMs ?? getRecognitionRestartDelayMs(consecutiveErrorsRef.current);

    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      if (
        shouldListenRef.current &&
        canRestartRecognition() &&
        !isRecognizingRef.current
      ) {
        startListeningMic();
      }
    }, delayMs);
  };

  // Initialize Speech Recognition once; all handlers read from refs to avoid stale closures
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

    recognition.onstart = () => {
      isRecognizingRef.current = true;
      consecutiveErrorsRef.current = 0;
      setMicErrorNotice(null);
    };

    recognition.onresult = (event: any) => {
      // Prevent echo self-barge-in or late events after mute/end/unmount
      if (
        isSpeakingTtsRef.current ||
        isMutedRef.current ||
        !callActiveRef.current ||
        isUnmountedRef.current
      ) {
        return;
      }

      consecutiveErrorsRef.current = 0;
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
        // Always invoke the latest handler via ref (no stale closures)
        handleUserSpokeRef.current(finalTranscript.trim());
      }
    };

    recognition.onerror = (e: any) => {
      const errorCode = e?.error || 'unknown';
      if (isBenignRecognitionError(errorCode)) {
        return;
      }

      if (isFatalRecognitionError(errorCode)) {
        fatalMicErrorRef.current = true;
        shouldListenRef.current = false;
        clearRestartTimer();
        setMicErrorNotice(
          'Microphone permission was denied or blocked by the browser. You can continue by typing messages below.'
        );
        return;
      }

      consecutiveErrorsRef.current += 1;
      if (errorCode === 'language-not-supported' && recognitionRef.current) {
        recognitionRef.current.lang = 'en-IN';
      }

      if (consecutiveErrorsRef.current >= 5) {
        shouldListenRef.current = false;
        setMicErrorNotice(
          'Voice recognition paused after repeated microphone/network errors. Click unmute or restart the call to retry.'
        );
      } else {
        console.warn('Speech recognition warning:', errorCode);
      }
    };

    // Automatic backoff-controlled restart when recognition ends unexpectedly
    recognition.onend = () => {
      isRecognizingRef.current = false;
      if (shouldListenRef.current && canRestartRecognition()) {
        scheduleRecognitionRestart();
      }
    };

    return recognition;
  };

  const startListeningMic = () => {
    shouldListenRef.current = true;
    clearRestartTimer();

    if (
      isMutedRef.current ||
      !callActiveRef.current ||
      isSpeakingTtsRef.current ||
      isUnmountedRef.current ||
      fatalMicErrorRef.current
    ) {
      return;
    }

    if (isRecognizingRef.current) {
      return;
    }

    try {
      if (!recognitionRef.current) {
        recognitionRef.current = initSpeechRecognition();
      }
      if (recognitionRef.current) {
        recognitionRef.current.lang =
          SUPPORTED_LANGUAGES[activeLanguageRef.current]?.sttCode || 'en-IN';
        recognitionRef.current.start();
      }
    } catch {
      // Recognition may still be tearing down from a recent abort(); retry cleanly
      scheduleRecognitionRestart(200);
    }
  };

  const stopListeningMic = () => {
    shouldListenRef.current = false;
    clearRestartTimer();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore abort errors if not started
      }
      isRecognizingRef.current = false;
    }
  };

  // Cleanup recognition, timers, and TTS on unmount
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      shouldListenRef.current = false;
      isSpeakingTtsRef.current = false;
      clearRestartTimer();
      turnAbortRef.current?.abort();
      speechCtrl.stop();

      const rec = recognitionRef.current;
      if (rec) {
        rec.onstart = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try {
          rec.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
      isRecognizingRef.current = false;
    };
  }, [speechCtrl]);

  const initCallSessionState = () => {
    const activeTenant = tenantRef.current;
    turnAbortRef.current?.abort();
    speechCtrl.stop();
    fatalMicErrorRef.current = false;
    consecutiveErrorsRef.current = 0;
    setMicErrorNotice(null);
    setTurnErrorNotice(null);
    setIsProcessingTurn(false);
    inFlightTurnRef.current = false;
    turnLatenciesRef.current = [];
    setQueuedHandoffTicket(null);

    updateCallActive(true);
    updateActiveLanguage(activeTenant.defaultLanguage);
    updateCallMemory({});
    bargeInCountRef.current = 0;
    setBargeInCount(0);
    updateHumanHandoff(null);
    updateLastLatency(null);
    setSwitchedNotice(null);
    callDurationRef.current = 0;
    setCallDuration(0);

    const greetingText =
      activeTenant.greetings[activeTenant.defaultLanguage] || activeTenant.greetings.en;
    const initialTurn: CallTurn = {
      id: `turn_${Date.now()}`,
      speaker: 'agent',
      text: greetingText,
      language: activeTenant.defaultLanguage,
      timestamp: Date.now(),
    };

    updateTurns([initialTurn]);
    return { activeTenant, greetingText };
  };

  // Start Call Session
  const startCall = () => {
    const { activeTenant, greetingText } = initCallSessionState();
    setOrbState('speaking');
    isSpeakingTtsRef.current = true;
    stopListeningMic();

    // AI Disclosure at start of call
    speechCtrl.speak(
      greetingText,
      activeTenant.defaultLanguage,
      () => {
        if (isUnmountedRef.current || !callActiveRef.current) return;
        isSpeakingTtsRef.current = false;
        setOrbState('listening');
        startListeningMic();
      },
      { speed: activeTenant.voicePersona.speed, pitch: activeTenant.voicePersona.pitch }
    );
  };

  // End Call Session
  const endCall = () => {
    turnAbortRef.current?.abort();
    speechCtrl.stop();
    isSpeakingTtsRef.current = false;
    inFlightTurnRef.current = false;
    setIsProcessingTurn(false);
    stopListeningMic();
    updateCallActive(false);
    setOrbState('idle');
    setCurrentInterimSpeech('');

    const currentTurns = turnsRef.current;
    const activeTenant = tenantRef.current;
    const endCallback = onCallEndedRef.current;

    if (currentTurns.length > 1 && endCallback) {
      const latencyStats = calculatePercentiles(turnLatenciesRef.current);
      const handoffReason = humanHandoffRef.current;
      const capturedMemory = { ...callMemoryRef.current };

      const callRecord = {
        id: `call_${Date.now()}`,
        tenantId: activeTenant.id,
        tenantName: activeTenant.name,
        callerNumber: 'Web Voice Session',
        callerName: capturedMemory.patientName || 'Web Caller',
        startedAt: new Date().toLocaleTimeString(),
        durationSeconds: callDurationRef.current,
        languagesUsed: Array.from(new Set(currentTurns.map(t => t.language))),
        detectedIntent: currentTurns.find(t => t.toolInvoked)?.toolInvoked?.toolName || 'general_inquiry',
        turns: currentTurns,
        isSampleData: false,
        metrics: {
          averageLatencyMs: latencyStats.average,
          p95LatencyMs: latencyStats.p95,
          bargeInCount: bargeInCountRef.current,
          toolsExecutedCount: currentTurns.filter(t => t.toolInvoked).length,
          taskCompleted: !handoffReason,
          handedOffToHuman: Boolean(handoffReason),
          satisfactionScore: handoffReason ? 3 : 5,
        },
        capturedMemory,
      };

      if (canPersistLogsRef.current && authTokenRef.current) {
        fetch('/api/logs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authTokenRef.current}`,
          },
          body: JSON.stringify(callRecord),
        })
          .then(res => res.json().catch(() => ({ persisted: false })))
          .then(result => endCallback(callRecord, Boolean(result?.persisted)))
          .catch(() => endCallback(callRecord, false));
      } else {
        // Consent declined or zero-retention selected: keep strictly ephemeral
        endCallback(callRecord, false);
      }
    }
  };

  // Barge-In Interruption: user taps or interrupts agent
  const triggerBargeIn = () => {
    speechCtrl.stop();
    isSpeakingTtsRef.current = false;
    bargeInCountRef.current += 1;
    setBargeInCount(bargeInCountRef.current);
    setOrbState('interrupted');

    updateTurns(prev => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].speaker === 'agent') {
          copy[i] = { ...copy[i], interrupted: true };
          break;
        }
      }
      return copy;
    });

    setTimeout(() => {
      if (isUnmountedRef.current || !callActiveRef.current) return;
      setOrbState('listening');
      startListeningMic();
    }, 250);
  };

  // Handle User Input (Spoken or Typed) with strict in-flight lock
  const handleUserSpoke = async (rawText: string) => {
    if (!rawText.trim() || isUnmountedRef.current || inFlightTurnRef.current) return;

    inFlightTurnRef.current = true;
    const tStart = performance.now();
    const activeTenant = tenantRef.current;
    const currentLang = activeLanguageRef.current;
    const currentMem = callMemoryRef.current;
    const currentTurns = turnsRef.current;
    const idempotencyKey = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const userTurn: CallTurn = {
      id: `turn_${Date.now()}_u`,
      speaker: 'user',
      text: rawText,
      language: currentLang,
      timestamp: Date.now(),
    };

    const nextTurnsAfterUser = [...currentTurns, userTurn];
    updateTurns(nextTurnsAfterUser);
    setIsProcessingTurn(true);
    setOrbState('processing');
    setTurnErrorNotice(null);

    const controller = new AbortController();
    turnAbortRef.current = controller;

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authTokenRef.current) {
        headers.Authorization = `Bearer ${authTokenRef.current}`;
      }

      const res = await fetch('/api/turn', {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          tenantId: activeTenant.id,
          userText: rawText,
          language: currentLang,
          memory: currentMem,
          history: nextTurnsAfterUser.slice(-20),
          idempotencyKey,
          demoMode: demoModeRef.current,
        }),
      });

      const payload = await res.json().catch(() => null);
      if (controller.signal.aborted || isUnmountedRef.current) return;

      if (!res.ok || !payload || typeof payload.reply !== 'string') {
        const errMessage =
          payload?.error || `Server returned error status (${res.status}). Please retry.`;
        const err: any = new Error(errMessage);
        err.canEnableDemo = Boolean(payload?.offlineDemoAvailable || payload?.code === 'GEMINI_NOT_CONFIGURED');
        throw err;
      }

      const measuredLatency = Math.round(performance.now() - tStart);
      turnLatenciesRef.current.push(measuredLatency);
      const nextLang = (payload.language || currentLang) as SupportedLanguage;

      updateActiveLanguage(nextLang);
      if (payload.switchedLanguage) {
        setSwitchedNotice(
          `Switched to ${SUPPORTED_LANGUAGES[nextLang]?.name || nextLang}`
        );
      }

      updateCallMemory(payload.memoryUpdates || currentMem);
      updateLastLatency({
        ragMs: Number(payload.latencyBreakdown?.ragMs ?? 0),
        modelResponseMs: Number(payload.latencyBreakdown?.modelResponseMs ?? measuredLatency),
        totalTurnaroundMs: measuredLatency,
        mode: payload.latencyBreakdown?.mode || 'gemini_live',
        streaming: false,
      });

      if (payload.shouldHandoff) {
        updateHumanHandoff(payload.handoffReason || 'Callback ticket queued');
      }
      if (payload.handoffTicket) {
        setQueuedHandoffTicket(payload.handoffTicket);
        onHandoffCreatedRef.current?.(payload.handoffTicket);
      }

      const agentTurn: CallTurn = {
        id: `turn_${Date.now()}_a`,
        speaker: 'agent',
        text: payload.reply,
        language: nextLang,
        timestamp: Date.now(),
        latencyMs: measuredLatency,
        toolInvoked: payload.toolCalls?.[0]
          ? {
              toolName: payload.toolCalls[0].name,
              params: {},
              result: payload.toolCalls[0].result,
            }
          : undefined,
      };

      updateTurns(prev => [...prev, agentTurn]);
      setOrbState('speaking');
      isSpeakingTtsRef.current = true;
      stopListeningMic();

      speechCtrl.speak(
        payload.reply,
        nextLang,
        () => {
          if (isUnmountedRef.current || !callActiveRef.current) return;
          isSpeakingTtsRef.current = false;
          setOrbState('listening');
          startListeningMic();
        },
        { speed: activeTenant.voicePersona.speed, pitch: activeTenant.voicePersona.pitch }
      );
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === 'AbortError' || isUnmountedRef.current) return;

      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to reach the AI response server. Please check your connection and retry.';
      setTurnErrorNotice({
        message,
        retryText: rawText,
        canEnableDemo: Boolean(err?.canEnableDemo),
      });

      isSpeakingTtsRef.current = false;
      if (callActiveRef.current) {
        setOrbState('listening');
        if (!isMutedRef.current) {
          startListeningMic();
        }
      } else {
        setOrbState('idle');
      }
    } finally {
      inFlightTurnRef.current = false;
      setIsProcessingTurn(false);
    }
  };

  // Keep handleUserSpokeRef pointing to the latest implementation on every render
  handleUserSpokeRef.current = handleUserSpoke;

  const handleScenarioClick = (text: string) => {
    if (isProcessingTurn) return;
    if (!callActiveRef.current) {
      initCallSessionState();
    }
    handleUserSpokeRef.current(text);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim() || isProcessingTurn) return;
    const q = textInput;
    setTextInput('');
    if (!callActiveRef.current) {
      initCallSessionState();
    }
    handleUserSpokeRef.current(q);
  };

  const toggleMute = () => {
    const nextMuted = !isMutedRef.current;
    updateIsMuted(nextMuted);
    if (nextMuted) {
      stopListeningMic();
    } else {
      fatalMicErrorRef.current = false;
      consecutiveErrorsRef.current = 0;
      setMicErrorNotice(null);
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

      {/* Microphone Permission or Error Notice */}
      {(!micSupported || micErrorNotice) && (
        <div
          role="status"
          className="bg-rose-950/30 border border-rose-500/30 rounded-2xl p-3.5 flex items-start gap-3"
        >
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="text-xs text-rose-200 leading-relaxed">
            {micErrorNotice ||
              'Browser speech recognition is unavailable in this environment. You can test the full voice pipeline using typed input or 1-click prompts below.'}
          </div>
        </div>
      )}

      {/* Explicit Offline Demo Mode Notice when Gemini key is unavailable */}
      {!geminiConfigured && (
        <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-2xl p-3.5 flex items-center justify-between gap-3">
          <div className="text-xs text-indigo-200 leading-relaxed">
            <strong>Server GEMINI_API_KEY Not Configured:</strong>{' '}
            {offlineDemoMode
              ? 'Running in Offline Deterministic Demo Mode (safety rules, keyword RAG, and mock tools).'
              : 'Live LLM generation is unavailable without an API key.'}
          </div>
          <button
            onClick={() => setOfflineDemoMode(v => !v)}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shrink-0 cursor-pointer"
          >
            {offlineDemoMode ? 'Disable Demo Mode' : 'Enable Offline Demo'}
          </button>
        </div>
      )}

      {/* Server AI Generation Error Banner (never silently masked) */}
      {turnErrorNotice && (
        <div
          role="alert"
          className="bg-rose-950/40 border border-rose-500/40 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs text-rose-200 leading-relaxed">
              {turnErrorNotice.message}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {turnErrorNotice.canEnableDemo && !offlineDemoMode && (
              <button
                onClick={() => {
                  setOfflineDemoMode(true);
                  demoModeRef.current = true;
                  if (turnErrorNotice.retryText) {
                    handleUserSpokeRef.current(turnErrorNotice.retryText);
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs cursor-pointer"
              >
                Use Offline Demo Mode
              </button>
            )}
            {turnErrorNotice.retryText && (
              <button
                onClick={() => handleUserSpokeRef.current(turnErrorNotice.retryText!)}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            )}
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
                Measured Round-Trip:
              </span>
              <span className="font-bold text-emerald-400">
                {lastLatency ? `${lastLatency.totalTurnaroundMs}ms` : '—'}
              </span>
            </div>

            {lastLatency && (
              <div className="space-y-1 text-[11px] font-mono text-slate-400">
                <div className="flex justify-between">
                  <span>RAG Search: {lastLatency.ragMs}ms</span>
                  <span>Model/Pipeline: {lastLatency.modelResponseMs}ms</span>
                  <span>Mode: {lastLatency.mode === 'offline_demo' ? 'Demo' : lastLatency.mode === 'safety_fastpath' ? 'Safety' : 'Gemini'}</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden flex">
                  <div
                    style={{ width: `${Math.min(100, (lastLatency.ragMs / Math.max(1, lastLatency.totalTurnaroundMs)) * 100)}%` }}
                    className="bg-amber-500 h-full"
                  />
                  <div
                    style={{ width: `${Math.min(100, (lastLatency.modelResponseMs / Math.max(1, lastLatency.totalTurnaroundMs)) * 100)}%` }}
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

            {(queuedHandoffTicket || humanHandoffNotice) && (
              <span className="text-xs px-2.5 py-0.5 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-300 font-mono">
                {queuedHandoffTicket
                  ? `Callback Queued: ${queuedHandoffTicket.id} (${queuedHandoffTicket.phone})`
                  : 'Callback Queued'}
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
            ref={transcriptContainerRef}
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
                disabled={isProcessingTurn || !textInput.trim()}
                aria-label="Send message"
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                {isProcessingTurn ? 'Thinking...' : 'Send'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
