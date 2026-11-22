import type { SupportedLanguage } from '../types/index.ts';

export interface EmergencyCheckResult {
  isEmergency: boolean;
  symptomDetected?: string;
  emergencyMessage: string;
  actionRequired: string;
}

/**
 * Emergency medical indicators across supported languages.
 * Checks for life-threatening symptoms: chest pain, severe breathlessness,
 * uncontrolled bleeding, unconsciousness, stroke symptoms, major trauma.
 */
const EMERGENCY_PATTERNS = [
  // Odia
  { regex: /(?:ଛାତି\S*(?:\s+\S+){0,3}\s*(?:କଷ୍ଟ|ଯନ୍ତ୍ରଣା)|ନିଶ୍ୱାସ(?:\s+\S+){0,3}\s*(?:କଷ୍ଟ|ବନ୍ଦ|ଅସୁବିଧା)|ରକ୍ତସ୍ରାବ|ରକ୍ତ(?:\s+\S+){0,2}\s*ବାହାରୁଛି|ଅଚେତ|ବେହୋସ|ଷ୍ଟ୍ରୋକ୍|ହୃଦଘାତ|ଦୁର୍ଘଟଣା|ଆକ୍ସିଡେଣ୍ଟ)/i, symptom: 'Chest pain or breathing difficulty' },
  // Hindi
  { regex: /(?:छाती|सीने)(?:\s+\S+){0,3}\s*(?:दर्द|तकलीफ)|सांस(?:\s+\S+){0,3}\s*(?:नहीं|तकलीफ)|दम\s*घुट\s*रहा|खून\s*बह\s*रहा|बेहोश|स्ट्रोक|दिल\s*का\s*दौरा|हार्ट\s*अटैक|दुर्घटना|गंभीर\s*चोट/i, symptom: 'Chest pain or critical symptom' },
  // Hinglish
  { regex: /\b(?:chest\s*pain|saans\s*nahi|breathlessness|cannot\s*breathe|cant\s*breathe|khoon\s*beh|bleeding\s*heavily|unconscious|behosh|heart\s*attack|stroke|serious\s*accident)\b/i, symptom: 'Acute medical distress' },
  // Bengali
  { regex: /(?:বুকে\s*ব্যথা|শ্বাসকষ্ট|শ্বাস\s*নিতে\s*পারছি\s*না|রক্তপাত|অচেতন|স্ট্রোক|হার্ট\s*অ্যাটাক|দুর্ঘটনা)/i, symptom: 'Emergency symptom' },
  // English
  { regex: /\b(?:chest\s*pain|cannot\s*breathe|can't\s*breathe|shortness\s*of\s*breath|difficulty\s*breathing|heavy\s*bleeding|unconscious|passed\s*out|stroke|heart\s*attack|cardiac\s*arrest|severe\s*accident|emergency)\b/i, symptom: 'Emergency medical condition' },
];

/**
 * Whole-word and phrase matches for human escalation/frustration.
 * Avoids substring bugs ('humanities' matching 'human') and avoids
 * false-positive escalation when customers simply ask about "AI agent" capabilities
 * or staff titles without asking to transfer or speak to someone.
 */
const HUMAN_ESCALATION_REGEX =
  /\b(angry|human|supervisor|useless|stupid|bakwas|insan|gussa|kharap)\b|\b(?:talk|speak|connect|transfer|forward|escalate|hand\s*over|pass)\s+(?:me\s+)?(?:to|with)\s+(?:a\s+|an\s+|the\s+|your\s+)?(?:real\s+)?(?:person|human|agent|manager|officer|representative|staff|specialist)\b|\b(?:call|need|want)\s+(?:a\s+|an\s+|the\s+)?(?:manager|supervisor|human\s+agent|real\s+person)\b/i;
const HUMAN_ESCALATION_INDIC_TOKENS = [
  'କଥା ହେବି', 'ମ୍ୟାନେଜର', 'ଅଧିକାରୀ', 'ବରିଷ୍ଠ', 'ରାଗ',
  'बात कराओ', 'इंसान से बात', 'अधिकारी', 'गुस्सा',
  'মানুষের সাথে কথা', 'কথা বলতে চাই',
];

export function checkEmergencyCondition(text: string, lang: SupportedLanguage): EmergencyCheckResult | null {
  for (const pattern of EMERGENCY_PATTERNS) {
    if (pattern.regex.test(text)) {
      const messages: Record<SupportedLanguage, string> = {
        or: 'ଜରୁରୀ ସତର୍କତା: ଏହା ଏକ ମେଡିକାଲ ଏମରଜେନ୍ସି ଜଣାପଡୁଛି। ଦୟାକରି ତୁରନ୍ତ ୧୧୨ (ଜରୁରୀକାଳୀନ ସେବା) ଡାକନ୍ତୁ କିମ୍ବା ନିକଟସ୍ଥ ହସ୍ପିଟାଲକୁ ଯାଆନ୍ତୁ। ମୁଁ ତୁରନ୍ତ ଆମ କ୍ଲିନିକ ଡ୍ୟୁଟି ମେଡିକାଲ ଅଫିସରଙ୍କୁ ଟ୍ରାନ୍ସଫର ରିକ୍ୱେଷ୍ଟ ପଠାଉଛି।',
        hi: 'आपातकालीन चेतावनी: यह एक मेडिकल इमरजेंसी प्रतीत हो रही है। कृपया तुरंत 112 डायल करें या नजदीकी आपातकालीन केंद्र जाएँ। मैं तुरंत ड्यूटी मेडिकल ऑफिसर को कॉल ट्रांसफर का अनुरोध भेज रहा हूँ।',
        hinglish: 'EMERGENCY ALERT: Yeh serious medical situation lag rahi hai. Please immediately dial 112 ya nearest hospital jayein. Main duty medical officer ko transfer request initiate kar raha hoon.',
        bn: 'জরুরি সতর্কতা: এটি একটি মেডিকেল এমার্জেন্সি হতে পারে। অনুগ্রহ করে অবিলম্বে ১১২ ডায়াল করুন বা জরুরি বিভাগে যান। আমি ডিউটি অফিসারের কাছে ট্রান্সফার রিকোয়েস্ট পাঠাচ্ছি।',
        en: 'EMERGENCY ALERT: This sounds like a medical emergency. Please dial 112 immediately or proceed to the nearest emergency facility. I am requesting an urgent transfer to the clinic Duty Medical Officer right now.',
      };

      return {
        isEmergency: true,
        symptomDetected: pattern.symptom,
        emergencyMessage: messages[lang] || messages.en,
        actionRequired: 'Dial 112 immediately; transfer requested to Duty Medical Officer',
      };
    }
  }
  return null;
}

export function checkHumanEscalationRequest(text: string): boolean {
  if (HUMAN_ESCALATION_REGEX.test(text)) {
    return true;
  }
  return HUMAN_ESCALATION_INDIC_TOKENS.some(token => text.includes(token));
}

export const AI_DISCLOSURE_NOTICE = 'Notice: You are speaking with an automated AI prototype. This system cannot provide medical diagnoses or medical advice.';
