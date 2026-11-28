import type { SupportedLanguage, TenantConfig } from '../types/index.ts';

export interface EmergencyCheckResult {
  isEmergency: boolean;
  symptomDetected?: string;
  isSelfHarmRisk?: boolean;
  emergencyMessage: string;
  actionRequired: string;
}

const SELF_HARM_PATTERNS: { regex: RegExp; symptom: string }[] = [
  {
    regex: /\b(?:kill\s+myself|end\s+my\s+life|commit\s+suicide|suicidal|want\s+to\s+die|take\s+my\s+life|cut\s+myself|harm\s+myself|marna\s+chahta|aatmahatya|khudkushi)\b/i,
    symptom: 'Self-harm or suicide risk',
  },
  {
    regex: /(?:ଆତ୍ମହତ୍ୟା|ମରିଯିବାକୁ\s*ଚାହୁଁଛି|ମରିଯିବି|ନିଜକୁ\s*କ୍ଷତି)/i,
    symptom: 'Self-harm or suicide risk',
  },
  {
    regex: /(?:आत्महत्या|खुदकुशी|मरना\s*चाहता|मरना\s*चाहती|जान\s*देना|खुद\s*को\s*नुकसान)/i,
    symptom: 'Self-harm or suicide risk',
  },
  {
    regex: /(?:আত্মহত্যা|মরে\s*যেতে\s*চাই|নিজেকে\s*ক্ষতি)/i,
    symptom: 'Self-harm or suicide risk',
  },
];

