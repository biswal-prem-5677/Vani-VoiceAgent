import type { SupportedLanguage } from '../types/index.ts';

export interface ToolExecutionResult {
  success: boolean;
  toolName: string;
  outputMessage: string;
  data: Record<string, any>;
  missingParameters?: string[];
  requiresConfirmation?: boolean;
  confirmationPrompt?: string;
}

// Sample database of known shipments for prototype demonstration
const KNOWN_SHIPMENTS: Record<string, { status: string; courier: string; eta: string; destination: string }> = {
  'ORD-98421': { status: 'Out for delivery', courier: 'Bluedart Express', eta: 'Today by 4:00 PM', destination: 'Bhubaneswar' },
  'ORD-58219': { status: 'In Transit at Cuttack Hub', courier: 'DTDC Logistics', eta: 'Tomorrow by 11:00 AM', destination: 'Cuttack' },
  'ORD-10024': { status: 'Delivered', courier: 'Delhivery', eta: 'Yesterday at 3:15 PM', destination: 'Rourkela' },
};

export interface ToolExecutionOptions {
  availableSlots?: string[];
  bookingRef?: string;
}

export function executeTenantTool(
  toolName: string,
  parameters: Record<string, any>,
  tenantName: string,
  lang: SupportedLanguage = 'en',
  options?: ToolExecutionOptions
): ToolExecutionResult {
  switch (toolName) {
    case 'book_appointment': {
      const missing: string[] = [];
      if (!parameters.doctor || typeof parameters.doctor !== 'string' || !parameters.doctor.trim()) {
        missing.push('doctor');
      }
      if (!parameters.slot || typeof parameters.slot !== 'string' || !parameters.slot.trim()) {
        missing.push('slot');
      }
      if (!parameters.patientName || typeof parameters.patientName !== 'string' || !parameters.patientName.trim()) {
        missing.push('patientName');
      }

      if (missing.length > 0) {
        let prompt = 'To proceed with booking, I still need: ' + missing.join(', ') + '.';
        if (lang === 'or') {
          prompt = `ଆପଏଣ୍ଟମେଣ୍ଟ ବୁକ୍ କରିବା ପାଇଁ ଦୟାକରି ଏହି ସୂଚନା ଦିଅନ୍ତୁ: ${missing.map(m => m === 'doctor' ? 'ଡାକ୍ତରଙ୍କ ନାମ' : m === 'slot' ? 'ସମୟ/ସ୍ଲଟ' : 'ରୋଗୀଙ୍କ ନାମ').join(', ')}।`;
        } else if (lang === 'hi') {
          prompt = `अपॉइंटमेंट बुक करने के लिए कृपया जानकारी बताएं: ${missing.map(m => m === 'doctor' ? 'डॉक्टर का नाम' : m === 'slot' ? 'समय/तारीख' : 'मरीज का नाम').join(', ')}।`;
        }
        return {
          success: false,
          toolName,
          outputMessage: prompt,
          missingParameters: missing,
          data: { parametersReceived: parameters },
        };
      }

      // Check if user confirmed the booking
      if (!parameters.confirmed) {
        const confirmMsg = lang === 'or'
          ? `ମୁଁ ${parameters.doctor}ଙ୍କ ସହିତ ${parameters.slot} ସମୟରେ ${parameters.patientName}ଙ୍କ ପାଇଁ ଆପଏଣ୍ଟମେଣ୍ଟ ସୂଚନା ପାଇଲି। ମୁଁ ଏହା ନିଶ୍ଚିତ (Confirm) କରିବି କି?`
          : lang === 'hi'
          ? `मैंने ${parameters.patientName} के लिए ${parameters.doctor} के साथ ${parameters.slot} की जानकारी दर्ज की है। क्या मैं यह अपॉइंटमेंट पक्का कर दूँ?`
          : `I have noted the appointment with ${parameters.doctor} on ${parameters.slot} for ${parameters.patientName}. Shall I confirm and proceed with booking?`;

        return {
          success: false,
          toolName,
          outputMessage: confirmMsg,
          requiresConfirmation: true,
          confirmationPrompt: confirmMsg,
          data: { pendingBooking: { doctor: parameters.doctor, slot: parameters.slot, patientName: parameters.patientName } },
        };
      }

      // Proceed with confirmed booking
      const bookingRef = options?.bookingRef || `KAL-APT-${Math.floor(1000 + Math.random() * 9000)}`;
      const successMsg = lang === 'or'
        ? `ଆପଣଙ୍କର ${parameters.doctor}ଙ୍କ ସହିତ ${parameters.slot}ରେ ଆପଏଣ୍ଟମେଣ୍ଟ ସଫଳତାର ସହିତ ବୁକ୍ ହୋଇଗଲା। ଆପଣଙ୍କ ବୁକିଂ ରେଫରେନ୍ସ ନମ୍ବର: ${bookingRef}।`
        : lang === 'hi'
        ? `आपका अपॉइंटमेंट ${parameters.doctor} के साथ ${parameters.slot} के लिए पक्का हो गया है। बुकिंग संदर्भ: ${bookingRef}।`
        : `Appointment confirmed with ${parameters.doctor} for ${parameters.patientName} on ${parameters.slot}. Booking Ref: ${bookingRef}.`;

      return {
        success: true,
        toolName,
        outputMessage: successMsg,
        data: {
          bookingRef,
          doctor: parameters.doctor,
          slot: parameters.slot,
          patientName: parameters.patientName,
          status: 'Confirmed',
        },
      };
    }

    case 'check_slot_availability': {
      const doctor = parameters.doctor?.trim();
      const slots = options?.availableSlots ?? ['10:00 AM', '11:30 AM', '04:00 PM', '05:30 PM'];
      const targetDoc = doctor || 'General OPD';

      if (slots.length === 0) {
        const emptyMsg = lang === 'or'
          ? `${targetDoc}ଙ୍କ ପାଇଁ ଆଜି ଆଉ କୌଣସି ଖାଲି ସ୍ଲଟ ନାହିଁ। ଦୟାକରି ଆସନ୍ତାକାଲି ପାଇଁ ଚେଷ୍ଟା କରନ୍ତୁ।`
          : lang === 'hi'
          ? `${targetDoc} के लिए आज कोई स्लॉट खाली नहीं है। कृपया अगले दिन का समय जांचें।`
          : `${targetDoc} has no remaining open slots today. Please ask for tomorrow or another doctor.`;

        return {
          success: true,
          toolName,
          outputMessage: emptyMsg,
          data: { doctor: targetDoc, availableSlots: [] },
        };
      }

      const msg = lang === 'or'
        ? `${targetDoc}ଙ୍କ ପାଇଁ ଆଜି ଉପଲବ୍ଧ ସ୍ଲଟ: ${slots.join(', ')}।`
        : lang === 'hi'
        ? `${targetDoc} के लिए आज के उपलब्ध स्लॉट: ${slots.join(', ')}।`
        : `${targetDoc} has available slots at: ${slots.join(', ')}.`;

      return {
        success: true,
        toolName,
        outputMessage: msg,
        data: { doctor: targetDoc, availableSlots: slots },
      };
    }

    case 'track_shipment': {
      const orderId = parameters.orderId?.toString().trim().toUpperCase();
      if (!orderId) {
        const msg = lang === 'or'
          ? 'ଅର୍ଡର ଟ୍ରାକ୍ କରିବା ପାଇଁ ଦୟାକରି ଆପଣଙ୍କ ଅର୍ଡର ବା ଟ୍ରାକିଂ ନମ୍ବର (ଯେପରିକି ORD-98421) କୁହନ୍ତୁ।'
          : lang === 'hi'
          ? 'ऑर्डर ट्रैक करने के लिए कृपया अपना ऑर्डर आईडी (जैसे ORD-98421) बताएं।'
          : 'Please provide your order or tracking ID (e.g., ORD-98421) to check delivery status.';
        return {
          success: false,
          toolName,
          outputMessage: msg,
          missingParameters: ['orderId'],
          data: {},
        };
      }

      const match = KNOWN_SHIPMENTS[orderId];
      if (match) {
        const msg = lang === 'or'
          ? `ଅର୍ଡର ${orderId} ର ଷ୍ଟାଟସ୍: ${match.status} (${match.courier})। ସମ୍ଭାବ୍ୟ ପହଞ୍ଚିବା ସମୟ: ${match.eta}।`
          : lang === 'hi'
          ? `ऑर्डर ${orderId} का स्टेटस: ${match.status} (${match.courier})। अपेक्षित डिलीवरी: ${match.eta}।`
          : `Order ${orderId} status: ${match.status} via ${match.courier}. Estimated delivery: ${match.eta}.`;
        return {
          success: true,
          toolName,
          outputMessage: msg,
          data: { orderId, ...match },
        };
      }

      // Not in demo database
      const notFoundMsg = lang === 'or'
        ? `ଆମ ରେକର୍ଡରେ ଅର୍ଡର ନମ୍ବର ${orderId} ମିଳିଲା ନାହିଁ। ଦୟାକରି ଆପଣଙ୍କ ସଠିକ୍ ଅର୍ଡର ନମ୍ବର ଯାଞ୍ଚ କରି ପୁନର୍ବାର କୁହନ୍ତୁ।`
        : lang === 'hi'
        ? `हमारे सिस्टम में ऑर्डर संख्या ${orderId} नहीं मिली। कृपया अपनी रसीद से नंबर जांच कर पुनः बताएं।`
        : `Order ${orderId} was not found in our delivery records. Please verify the order number.`;

      return {
        success: false,
        toolName,
        outputMessage: notFoundMsg,
        data: { orderId, status: 'Not Found' },
      };
    }

    case 'reschedule_delivery': {
      const orderId = parameters.orderId?.toString().trim().toUpperCase();
      const newDate = parameters.newDate?.toString().trim();

      if (!orderId || !newDate) {
        const missing = [!orderId ? 'orderId' : '', !newDate ? 'newDate' : ''].filter(Boolean);
        return {
          success: false,
          toolName,
          outputMessage: `Please provide your ${missing.join(' and ')} to reschedule.`,
          missingParameters: missing,
          data: {},
        };
      }

      if (!parameters.confirmed) {
        return {
          success: false,
          toolName,
          outputMessage: `Would you like to confirm rescheduling delivery for order ${orderId} to ${newDate}?`,
          requiresConfirmation: true,
          confirmationPrompt: `Confirm rescheduling order ${orderId} to ${newDate}?`,
          data: { orderId, newDate },
        };
      }

      return {
        success: true,
        toolName,
        outputMessage: `Delivery for ${orderId} has been rescheduled to ${newDate}.`,
        data: { orderId, newDate, status: 'Rescheduled' },
      };
    }

    case 'check_batch_schedule': {
      const exam = parameters.exam?.trim() || 'JEE Main';
      return {
        success: true,
        toolName,
        outputMessage: `New batch for ${exam} commences this Monday. Class timings: 4:30 PM to 8:00 PM. Limited demo seats vacant.`,
        data: { exam, batchStart: 'This Monday' },
      };
    }

    case 'check_branch_cutoff': {
      const rank = Number(parameters.rank);
      if (isNaN(rank) || rank <= 0) {
        return {
          success: false,
          toolName,
          outputMessage: 'Please provide your entrance rank or percentile score to check branch eligibility.',
          missingParameters: ['rank'],
          data: {},
        };
      }
      const branch = parameters.branch || 'Computer Science';
      const cutoff = 18500;
      const eligible = rank <= cutoff;
      return {
        success: true,
        toolName,
        outputMessage: `For Rank ${rank}, last year's cutoff for ${branch} was ${cutoff}. Eligibility: ${eligible ? 'Eligible for Round 1' : 'Check Round 2 or other branches'}.`,
        data: { rank, branch, eligible, cutoff },
      };
    }

    default:
      return {
        success: false,
        toolName,
        outputMessage: `Unsupported or unauthorized tool "${toolName}" for ${tenantName}.`,
        data: { error: 'UNKNOWN_TOOL' },
      };
  }
}
