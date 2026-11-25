import type { SupportedLanguage, TenantConfig, CallTurn, LatencyBreakdown } from '../types/index.ts';
import { detectLanguage } from './languageDetector.ts';
import { searchKnowledgeBase, RELEVANCE_THRESHOLD } from './ragEngine.ts';
import { executeTenantTool } from './tools.ts';
import {
  checkEmergencyCondition,
  checkHumanEscalationRequest,
  buildHumanEscalationReply,
} from './safety.ts';

export interface ProcessTurnInput {
  userInput: string;
  tenant: TenantConfig;
  currentLanguage: SupportedLanguage;
  callMemory: Record<string, string>;
  turnHistory: CallTurn[];
}

export interface ProcessTurnOutput {
  spokenReply: string;
  detectedLanguage: SupportedLanguage;
  switchedLanguage: boolean;
  fillerUsed?: string;
  toolResult?: any;
  toolInvokedName?: string;
  toolParams?: Record<string, any>;
  shouldHandoff: boolean;
  handoffReason?: string;
  isEmergency?: boolean;
  updatedMemory: Record<string, string>;
  latencyBreakdown: LatencyBreakdown;
  detectedIntent: string;
}

export function getNaturalFiller(tenant: TenantConfig, lang: SupportedLanguage): string {
  const list = tenant.fillers[lang] || tenant.fillers.en || ['One moment please, verifying details...'];
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Extracts entities using whole-word regexes and strict script checks.
 * Fixes substring bugs:
 * - 'kal' does NOT match 'Kalinga'
 * - 'order' does NOT match 'border'
 * - 'human' does NOT match 'humanities'
 */
export function extractEntitiesFromInput(text: string, currentMemory: Record<string, string>): Record<string, string> {
  const updated = { ...currentMemory };
  const lower = text.toLowerCase();

  // Doctor match with word boundaries and script checks
  if (/\b(?:dr\.?\s*)?jena\b/i.test(lower) || /ଜେନା/.test(text) || /जेना/.test(text)) {
    updated.doctor = 'Dr. Jena (Cardiology)';
  } else if (/\b(?:dr\.?\s*)?mohapatra\b/i.test(lower) || /ମହାପାତ୍ର/.test(text) || /महापात्रा/.test(text)) {
    updated.doctor = 'Dr. Mohapatra (General Medicine)';
  } else if (/\b(?:dr\.?\s*)?mishra\b/i.test(lower) || /ମିଶ୍ର/.test(text) || /मिश्रा/.test(text)) {
    updated.doctor = 'Dr. Mishra (Pediatrics)';
  }

  // Day match - whole-word regex to avoid 'kal' inside 'kalinga'
  const isTomorrow = /\b(?:tomorrow|kali|aaukaali)\b/i.test(lower) ||
    (/\bkal\b/i.test(lower) && !/\bkalinga\b/i.test(lower)) ||
    /କାଲି/.test(text) ||
    /कल/.test(text);

  const isToday = /\b(?:today|aaji)\b/i.test(lower) ||
    (/\baaj\b/i.test(lower) && !/\baajkal\b/i.test(lower)) ||
    /ଆଜି/.test(text) ||
    /आज/.test(text);

  const isSaturday = /\b(?:saturday|sanibar)\b/i.test(lower) || /ଶନିବାର/.test(text) || /शनिवार/.test(text);

  if (isTomorrow) {
    updated.day = 'Tomorrow';
  } else if (isToday) {
    updated.day = 'Today';
  } else if (isSaturday) {
    updated.day = 'Saturday';
  }

  // Explicit clinic slot or Morning / Evening match
  const explicitSlotMatch = text.match(/\b(10:00\s*AM|11:30\s*AM|0?4:00\s*PM|0?5:30\s*PM)\b/i);
  if (explicitSlotMatch) {
    const raw = explicitSlotMatch[1].toUpperCase().replace(/\s+/g, ' ');
    updated.timeSlot = raw === '4:00 PM' ? '04:00 PM' : raw === '5:30 PM' ? '05:30 PM' : raw;
  } else if (/\b(?:morning|subah|sakale)\b/i.test(lower) || /ସକାଳ/.test(text) || /सुबह/.test(text)) {
    updated.timeSlot = 'Morning (10:30 AM)';
  } else if (/\b(?:evening|shaam|sandhya)\b/i.test(lower) || /ସନ୍ଧ୍ୟା/.test(text) || /शाम/.test(text)) {
    updated.timeSlot = 'Evening (05:30 PM)';
  }

  // Patient / Caller Name
  const nameMatch = text.match(/(?:(?:my\s+)?name\s+is|naam\s+hai|naa\s+moro|moro\s+naa|ମୋ\s+ନାଁ|ମୋ\s+ନାମ|नाम\s+है|নাম\s+হলো|নাম)\s+([\p{L}\p{M}]+)/iu);
  if (nameMatch && nameMatch[1]) {
    updated.patientName = nameMatch[1].trim();
  }

  // Order ID - whole token ORD-XXXXX (does not match 'border')
  const orderMatch = text.match(/\bORD-?\d+\b/i);
  if (orderMatch) {
    updated.orderId = orderMatch[0].toUpperCase();
  }

  // Rank with boundary
  const rankMatch = text.match(/\b(?:rank|cr)\s*[:=]?\s*(\d{3,6})\b/i);
  if (rankMatch && rankMatch[1]) {
    updated.rank = rankMatch[1];
  }

  return updated;
}

export function processTurn(input: ProcessTurnInput): ProcessTurnOutput {
  const { userInput, tenant, currentLanguage, callMemory } = input;
  const startTurnTimestamp = performance.now();

  // 1. Language Detection & Mid-call Switch
  const langAnalysis = detectLanguage(userInput, currentLanguage);
  const activeLang = langAnalysis.detected;
  const switched = langAnalysis.switched;

  // 2. Safety: Emergency Condition Check (Tenant-aware routing)
  const emergency = checkEmergencyCondition(userInput, activeLang, tenant);
  if (emergency) {
    const elapsedMs = Math.max(1, Math.round(performance.now() - startTurnTimestamp));
    return {
      spokenReply: emergency.emergencyMessage,
      detectedLanguage: activeLang,
      switchedLanguage: switched,
      shouldHandoff: true,
      handoffReason: emergency.actionRequired,
      isEmergency: true,
      updatedMemory: {
        ...callMemory,
        emergencyReported: emergency.symptomDetected || 'Critical symptom detected',
        escalationStatus: 'Emergency callback queued',
      },
      latencyBreakdown: {
        ragMs: 0,
        modelResponseMs: elapsedMs,
        totalTurnaroundMs: elapsedMs,
        mode: 'safety_fastpath',
        streaming: false,
      },
      detectedIntent: 'emergency_medical',
    };
  }

  // 3. Safety: Human Escalation / Frustration Check (Whole-word)
  const wantsHuman = checkHumanEscalationRequest(userInput);
  if (wantsHuman) {
    const elapsedMs = Math.max(1, Math.round(performance.now() - startTurnTimestamp));
    return {
      spokenReply: buildHumanEscalationReply(activeLang, tenant),
      detectedLanguage: activeLang,
      switchedLanguage: switched,
      shouldHandoff: true,
      handoffReason: `Callback requested for ${tenant.humanHandoffContact.department}`,
      updatedMemory: {
        ...callMemory,
        escalationReason: 'Requested human specialist',
        escalationStatus: 'Callback queued',
      },
      latencyBreakdown: {
        ragMs: 0,
        modelResponseMs: elapsedMs,
        totalTurnaroundMs: elapsedMs,
        mode: 'safety_fastpath',
        streaming: false,
      },
      detectedIntent: 'human_escalation',
    };
  }

  // 4. Memory & Entity Extraction
  const updatedMemory = extractEntitiesFromInput(userInput, callMemory);

  // Check if caller is confirming a pending action
  const isConfirmation = /\b(?:yes|confirm|proceed|ok|sure|thik|haan|ha|bilkul)\b/i.test(userInput) ||
    /ହଁ|ନିଶ୍ଚୟ|କରନ୍ତୁ|ହଁ ଆଜ୍ଞା/.test(userInput) ||
    /हाँ|बिल्कुल|कर दीजिए|पक्का/.test(userInput);

  // 5. Intent and Tool Execution Check
  const lowerInput = userInput.toLowerCase();
  let toolToInvoke: string | null = null;
  let toolParams: Record<string, any> = {};
  let detectedIntent = 'general_inquiry';
  let fillerUsed: string | undefined = undefined;

  // Clinic Intents
  if (tenant.category === 'clinic') {
    const isFeeOrPolicyQuery =
      /\b(?:fee|fees|cost|charge|charges|price|pricing|bsky|upi|payment)\b/i.test(lowerInput) ||
      /ଫି|ଟଙ୍କା|ଖର୍ଚ୍ଚ|ଦାମ୍|ଫିସ୍|ଫିସ|फीस|शुल्क|खर्च|টাকা|ফি/.test(userInput);

    const isBookingIntent =
      !isFeeOrPolicyQuery && (
        /\b(?:book|booking|appointment|consult|slot)\b/i.test(lowerInput) ||
        /ଆପଏଣ୍ଟମେଣ୍ଟ|ଦେଖା\b|ବୁକ୍|ସ୍ଲଟ/.test(userInput) ||
        /अपॉइंटमेंट|बुक|दिखाना|मुलाकात/.test(userInput)
      );

    if (isBookingIntent || (callMemory.pendingBooking && isConfirmation)) {
      detectedIntent = 'book_appointment';
      toolToInvoke = 'book_appointment';
      const resolvedSlot = updatedMemory.timeSlot
        ? updatedMemory.day
          ? `${updatedMemory.day} ${updatedMemory.timeSlot}`
          : /^(Morning|Evening)/.test(updatedMemory.timeSlot)
          ? `Tomorrow ${updatedMemory.timeSlot}`
          : updatedMemory.timeSlot
        : updatedMemory.day;
      toolParams = {
        doctor: updatedMemory.doctor,
        slot: resolvedSlot,
        patientName: updatedMemory.patientName,
        confirmed: isConfirmation && Boolean(callMemory.pendingAction === 'book_appointment'),
      };
      fillerUsed = getNaturalFiller(tenant, activeLang);
    } else if (
      /\b(?:timing|timings|hours|schedule|opd)\b/i.test(lowerInput) ||
      /ସମୟ|ସ୍ଲଟ|ଖୋଲା|ବନ୍ଦ/.test(userInput) ||
      /समय|घंटे|खुला/.test(userInput) ||
      /সময়|কখন|বসেন|সময়সূচি/.test(userInput)
    ) {
      detectedIntent = 'check_slots';
      toolToInvoke = 'check_slot_availability';
      toolParams = { doctor: updatedMemory.doctor };
      fillerUsed = getNaturalFiller(tenant, activeLang);
    }
  }

  // Logistics Intents (Use whole-word regexes to avoid "border" matching "order")
  if (tenant.category === 'logistics') {
    const isTrackIntent =
      /\b(?:track|tracking|shipment|parcel|package|delivery|courier|status)\b/i.test(lowerInput) ||
      (/\border\b/i.test(lowerInput) && !/\bborder\b/i.test(lowerInput)) ||
      /ଅର୍ଡର|ଟ୍ରାକ୍|ଡେଲିଭରି|କୋରିଅର/.test(userInput) ||
      /पार्सल|ट्रैक|डिलीवरी|ऑर्डर/.test(userInput);

    if (isTrackIntent) {
      detectedIntent = 'track_shipment';
      toolToInvoke = 'track_shipment';
      toolParams = { orderId: updatedMemory.orderId };
      fillerUsed = getNaturalFiller(tenant, activeLang);
    } else if (
      /\b(?:reschedule|change\s+date|change\s+time|postpone)\b/i.test(lowerInput) ||
      /ତାରିଖ|ସମୟ|ପରିବର୍ତ୍ତନ/.test(userInput)
    ) {
      detectedIntent = 'reschedule_delivery';
      toolToInvoke = 'reschedule_delivery';
      toolParams = {
        orderId: updatedMemory.orderId,
        newDate: updatedMemory.day || 'Tomorrow',
        confirmed: isConfirmation,
      };
      fillerUsed = getNaturalFiller(tenant, activeLang);
    }
  }

  // Coaching & Admissions Intents
  if (tenant.category === 'coaching' || tenant.category === 'university') {
    if (
      /\b(?:batch|classes|commence|schedule|course)\b/i.test(lowerInput) ||
      /ବ୍ୟାଚ୍|କ୍ଲାସ|କୋର୍ସ/.test(userInput) ||
      /बैच|कक्षा|शुरू/.test(userInput)
    ) {
      detectedIntent = 'batch_inquiry';
      toolToInvoke = 'check_batch_schedule';
      toolParams = { exam: /\bneet\b/i.test(lowerInput) ? 'NEET Medical' : 'JEE Main + Advanced' };
      fillerUsed = getNaturalFiller(tenant, activeLang);
    } else if (
      /\b(?:rank|cutoff|percentile|admission|counseling)\b/i.test(lowerInput) ||
      /ରାଙ୍କ|କଟଅଫ୍|ନାମଲେଖା/.test(userInput) ||
      /रैंक|कटऑफ|दाखिला/.test(userInput)
    ) {
      detectedIntent = 'cutoff_inquiry';
      toolToInvoke = 'check_branch_cutoff';
      toolParams = { rank: updatedMemory.rank, branch: 'Computer Science' };
      fillerUsed = getNaturalFiller(tenant, activeLang);
    }
  }

  let toolResult: any = undefined;
  if (toolToInvoke) {
    toolResult = executeTenantTool(toolToInvoke, toolParams, tenant.name, activeLang);
    if (toolResult.requiresConfirmation) {
      updatedMemory.pendingAction = toolToInvoke;
      updatedMemory.pendingBooking = 'true';
    } else if (toolResult.success && toolResult.data?.bookingRef) {
      updatedMemory.bookingRef = toolResult.data.bookingRef;
      delete updatedMemory.pendingAction;
      delete updatedMemory.pendingBooking;
    }
  }

  // 6. RAG Retrieval with strict relevance threshold
  const tRag0 = performance.now();
  const ragMatches = searchKnowledgeBase(userInput, tenant.knowledgeBase, 2, RELEVANCE_THRESHOLD);
  const ragMs = Math.max(5, Math.round(performance.now() - tRag0));
  const matchedChunk = ragMatches[0];

  // 7. Compose Spoken Reply
  let spokenReply: string;

  if (toolResult) {
    spokenReply = toolResult.outputMessage;
  } else if (matchedChunk && matchedChunk.score >= RELEVANCE_THRESHOLD) {
    // Return complete sentence excerpt from relevant knowledge document
    const excerpt = matchedChunk.excerpt || matchedChunk.chunk.content;
    if (activeLang === 'or') {
      spokenReply = `ଆମ କ୍ଲିନିକ ନିୟମ ଅନୁସାରେ: ${excerpt}। ଆଉ କିଛି ସୂଚନା ଦରକାର କି?`;
    } else if (activeLang === 'hi') {
      spokenReply = `हमारे नियमों के अनुसार: ${excerpt}। क्या आप कुछ और जानना चाहते हैं?`;
    } else if (activeLang === 'hinglish') {
      spokenReply = `As per our policy: ${excerpt}. Would you like more details on this?`;
    } else {
      spokenReply = `According to our policy: ${excerpt}. Can I assist you with anything else?`;
    }
  } else {
    // Honest Fallback - Tenant Specific, No Confident Hallucination
    const fallbackMessages: Record<string, Record<SupportedLanguage, string>> = {
      clinic: {
        or: 'ଦୟାକରି କ୍ଷମା କରିବେ, ଏହି ନିର୍ଦ୍ଦିଷ୍ଟ ବିଷୟରେ ମୋ ପାଖରେ ସଠିକ୍ ଡକ୍ୟୁମେଣ୍ଟ ତଥ୍ୟ ନାହିଁ। ଆପଣ କଣ ଡାକ୍ତରଙ୍କ ସମୟ ସମ୍ପର୍କରେ ପଚାରିବାକୁ ଚାହାଁନ୍ତି ନା ରିସେପ୍ସନିଷ୍ଟଙ୍କ ସହ କଥା ହେବେ?',
        hi: 'माफ़ कीजिए, इस विषय में मेरे पास सटीक जानकारी उपलब्ध नहीं है। क्या आप डॉक्टर के समय की जानकारी चाहते हैं या स्टाफ से संपर्क करना चाहेंगे?',
        hinglish: 'I am sorry, I do not have verified documents on that query. Would you like to check doctor timings or connect with clinic staff?',
        bn: 'দুঃখিত, এই বিষয়ে আমার কাছে পর্যাপ্ত তথ্য নেই। আপনি কি ডাক্তারের সময়সূচি জানতে চান নাকি রিসেপশনে কথা বলবেন?',
        en: 'I apologize, but I do not have documented information on that topic in our records. Would you like to check doctor timings or connect with our reception staff?',
      },
      logistics: {
        or: 'କ୍ଷମା କରିବେ, ମୁଁ ଏହା ଖୋଜି ପାରିଲି ନାହିଁ। ଦୟାକରି ଆପଣଙ୍କ ଟ୍ରାକିଂ ନମ୍ବର କୁହନ୍ତୁ କିମ୍ବା କଷ୍ଟମର କେୟାର ସହିତ ସଂଯୋଗ କରିବାକୁ କୁହନ୍ତୁ।',
        hi: 'माफ़ कीजिए, इसका विवरण रिकॉर्ड में नहीं मिला। कृपया अपना ट्रैकिंग नंबर बताएं या सहायता अधिकारी से बात करें।',
        hinglish: 'Sorry, I could not find records for that. Please share your tracking ID or let me know to connect with our support desk.',
        bn: 'দুঃখিত, তথ্য পাওয়া যায়নি। অনুগ্রহ করে আপনার ট্র্যাকিং নম্বর জানান।',
        en: 'I could not find matching records for that request. Please provide your tracking number or ask for human support.',
      },
      coaching: {
        or: 'ଏହି ବିଷୟରେ ଆମ ପାଖରେ ସୂଚନା ନାହିଁ। ଆପଣ କଣ ଜେଇଇ ବା ନିଟ୍ ବ୍ୟାଚ୍ ତାରିଖ ଜାଣିବାକୁ ଚାହାଁନ୍ତି?',
        hi: 'माफ़ कीजिए, यह विवरण उपलब्ध नहीं है। क्या आप जेईई या नीट बैच के बारे में जानना चाहते हैं?',
        hinglish: 'I do not have details on that in our records. Would you like to inquire about JEE or NEET batch schedules?',
        bn: 'এই তথ্যটি উপলব্ধ নেই। আপনি কি পরীক্ষার ব্যাচ সম্পর্কে জানতে চান?',
        en: 'I do not have verified details on that in our academy records. Would you like to ask about JEE or NEET batch timings?',
      },
      university: {
        or: 'ଏହି ସୂଚନା ଆମ ଆଡମିଶନ ରେକର୍ଡରେ ନାହିଁ। ଆପଣ କଣ କଟଅଫ୍ ବା ବ୍ରାଞ୍ଚ ସିଟ୍ ବିଷୟରେ ଜାଣିବାକୁ ଚାହାଁନ୍ତି?',
        hi: 'यह जानकारी हमारे दाखिला रिकॉर्ड में नहीं मिली। क्या आप कटऑफ या सीटों के बारे में पूछना चाहते हैं?',
        hinglish: 'I do not have records on that. Would you like to check entrance cutoffs or branch seat availability?',
        bn: 'এই তথ্যটি নথিতে পাওয়া যায়নি। আপনি কি কাটঅফ সম্পর্কে জানতে চান?',
        en: 'I do not have documented data on that in our admissions guide. Would you like to check cutoff ranks or branch details?',
      },
      custom: {
        or: 'ମୋ ପାଖରେ ଏହି ସୂଚନା ଉପଲବ୍ଧ ନାହିଁ। ମୁଁ ଆମ ଅଧିକାରୀଙ୍କ ସହିତ ସଂଯୋଗ କରିଦେବି କି?',
        hi: 'मेरे पास इस बारे में जानकारी नहीं है। क्या मैं आपकी बात हमारे अधिकारी से करा दूँ?',
        hinglish: 'I do not have that information in my documents. Shall I connect you with an officer?',
        bn: 'এই তথ্য আমার কাছে নেই। আমি কি কোনো কর্মকর্তার সাথে যোগাযোগ করিয়ে দেব?',
        en: 'I do not have documented information on that topic. Would you like me to request a human staff transfer?',
      },
    };

    const catFallback = fallbackMessages[tenant.category] || fallbackMessages.custom;
    spokenReply = catFallback[activeLang] || catFallback.en;
  }

  // Calculate actual execution times
  const totalTurnaroundMs = Math.max(1, Math.round(performance.now() - startTurnTimestamp));

  return {
    spokenReply,
    detectedLanguage: activeLang,
    switchedLanguage: switched,
    fillerUsed,
    toolResult,
    toolInvokedName: toolToInvoke || undefined,
    toolParams: toolToInvoke ? toolParams : undefined,
    shouldHandoff: false,
    updatedMemory,
    latencyBreakdown: {
      ragMs,
      modelResponseMs: Math.max(1, totalTurnaroundMs - ragMs),
      totalTurnaroundMs,
      mode: 'offline_demo',
      streaming: false,
    },
    detectedIntent,
  };
}