const EMERGENCY_PATTERNS: { regex: RegExp; symptom: string }[] = [
  // Odia symptom-specific patterns
  { regex: /ଛାତି\S*(?:\s+\S+){0,3}\s*(?:କଷ୍ଟ|ଯନ୍ତ୍ରଣା)|ହୃଦଘାତ/i, symptom: 'Chest pain or cardiac distress' },
  { regex: /ନିଶ୍ୱାସ(?:\s+\S+){0,3}\s*(?:କଷ୍ଟ|ବନ୍ଦ|ଅସୁବିଧା)/i, symptom: 'Breathing difficulty' },
  { regex: /ରକ୍ତସ୍ରାବ|ରକ୍ତ(?:\s+\S+){0,2}\s*ବାହାରୁଛି/i, symptom: 'Severe bleeding' },
  { regex: /ଅଚେତ|ବେହୋସ|ଝଟକା/i, symptom: 'Unconsciousness or seizure' },
  { regex: /ଷ୍ଟ୍ରୋକ୍|ଦୁର୍ଘଟଣା|ଆକ୍ସିଡେଣ୍ଟ|ସାପ\s*କାମୁଡ଼ି|ବିଷ/i, symptom: 'Acute emergency or poisoning' },

  // Hindi symptom-specific patterns
  { regex: /(?:छाती|सीने)(?:\s+\S+){0,3}\s*(?:दर्द|तकलीफ)|दिल\s*का\s*दौरा|हार्ट\s*अटैक/i, symptom: 'Chest pain or cardiac distress' },
  { regex: /सांस(?:\s+\S+){0,3}\s*(?:नहीं|तकलीफ|फूल)|दम\s*घुट\s*रहा/i, symptom: 'Breathing difficulty' },
  { regex: /खून\s*बह\s*रहा/i, symptom: 'Severe bleeding' },
  { regex: /बेहोश|स्ट्रोक|मिर्गी|दौरा/i, symptom: 'Unconsciousness or neurological emergency' },
  { regex: /दुर्घटना|गंभीर\s*चोट|जहर|सांप\s*ने\s*काटा/i, symptom: 'Trauma, poisoning, or bite emergency' },

  // Hinglish symptom-specific patterns
  { regex: /\b(?:seene\s+mein\s+dard|chhati\s+mein\s+dard|chest\s*pain|heart\s*attack)\b/i, symptom: 'Chest pain or cardiac distress' },
  { regex: /\b(?:saans\s+nahi|saans\s+phool|saans\s+lene\s+mein\s+takleef|breathlessness|cannot\s*breathe|cant\s*breathe)\b/i, symptom: 'Breathing difficulty' },
  { regex: /\b(?:khoon\s+beh|bleeding\s+heavily|heavy\s+bleeding)\b/i, symptom: 'Severe bleeding' },
  { regex: /\b(?:unconscious|behosh|mirgi|daura\s+pad|zeher|saamp\s+ne\s+kaat)\b/i, symptom: 'Critical neurological or poisoning emergency' },

  // Bengali symptom-specific patterns
  { regex: /বুকে(?:\s+\S+){0,3}\s*(?:ব্যথা|যন্ত্রণা)|হার্ট\s*অ্যাটাক/i, symptom: 'Chest pain or cardiac distress' },
  { regex: /শ্বাসকষ্ট|শ্বাস\s*নিতে\s*(?:পারছি|পারছেন|পারছে)\s*না|শ্বাস(?:\s+\S+){0,2}\s*(?:কষ্ট|বন্ধ)/i, symptom: 'Breathing difficulty' },
  { regex: /রক্তপাত|অচেতন|স্ট্রোক|খিঁচুনি|দুর্ঘটনা|সাপে\s*কেটেছে|বিষ/i, symptom: 'Acute medical emergency' },

  // English symptom-specific patterns
  { regex: /\b(?:chest\s*pain|heart\s*attack|cardiac\s*arrest)\b/i, symptom: 'Chest pain or cardiac distress' },
  { regex: /\b(?:cannot\s*breathe|can't\s*breathe|cant\s*breathe|shortness\s*of\s*breath|difficulty\s*breathing|choking)\b/i, symptom: 'Breathing difficulty' },
  { regex: /\b(?:heavy\s*bleeding|uncontrolled\s*bleeding|pregnancy\s*bleeding)\b/i, symptom: 'Severe bleeding' },
  { regex: /\b(?:unconscious|passed\s*out|fainted|unresponsive|stroke|seizure|convulsion)\b/i, symptom: 'Unconsciousness or neurological emergency' },
  { regex: /\b(?:severe\s*accident|major\s*trauma|overdose|poison(?:ed|ing)?|snake\s*bite|severe\s*burn|anaphylaxis)\b/i, symptom: 'Acute trauma, poisoning, or burn' },
  { regex: /\b(?:medical\s+emergency|it'?s\s+an\s+emergency|emergency\s+help|have\s+an\s+emergency)\b/i, symptom: 'Declared medical emergency' },
];

// Informational queries about emergency department/hours should reach normal Q&A instead of triggering critical escalation
const INFORMATIONAL_EMERGENCY_QUERY_REGEX =
  /\b(?:emergency\s+(?:department|ward|room|opd|desk|service|services|casualty)\s+(?:hours|timings|open|closed|number|contact)|what\s+are\s+(?:your|the)\s+emergency|is\s+(?:the\s+)?emergency\s+(?:open|24|available)|emergency\s+delivery\s+option)\b/i;

// Strip explicit symptom negations before matching ("I do not have chest pain", "no bleeding", "chest pain nahi hai")
const ENGLISH_NEGATED_SYMPTOM_REGEX =
  /\b(?:no|not|never|without|don'?t|do\s+not|doesn'?t|didn'?t|nahi|nahin)\s+(?:having\s+|have\s+|any\s+|feeling\s+)?(?:chest\s*pain|shortness\s*of\s*breath|difficulty\s*breathing|heavy\s*bleeding|bleeding|seizure|stroke|heart\s*attack|unconscious|breathlessness)\b/gi;
const POST_NEGATED_SYMPTOM_REGEX =
  /\b(?:chest\s*pain|seene\s+mein\s+dard|saans\s+ki\s+takleef|khoon)\s+(?:nahi|nahin)\b/gi;

const HUMAN_ESCALATION_EXPLICIT_REGEX =
  /\b(?:angry|supervisor|manager|useless|stupid|bakwas|gussa)\b|\b(?:talk|speak|connect|transfer|forward|escalate|hand\s*over|pass)\s+(?:me\s+)?(?:to|with)\s+(?:a\s+|an\s+|the\s+|your\s+)?(?:real\s+)?(?:person|human|agent|manager|officer|representative|staff|specialist)\b|\b(?:call|need|want)\s+(?:a\s+|an\s+|the\s+)?(?:manager|supervisor|human\s+agent|real\s+person|real\s+human)\b/i;

const HUMAN_ESCALATION_NEGATION_REGEX =
  /\b(?:not|never|no|don'?t|do\s+not)\s+(?:angry|stupid|useless|need\s+(?:a\s+)?(?:human|manager|supervisor)|want\s+(?:a\s+)?(?:human|manager|supervisor)|transfer\s+(?:me\s+)?to\s+(?:a\s+)?(?:human|agent|manager))\b/i;

const HUMAN_ESCALATION_NON_ESCALATION_REGEX =
  /\b(?:are\s+you\s+(?:a\s+)?human|human\s+resources|hr\s+department|student\s+of\s+humanities)\b/i;

const HUMAN_ESCALATION_INDIC_TOKENS = [
  'କଥା ହେବି', 'ମ୍ୟାନେଜର', 'ଅଧିକାରୀ', 'ବରିଷ୍ଠ', 'ରାଗ',
  'बात कराओ', 'इंसान से बात', 'अधिकारी से बात', 'मैनेजर से बात', 'गुस्सा',
  'মানুষের সাথে কথা', 'কথা বলতে চাই', 'ম্যানেজার',
];

function stripNegatedSymptoms(text: string): string {
  return text
    .replace(ENGLISH_NEGATED_SYMPTOM_REGEX, ' ')
    .replace(POST_NEGATED_SYMPTOM_REGEX, ' ');
}

export function checkEmergencyCondition(
  text: string,
  lang: SupportedLanguage,
  tenant?: Pick<TenantConfig, 'name' | 'category' | 'humanHandoffContact'>,
  handoffTicketId?: string
): EmergencyCheckResult | null {
  const cleanText = (text || '').trim();
  if (!cleanText) return null;

  const desk = tenant?.humanHandoffContact?.department || 'Support Desk';
  const phone = tenant?.humanHandoffContact?.phone || '112';
  const isClinic = !tenant || tenant.category === 'clinic';

  // 1. Self-harm & suicide risk branch (India Tele-MANAS 14416 + 112)
  for (const pattern of SELF_HARM_PATTERNS) {
    if (pattern.regex.test(cleanText)) {
      const messages: Record<SupportedLanguage, string> = {
        or: `ଜରୁରୀ ସହାୟତା: ଦୟାକରି ଏକୁଟିଆ ରୁହନ୍ତୁ ନାହିଁ। ତୁରନ୍ତ Tele-MANAS ହେଲ୍ପଲାଇନ ୧୪୪୧୬ କିମ୍ବା ଜରୁରୀକାଳୀନ ନମ୍ବର ୧୧୨ କୁ କଲ୍ କରନ୍ତୁ।${handoffTicketId ? ` କଲ୍‌ବ୍ୟାକ୍ ଟିକେଟ୍ ${handoffTicketId} (${desk}: ${phone}) ନଥିଭୁକ୍ତ ହୋଇଛି।` : ''}`,
        hi: `आपातकालीन सहायता: कृपया अकेले न रहें। तुरंत Tele-MANAS हेल्पलाइन 14416 या आपातकालीन नंबर 112 पर कॉल करें।${handoffTicketId ? ` कॉलबैक टिकट ${handoffTicketId} (${desk}: ${phone}) दर्ज कर लिया गया है।` : ''}`,
        hinglish: `URGENT HELP: Please akele mat rahiye. Abhi Tele-MANAS helpline 14416 ya emergency number 112 par call karein.${handoffTicketId ? ` Urgent callback ticket ${handoffTicketId} (${desk}: ${phone}) log ho gaya hai.` : ''}`,
        bn: `জরুরি সহায়তা: অনুগ্রহ করে একা থাকবেন না। অবিলম্বে Tele-MANAS হেল্পলাইন ১৪৪১৬ অথবা জরুরি নম্বর ১১২-এ কল করুন।${handoffTicketId ? ` কলব্যাক টিকিট ${handoffTicketId} (${desk}: ${phone}) নথিভুক্ত হয়েছে।` : ''}`,
        en: `URGENT SUPPORT: You are not alone and help is available right now. Please call India's 24/7 Tele-MANAS mental health helpline at 14416 or emergency services at 112 immediately.${handoffTicketId ? ` Urgent callback ticket ${handoffTicketId} has also been logged for ${desk} (${phone}).` : ''}`,
      };
      return {
        isEmergency: true,
        isSelfHarmRisk: true,
        symptomDetected: pattern.symptom,
        emergencyMessage: messages[lang] || messages.en,
        actionRequired: handoffTicketId
          ? `Call 14416 (Tele-MANAS) or 112 immediately; callback ticket ${handoffTicketId} queued`
          : `Call 14416 (Tele-MANAS) or 112 immediately`,
      };
    }
  }

  // Guard informational policy/hours queries ("What are your emergency department hours?")
  if (INFORMATIONAL_EMERGENCY_QUERY_REGEX.test(cleanText)) {
    return null;
  }

  const positiveOnlyText = stripNegatedSymptoms(cleanText);
  if (!positiveOnlyText.trim()) return null;

  for (const pattern of EMERGENCY_PATTERNS) {
    if (pattern.regex.test(positiveOnlyText)) {
      const ticketPhraseEn = handoffTicketId
        ? `I have logged urgent callback ticket ${handoffTicketId} for ${desk} (${phone}), but please call 112 directly without waiting.`
        : `Please call 112 directly without waiting; you can also reach ${desk} at ${phone}.`;

      const messages: Record<SupportedLanguage, string> = isClinic
        ? {
            or: `ଜରୁରୀ ସତର୍କତା: ଏହା ଏକ ମେଡିକାଲ ଏମରଜେନ୍ସି ଜଣାପଡୁଛି। ଦୟାକରି ତୁରନ୍ତ ୧୧୨ (ଜରୁରୀକାଳୀନ ସେବା) ଡାକନ୍ତୁ କିମ୍ବା ନିକଟସ୍ଥ ହସ୍ପିଟାଲକୁ ଯାଆନ୍ତୁ।${handoffTicketId ? ` କଲ୍‌ବ୍ୟାକ୍ ଟିକେଟ୍ ${handoffTicketId} (${desk}: ${phone}) ନଥିଭୁକ୍ତ ହୋଇଛି।` : ''}`,
            hi: `आपातकालीन चेतावनी: यह एक मेडिकल इमरजेंसी प्रतीत हो रही है। कृपया तुरंत 112 डायल करें या नजदीकी अस्पताल जाएँ।${handoffTicketId ? ` कॉलबैक टिकट ${handoffTicketId} (${desk}: ${phone}) दर्ज कर लिया गया है।` : ''}`,
            hinglish: `EMERGENCY ALERT: Yeh medical emergency lag rahi hai. Please immediately 112 dial karein ya nearest hospital jayein.${handoffTicketId ? ` Urgent callback ticket ${handoffTicketId} (${desk}: ${phone}) log kar diya gaya hai.` : ''}`,
            bn: `জরুরি সতর্কতা: এটি একটি মেডিকেল এমার্জেন্সি হতে পারে। অনুগ্রহ করে অবিলম্বে ১১২ ডায়াল করুন বা নিকটস্থ হাসপাতালে যান।${handoffTicketId ? ` কলব্যাক টিকিট ${handoffTicketId} (${desk}: ${phone}) নথিভুক্ত হয়েছে।` : ''}`,
            en: `EMERGENCY ALERT: This sounds like a medical emergency. Please dial 112 immediately or proceed to the nearest emergency hospital. ${ticketPhraseEn}`,
          }
        : {
            or: `ଜରୁରୀ ସତର୍କତା: ଯଦି ଏହା ଏକ ମେଡିକାଲ ଏମରଜେନ୍ସି, ଦୟାକରି ତୁରନ୍ତ ୧୧୨ ଡାକନ୍ତୁ। ମୁଁ ${tenant.name} ର ${desk} (${phone}) ପାଇଁ କଲ୍‌ବ୍ୟାକ୍ ଟିକେଟ୍${handoffTicketId ? ` ${handoffTicketId}` : ''} ନଥିଭୁକ୍ତ କରିଛି।`,
            hi: `आपातकालीन चेतावनी: यदि यह मेडिकल इमरजेंसी है, तो कृपया तुरंत 112 डायल करें। मैंने ${tenant.name} के ${desk} (${phone}) के लिए कॉलबैक टिकट${handoffTicketId ? ` ${handoffTicketId}` : ''} दर्ज किया है।`,
            hinglish: `EMERGENCY ALERT: Agar yeh medical emergency hai toh please turant 112 dial karein. Maine ${tenant.name} ke ${desk} (${phone}) ke liye callback ticket${handoffTicketId ? ` ${handoffTicketId}` : ''} log kiya hai.`,
            bn: `জরুরি সতর্কতা: এটি মেডিকেল এমার্জেন্সি হলে অবিলম্বে ১১২ ডায়াল করুন। ${tenant.name}-এর ${desk} (${phone}) টিমের জন্য কলব্যাক টিকিট${handoffTicketId ? ` ${handoffTicketId}` : ''} নথিভুক্ত হয়েছে।`,
            en: `EMERGENCY ALERT: If this is a life-threatening emergency, please dial 112 immediately. Note that ${tenant.name} is not a medical facility; ${handoffTicketId ? `callback ticket ${handoffTicketId} has been queued for ${desk} (${phone}).` : `you can contact ${desk} at ${phone}.`}`,
          };

      return {
        isEmergency: true,
        symptomDetected: pattern.symptom,
        emergencyMessage: messages[lang] || messages.en,
        actionRequired: handoffTicketId
          ? `Dial 112 immediately; callback ticket ${handoffTicketId} queued for ${desk}`
          : `Dial 112 immediately; contact ${desk} (${phone})`,
      };
    }
  }
  return null;
}

export function checkEmergencyWithContext(
  texts: string[],
  lang: SupportedLanguage,
  tenant?: Pick<TenantConfig, 'name' | 'category' | 'humanHandoffContact'>,
  handoffTicketId?: string
): EmergencyCheckResult | null {
  const combined = texts
    .map(t => (t || '').trim())
    .filter(Boolean)
    .slice(-2)
    .join('. ');
  if (!combined) return null;
  return checkEmergencyCondition(combined, lang, tenant, handoffTicketId);
}

export function buildHumanEscalationReply(
  lang: SupportedLanguage,
  tenant: Pick<TenantConfig, 'name' | 'humanHandoffContact'>,
  handoffTicketId?: string
): string {
  const dept = tenant.humanHandoffContact.department;
  const phone = tenant.humanHandoffContact.phone;
  const ref = handoffTicketId ? ` (${handoffTicketId})` : '';

  const messages: Record<SupportedLanguage, string> = {
    or: `ମୁଁ ବୁଝିପାରୁଛି ଆପଣ ଜଣେ ଅଧିକାରୀଙ୍କ ସହ କଥା ହେବାକୁ ଚାହୁଁଛନ୍ତି। ${tenant.name} ର ${dept} (${phone}) ପାଇଁ କଲ୍‌ବ୍ୟାକ୍ ଅନୁରୋଧ${ref} କ୍ୟୁରେ ରଖାଯାଇଛି।`,
    hi: `मैं समझ रहा हूँ कि आप किसी अधिकारी से बात करना चाहते हैं। ${tenant.name} के ${dept} (${phone}) के लिए कॉलबैक अनुरोध${ref} दर्ज कर दिया गया है।`,
    hinglish: `Samajh gaya. Maine ${tenant.name} ke ${dept} (${phone}) ke liye aapka callback request${ref} queue kar diya hai.`,
    bn: `আমি বুঝতে পারছি আপনি একজন কর্মকর্তার সাথে কথা বলতে চান। ${tenant.name}-এর ${dept} (${phone})-এর জন্য কলব্যাক অনুরোধ${ref} নথিভুক্ত করা হয়েছে।`,
    en: `I understand you would like to speak with a staff specialist. Since this web prototype does not bridge live phone lines directly, I have queued callback ticket${ref} for ${tenant.name}'s ${dept} (${phone}).`,
  };
  return messages[lang] || messages.en;
}

export function checkHumanEscalationRequest(text: string): boolean {
  const clean = (text || '').trim();
  if (!clean) return false;
  if (HUMAN_ESCALATION_NON_ESCALATION_REGEX.test(clean)) {
    return false;
  }
  if (
    HUMAN_ESCALATION_NEGATION_REGEX.test(clean) &&
    !/\b(?:speak|talk|connect)\s+(?:to|with)\s+(?:a\s+)?(?:human|manager|supervisor|agent)\b/i.test(clean)
  ) {
    return false;
  }
  if (HUMAN_ESCALATION_EXPLICIT_REGEX.test(clean)) {
    return true;
  }
  return HUMAN_ESCALATION_INDIC_TOKENS.some(token => clean.includes(token));
}

export const AI_DISCLOSURE_NOTICE =
  'Notice: You are speaking with an automated AI prototype. This system cannot provide medical diagnoses or medical advice.';
