import type { SupportedLanguage, TenantConfig } from '../types/index.ts';

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
 */
const HUMAN_ESCALATION_REGEX =
  /\b(angry|human|supervisor|useless|stupid|bakwas|insan|gussa|kharap)\b|\b(?:talk|speak|connect|transfer|forward|escalate|hand\s*over|pass)\s+(?:me\s+)?(?:to|with)\s+(?:a\s+|an\s+|the\s+|your\s+)?(?:real\s+)?(?:person|human|agent|manager|officer|representative|staff|specialist)\b|\b(?:call|need|want)\s+(?:a\s+|an\s+|the\s+)?(?:manager|supervisor|human\s+agent|real\s+person)\b/i;
const HUMAN_ESCALATION_INDIC_TOKENS = [
  'କଥା ହେବି', 'ମ୍ୟାନେଜର', 'ଅଧିକାରୀ', 'ବରିଷ୍ଠ', 'ରାଗ',
  'बात कराओ', 'इंसान से बात', 'अधिकारी', 'गुस्सा',
  'মানুষের সাথে কথা', 'কথা বলতে চাই',
];

export function checkEmergencyCondition(
  text: string,
  lang: SupportedLanguage,
  tenant?: Pick<TenantConfig, 'name' | 'category' | 'humanHandoffContact'>,
  handoffTicketId?: string
): EmergencyCheckResult | null {
  for (const pattern of EMERGENCY_PATTERNS) {
    if (pattern.regex.test(text)) {
      const desk = tenant?.humanHandoffContact?.department || 'Support Desk';
      const phone = tenant?.humanHandoffContact?.phone || '112';
      const isClinic = !tenant || tenant.category === 'clinic';
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
  if (HUMAN_ESCALATION_REGEX.test(text)) {
    return true;
  }
  return HUMAN_ESCALATION_INDIC_TOKENS.some(token => text.includes(token));
}

export const AI_DISCLOSURE_NOTICE = 'Notice: You are speaking with an automated AI prototype. This system cannot provide medical diagnoses or medical advice.';
