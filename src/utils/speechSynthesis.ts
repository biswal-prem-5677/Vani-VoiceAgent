import { SupportedLanguage } from '../types';

export interface SpeechOptions {
  speed?: number;
  pitch?: number;
  volume?: number;
}

export interface SpeechController {
  speak: (text: string, lang: SupportedLanguage, onEnd?: () => void, options?: SpeechOptions) => void;
  stop: () => void;
  isSpeaking: () => boolean;
  hasOdiaVoiceSupport: () => boolean;
}

export function createSpeechController(): SpeechController {
  let speaking = false;

  const stop = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        // ignore
      }
    }
    speaking = false;
  };

  const hasOdiaVoiceSupport = (): boolean => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
    const voices = window.speechSynthesis.getVoices();
    return voices.some(v => v.lang.toLowerCase().startsWith('or') || v.lang.toLowerCase().includes('oriya') || v.lang.toLowerCase().includes('odia'));
  };

  const speak = (
    text: string,
    lang: SupportedLanguage,
    onEnd?: () => void,
    options?: SpeechOptions
  ) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      onEnd?.();
      return;
    }

    stop();

    const utterance = new SpeechSynthesisUtterance(text);
    speaking = true;

    const baseRate = options?.speed ?? 1.0;
    const basePitch = options?.pitch ?? 1.0;

    switch (lang) {
      case 'or':
        // If native Odia is available in browser OS, use it; otherwise fallback to Indian English/Hindi
        utterance.lang = hasOdiaVoiceSupport() ? 'or-IN' : 'hi-IN';
        utterance.rate = baseRate;
        utterance.pitch = basePitch * 1.02;
        break;
      case 'hi':
      case 'hinglish':
        utterance.lang = 'hi-IN';
        utterance.rate = baseRate;
        utterance.pitch = basePitch;
        break;
      case 'bn':
        utterance.lang = 'bn-IN';
        utterance.rate = baseRate;
        utterance.pitch = basePitch;
        break;
      case 'en':
      default:
        utterance.lang = 'en-IN';
        utterance.rate = baseRate;
        utterance.pitch = basePitch;
        break;
    }

    const voices = window.speechSynthesis.getVoices();
    let preferredVoice: SpeechSynthesisVoice | undefined;

    if (lang === 'or' && hasOdiaVoiceSupport()) {
      preferredVoice = voices.find(v => v.lang.toLowerCase().startsWith('or'));
    }

    if (!preferredVoice) {
      preferredVoice = voices.find(
        v => v.lang.includes('IN') || v.lang.includes('hi') || v.name.includes('India')
      );
    }

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onend = () => {
      speaking = false;
      onEnd?.();
    };

    utterance.onerror = () => {
      speaking = false;
      onEnd?.();
    };

    window.speechSynthesis.speak(utterance);
  };

  return {
    speak,
    stop,
    isSpeaking: () => speaking,
    hasOdiaVoiceSupport,
  };
}
