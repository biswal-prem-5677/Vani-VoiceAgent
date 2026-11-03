import { SupportedLanguage, LanguageMeta } from '../types';

export const SUPPORTED_LANGUAGES: Record<SupportedLanguage, LanguageMeta> = {
  or: {
    code: 'or',
    name: 'Odia',
    nativeName: 'ଓଡ଼ିଆ',
    flag: '🇮🇳 (OD)',
    sttCode: 'or-IN',
    greetingExample: 'ନମସ୍କାର! ମୁଁ କଳିଙ୍ଗ କେୟାରରୁ କହୁଛି, କିପରି ସାହାଯ୍ୟ କରିପାରିବି?',
  },
  hi: {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    flag: '🇮🇳 (HI)',
    sttCode: 'hi-IN',
    greetingExample: 'नमस्ते! मैं आपकी किस प्रकार सहायता कर सकता हूँ?',
  },
  hinglish: {
    code: 'hinglish',
    name: 'Hinglish',
    nativeName: 'Hinglish (Code-Switch)',
    flag: '🇮🇳 (HI-EN)',
    sttCode: 'hi-IN',
    greetingExample: 'Namaste! Main aapki help kaise kar sakta hoon?',
  },
  bn: {
    code: 'bn',
    name: 'Bengali',
    nativeName: 'বাংলা',
    flag: '🇮🇳 (BN)',
    sttCode: 'bn-IN',
    greetingExample: 'নমস্কার! আপনাকে কীভাবে সাহায্য করতে পারি?',
  },
  en: {
    code: 'en',
    name: 'English (Indian)',
    nativeName: 'English (IN)',
    flag: '🌐 (EN)',
    sttCode: 'en-IN',
    greetingExample: 'Hello! Welcome to our voice desk. How can I assist you today?',
  },
};

const ODIA_REGEX = /[\u0B00-\u0B7F]/;
const HINDI_REGEX = /[\u0900-\u097F]/;
const BENGALI_REGEX = /[\u0980-\u09FF]/;

const ODIA_ROMAN_KEYWORDS = [
  'namaskar', 'aagya', 'agya', 'kemiti', 'achhanti', 'achanti', 'dharantu',
  'mu', 'mote', 'apana', 'tume', 'ebe', 'tike', 'tikie', 'dekhantu', 'karantu',
  'chahunchi', 'dr', 'daktara', 'ausadha', 'au', 'taha', 'janantu', 'bhubaneswar',
  'cuttack', 'dhanyabad', 'kete', 'bele', 'kahinki', 'auki', 'aukie'
];

const HINDI_ROMAN_KEYWORDS = [
  'namaste', 'namaskaar', 'mujhe', 'aap', 'kripya', 'karo', 'karna', 'chahiye',
  'batao', 'bataiye', 'hai', 'hain', 'kaise', 'kab', 'kyun', 'kya', 'nahi',
  'shukriya', 'theek', 'kal', 'aaj', 'subah', 'shaam', 'dophar'
];

const BENGALI_ROMAN_KEYWORDS = [
  'kemon', 'achhen', 'dorkar', 'bolun', 'kichhu', 'amake', 'apni', 'ami',
  'dhonyobad', 'ki kore', 'bhalo'
];

export function detectLanguage(text: string, currentContextLanguage?: SupportedLanguage): {
  detected: SupportedLanguage;
  confidence: number;
  switched: boolean;
  reason: string;
} {
  const clean = text.trim();
  if (!clean) {
    return {
      detected: currentContextLanguage || 'en',
      confidence: 1.0,
      switched: false,
      reason: 'Empty input, retained context language',
    };
  }

  // 1. Check Native Scripts
  if (ODIA_REGEX.test(clean)) {
    const isSwitched = currentContextLanguage !== undefined && currentContextLanguage !== 'or';
    return {
      detected: 'or',
      confidence: 0.98,
      switched: isSwitched,
      reason: 'Detected Odia script characters (\u0B00-\u0B7F)',
    };
  }

  if (BENGALI_REGEX.test(clean)) {
    const isSwitched = currentContextLanguage !== undefined && currentContextLanguage !== 'bn';
    return {
      detected: 'bn',
      confidence: 0.96,
      switched: isSwitched,
      reason: 'Detected Bengali script characters (\u0980-\u09FF)',
    };
  }

  if (HINDI_REGEX.test(clean)) {
    const isSwitched = currentContextLanguage !== undefined && currentContextLanguage !== 'hi';
    return {
      detected: 'hi',
      confidence: 0.97,
      switched: isSwitched,
      reason: 'Detected Devanagari script characters (\u0900-\u097F)',
    };
  }

  // 2. Latin script analysis (English vs Hinglish vs Romanized Odia)
  const tokens = clean.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return {
      detected: currentContextLanguage || 'en',
      confidence: 0.8,
      switched: false,
      reason: 'No alphabetic tokens, defaulting to context',
    };
  }

  let odiaMatches = 0;
  let hindiMatches = 0;
  let bengaliMatches = 0;

  for (const token of tokens) {
    if (ODIA_ROMAN_KEYWORDS.includes(token)) odiaMatches++;
    if (HINDI_ROMAN_KEYWORDS.includes(token)) hindiMatches++;
    if (BENGALI_ROMAN_KEYWORDS.includes(token)) bengaliMatches++;
  }

  // Romanized Odia wins if explicit odia markers detected
  if (odiaMatches >= 2 || (odiaMatches === 1 && tokens.length <= 4)) {
    const isSwitched = currentContextLanguage !== undefined && currentContextLanguage !== 'or';
    return {
      detected: 'or',
      confidence: 0.85,
      switched: isSwitched,
      reason: `Matched ${odiaMatches} phonetic Odia keywords`,
    };
  }

  if (bengaliMatches >= 2 || (bengaliMatches === 1 && tokens.length <= 4)) {
    const isSwitched = currentContextLanguage !== undefined && currentContextLanguage !== 'bn';
    return {
      detected: 'bn',
      confidence: 0.82,
      switched: isSwitched,
      reason: `Matched ${bengaliMatches} phonetic Bengali keywords`,
    };
  }

  // Check Hinglish (Hindi tokens + English tokens mixed)
  if (hindiMatches >= 1) {
    const englishCount = tokens.length - hindiMatches;
    if (englishCount >= 1) {
      const isSwitched = currentContextLanguage !== undefined && currentContextLanguage !== 'hinglish';
      return {
        detected: 'hinglish',
        confidence: 0.90,
        switched: isSwitched,
        reason: `Detected code-switching (${hindiMatches} Hindi tokens + ${englishCount} English tokens)`,
      };
    } else {
      const isSwitched = currentContextLanguage !== undefined && currentContextLanguage !== 'hi';
      return {
        detected: 'hi',
        confidence: 0.85,
        switched: isSwitched,
        reason: `Matched Romanized Hindi vocabulary`,
      };
    }
  }

  // Default to English
  const isSwitched = currentContextLanguage !== undefined && currentContextLanguage !== 'en';
  return {
    detected: 'en',
    confidence: 0.92,
    switched: isSwitched,
    reason: 'Pure English Latin token distribution',
  };
}
