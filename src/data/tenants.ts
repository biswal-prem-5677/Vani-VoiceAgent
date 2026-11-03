import { TenantConfig } from '../types';

export const INITIAL_TENANTS: TenantConfig[] = [
  {
    id: 'kalinga_clinic',
    name: 'Kalinga Care Clinic',
    tagline: 'Multi-specialty Clinic & Diagnostic Centre (Bhubaneswar)',
    category: 'clinic',
    primaryColor: '#059669', // Emerald
    accentColor: '#10b981',
    logoIcon: 'HeartPulse',
    agentName: 'Priya',
    voicePersona: {
      gender: 'female',
      speed: 1.05,
      pitch: 1.0,
      tone: 'Warm, reassuring, medical assistant tone',
      provider: 'Sarvam AI',
    },
    supportedLanguages: ['or', 'hi', 'en', 'hinglish'],
    defaultLanguage: 'or',
    systemPrompt: `You are Priya, the AI voice receptionist for Kalinga Care Clinic in Bhubaneswar. You speak fluent Odia, Hindi, and English. Keep responses under 2 sentences, spoken rhythm, never sound robotic. If user mentions booking an appointment, confirm doctor, day, and time. If user seems distressed or angry, offer immediate transfer to Dr. Mohapatra's duty desk.`,
    greetings: {
      or: 'ନମସ୍କାର! କଳିଙ୍ଗ କେୟାର କ୍ଲିନିକକୁ ସ୍ୱାଗତ। ମୁଁ ପ୍ରିୟା କହୁଛି, କେଉଁ ଡାକ୍ତରଙ୍କ ସହିତ ଆପଏଣ୍ଟମେଣ୍ଟ ଦରକାର?',
      hi: 'नमस्ते! कलिंगा केयर क्लिनिक में आपका स्वागत है। मैं प्रिया, आपकी क्या सहायता कर सकती हूँ?',
      hinglish: 'Namaste! Welcome to Kalinga Care Clinic. Main Priya hoon, kis doctor ke saath appointment book karna hai?',
      bn: 'নমস্কার! কলিঙ্গ কেয়ার ক্লিনিকে আপনাকে স্বাগতম। আমি কীভাবে সাহায্য করতে পারি?',
      en: 'Hello and welcome to Kalinga Care Clinic. I am Priya. How can I help you with appointments or doctor consultations today?',
    },
    fillers: {
      or: [
        'ହଁ ଆଜ୍ଞା, ମୁଁ ତୁରନ୍ତ ଡାକ୍ତରଙ୍କ ସମୟ ଦେଖୁଛି...',
        'ଟିକିଏ ଅପେକ୍ଷା କରନ୍ତୁ, ମୁଁ ସ୍ଲଟ ଯାଞ୍ଚ କରୁଛି...',
      ],
      hi: [
        'जी, मैं डॉक्टर साहब का स्लॉट अभी चेक करती हूँ...',
        'एक सेकंड रुकिए, मैं सिस्टम में देख रही हूँ...',
      ],
      hinglish: [
        'Ji sure, checking available slots for you right now...',
        'Ek minute, main schedule verify kar leti hoon...',
      ],
      bn: [
        'হ্যাঁ, আমি ডাক্তারবাবুর সময় এখনই দেখে নিচ্ছি...',
      ],
      en: [
        'Looking up the doctors schedule right now for you...',
        'One moment while I verify available time slots...',
      ],
    },
    knowledgeBase: [
      {
        id: 'kc_1',
        title: 'Doctor Specialty & Schedules',
        content: 'Dr. Jena (Cardiology) sits Monday to Saturday 10:00 AM to 1:00 PM. Dr. Mishra (Pediatrics) sits Monday, Wednesday, Friday 4:00 PM to 8:00 PM. Dr. Mohapatra (General Medicine) sits daily 9:00 AM to 5:00 PM.',
        category: 'Doctors & OPD',
        tags: ['dr jena', 'dr mishra', 'dr mohapatra', 'cardiology', 'pediatrics', 'timings'],
        addedAt: '2026-10-15',
      },
      {
        id: 'kc_2',
        title: 'Consultation Fees & Payment',
        content: 'Consultation fee for specialist OPD is ₹500. Follow-up visits within 7 days are complimentary. We accept UPI, Cash, Cards, and BSKY / PMJAY cashless cards.',
        category: 'Billing',
        tags: ['fee', 'bsky', 'pmjay', 'charges', 'payment', 'upi'],
        addedAt: '2026-10-15',
      },
      {
        id: 'kc_3',
        title: 'Sunday & Emergency OPD',
        content: 'Routine outpatient OPD is closed on Sundays. However, 24/7 emergency casualty and pathology blood sample collection remain open round the clock.',
        category: 'Timings',
        tags: ['sunday', 'emergency', 'casualty', 'blood test', 'pathology'],
        addedAt: '2026-10-15',
      },
    ],
    tools: [
      {
        id: 't_apt',
        name: 'book_appointment',
        displayName: 'Book Clinic Appointment',
        description: 'Books a patient consultation slot with chosen doctor and returns booking reference.',
        parameters: [
          { name: 'doctor', type: 'string', description: 'Name of the doctor', required: true },
          { name: 'slot', type: 'string', description: 'Date and time for appointment', required: true },
          { name: 'patientName', type: 'string', description: 'Full name of patient', required: true },
        ],
        handlerType: 'mock_appointment',
      },
      {
        id: 't_slot',
        name: 'check_slot_availability',
        displayName: 'Check Doctor Slots',
        description: 'Checks real-time vacant appointments for today or tomorrow.',
        parameters: [
          { name: 'doctor', type: 'string', description: 'Doctor or department name', required: true },
        ],
        handlerType: 'mock_appointment',
      },
    ],
    humanHandoffContact: {
      department: 'Senior Medical Reception & Duty Officer',
      phone: '+91-674-2598110',
      email: 'opd@kalingacare.org',
    },
  },
  {
    id: 'pragati_coaching',
    name: 'Pragati Coaching Academy',
    tagline: 'Premier JEE & NEET Coaching Institute (Cuttack)',
    category: 'coaching',
    primaryColor: '#7c3aed', // Purple
    accentColor: '#8b5cf6',
    logoIcon: 'GraduationCap',
    agentName: 'Soumya',
    voicePersona: {
      gender: 'male',
      speed: 1.02,
      pitch: 0.98,
      tone: 'Energetic, motivational academic mentor',
      provider: 'Sarvam AI',
    },
    supportedLanguages: ['or', 'en', 'hinglish', 'hi'],
    defaultLanguage: 'or',
    systemPrompt: `You are Soumya, admission counselor at Pragati Coaching Academy, Cuttack. Help students and parents with batch schedules, demo classes, and entrance test fees in fluent Odia, Hinglish, or English. Keep answers under 2 sentences.`,
    greetings: {
      or: 'ନମସ୍କାର! ପ୍ରଗତି ଏକାଡେମୀ କଟକକୁ ସ୍ୱାଗତ। ମୁଁ ସୌମ୍ୟ। ଜେଇଇ ବା ନିଟ୍ ବ୍ୟାଚ୍ ବିଷୟରେ କଣ ଜାଣିବାକୁ ଚାହାଁନ୍ତି?',
      hi: 'नमस्ते! प्रगति कोचिंग एकेडमी कटक में आपका स्वागत है। क्या आप JEE या NEET बैच की जानकारी चाहते हैं?',
      hinglish: 'Hello! Pragati Academy Cuttack mein aapka welcome hai. Main Soumya hoon, JEE ya NEET demo class ke baare mein help chahiye?',
      bn: 'নমস্কার! প্রগতি একাডেমিতে স্বাগতম। আপনি কোন ক্লাসের তথ্য জানতে চান?',
      en: 'Hello! Welcome to Pragati Coaching Academy. I am Soumya. Are you inquiring about our upcoming JEE or NEET foundation batches?',
    },
    fillers: {
      or: [
        'ହଁ, ମୁଁ ବ୍ୟାଚ୍ ଟାଇମିଂ ଏବେ ଦେଖି କହୁଛି...',
        'ଟିକିଏ ରୁହନ୍ତୁ, ସିଲାବସ୍ ଓ ଫି ତଥ୍ୟ ଯାଞ୍ଚ କରୁଛି...',
      ],
      hi: [
        'जी, मैं बैच शेड्यूल अभी चेक कर रहा हूँ...',
      ],
      hinglish: [
        'One sec, let me pull up the batch schedule and scholarship seats...',
      ],
      bn: [
        'একটু অপেক্ষা করুন, আমি ব্যাচ টাইম দেখে বলছি...',
      ],
      en: [
        'Sure, let me check the academic batch calendar for you...',
      ],
    },
    knowledgeBase: [
      {
        id: 'pc_1',
        title: 'JEE / NEET Batches & Timings',
        content: '2-Year Target Batch for 11th/12th students starts every Monday. Morning batch: 7:00 AM - 11:30 AM; Evening batch: 4:30 PM - 8:30 PM. Weekend test series included.',
        category: 'Batches',
        tags: ['jee', 'neet', 'timings', 'target batch', 'schedule'],
        addedAt: '2026-10-18',
      },
      {
        id: 'pc_2',
        title: 'Fee Structure & Scholarship Test',
        content: 'Annual course fee is ₹45,000. Students scoring above 85% in our Pragati Talent Hunt Exam get up to 50% fee concession. Free demo classes for 3 days.',
        category: 'Fees & Scholarships',
        tags: ['fee', 'scholarship', 'talent hunt', 'discount', 'demo'],
        addedAt: '2026-10-18',
      },
    ],
    tools: [
      {
        id: 't_batch',
        name: 'check_batch_schedule',
        displayName: 'Check Batch & Demo Seats',
        description: 'Returns available seats for demo lecture and batch starting date.',
        parameters: [
          { name: 'exam', type: 'string', description: 'Target exam (JEE or NEET)', required: true },
        ],
        handlerType: 'mock_admission',
      },
    ],
    humanHandoffContact: {
      department: 'Academic Director & Admissions Cell',
      phone: '+91-671-2489020',
      email: 'admissions@pragatics.edu',
    },
  },
  {
    id: 'konark_logistics',
    name: 'Konark Express Retail & Logistics',
    tagline: 'Hyperlocal Logistics & E-commerce Hub (Rourkela)',
    category: 'logistics',
    primaryColor: '#d97706', // Amber
    accentColor: '#f59e0b',
    logoIcon: 'Truck',
    agentName: 'Rahul',
    voicePersona: {
      gender: 'male',
      speed: 1.08,
      pitch: 1.0,
      tone: 'Crisp, fast, customer delight agent',
      provider: 'Sarvam AI',
    },
    supportedLanguages: ['hinglish', 'hi', 'or', 'en'],
    defaultLanguage: 'hinglish',
    systemPrompt: `You are Rahul, voice assistant for Konark Express Logistics. Answer parcel tracking, delivery address change, and returns in natural Hinglish, Hindi, Odia, or English. Always confirm order ID.`,
    greetings: {
      hinglish: 'Hello! Konark Express Logistics mein aapka swagat hai. Apna tracking ya order number batayein?',
      hi: 'नमस्ते! कोणार्क एक्सप्रेस लॉजिस्टिक्स में आपका स्वागत है। अपना आर्डर नंबर बताइये?',
      or: 'ନମସ୍କାର! କୋଣାର୍କ ଏକ୍ସପ୍ରେସ୍ ଲଜିଷ୍ଟିକ୍ସକୁ ସ୍ୱାଗତ। ଆପଣଙ୍କ ଅର୍ଡର ଟ୍ରାକ୍ କରିବା ପାଇଁ ଅର୍ଡର ନମ୍ବର କୁହନ୍ତୁ?',
      bn: 'নমস্কার! আপনার পার্সেল ট্র্যাকিং নম্বরটি বলুন?',
      en: 'Hello! Thank you for calling Konark Express Logistics. May I have your order or tracking number?',
    },
    fillers: {
      hinglish: [
        'Ek second, live courier location check kar raha hoon...',
        'Hold kijiye, Bluedart aur delivery hub se sync kar raha hoon...',
      ],
      hi: [
        'जी, मैं पार्सल का लाइव स्टेटस देख रहा हूँ...',
      ],
      or: [
        'ହଁ, ମୁଁ ତୁରନ୍ତ ଆପଣଙ୍କ ପାର୍ସେଲର ଷ୍ଟାଟସ୍ ଦେଖୁଛି...',
      ],
      bn: [
        'একটু অপেক্ষা করুন, পার্সেল কোথায় আছে দেখছি...',
      ],
      en: [
        'One moment while I fetch your real-time courier tracking...',
      ],
    },
    knowledgeBase: [
      {
        id: 'kl_1',
        title: 'Delivery Windows & COD Rules',
        content: 'Deliveries run Monday to Saturday 8:00 AM to 7:00 PM. Cash on Delivery (COD) requires exact cash or QR code scan at doorstep. Return window is 7 days from delivery.',
        category: 'Delivery Policy',
        tags: ['cod', 'delivery timing', 'cash', 'qr code', 'returns'],
        addedAt: '2026-10-10',
      },
    ],
    tools: [
      {
        id: 't_track',
        name: 'track_shipment',
        displayName: 'Track Live Shipment',
        description: 'Queries live courier partner status and ETA.',
        parameters: [
          { name: 'orderId', type: 'string', description: 'Order ID (e.g. ORD-58219)', required: true },
        ],
        handlerType: 'mock_order',
      },
      {
        id: 't_reschedule',
        name: 'reschedule_delivery',
        displayName: 'Reschedule Delivery Date',
        description: 'Changes delivery date to tomorrow or custom slot.',
        parameters: [
          { name: 'orderId', type: 'string', description: 'Order ID', required: true },
          { name: 'newDate', type: 'string', description: 'New requested delivery date', required: true },
        ],
        handlerType: 'mock_order',
      },
    ],
    humanHandoffContact: {
      department: 'Logistics Escalations Desk',
      phone: '+91-661-2641920',
      email: 'support@konarkexpress.in',
    },
  },
  {
    id: 'utkal_university',
    name: 'Utkal Tech Admissions Helpdesk',
    tagline: 'State Technical University Campus Helpline',
    category: 'university',
    primaryColor: '#0284c7', // Sky blue
    accentColor: '#38bdf8',
    logoIcon: 'Landmark',
    agentName: 'Ananya',
    voicePersona: {
      gender: 'female',
      speed: 1.0,
      pitch: 1.04,
      tone: 'Clear, polite, academic administrator',
      provider: 'Google Cloud TTS',
    },
    supportedLanguages: ['en', 'or', 'hi', 'bn'],
    defaultLanguage: 'en',
    systemPrompt: `You are Ananya, technical voice counselor for Utkal Tech Admissions. Assist applicants with rank cutoffs, hostel facilities, and OJEE counseling details.`,
    greetings: {
      en: 'Hello and welcome to Utkal Tech Admissions Helpline. How may I guide you regarding courses and cutoffs?',
      or: 'ନମସ୍କାର! ଉତ୍କଳ ଟେକ୍ ଆଡମିଶନ ହେଲ୍ପଲାଇନକୁ ସ୍ୱାଗତ। କେଉଁ ବ୍ରାଞ୍ଚ ବା କଟଅଫ୍ ବିଷୟରେ ଜାଣିବାକୁ ଚାହାଁନ୍ତି?',
      hi: 'नमस्ते! उत्कल टेक एडमिशन्स में आपका स्वागत है। आप किस ब्रांच की कटऑफ जानना चाहते हैं?',
      hinglish: 'Hello! Utkal Tech Admissions helpline mein aapka welcome hai. Rank ya cutoff ke baare mein guide karoon?',
      bn: 'নমস্কার! উৎকল টেক অ্যাডমিশনে স্বাগতম। আপনি কোন ডিপার্টমেন্টের ব্যাপারে জানতে চান?',
    },
    fillers: {
      en: ['Checking the official OJEE cutoff archives for you...'],
      or: ['ଟିକିଏ ଅପେକ୍ଷା କରନ୍ତୁ, କାଉନସେଲିଂ ତାଲିକା ଯାଞ୍ଚ କରୁଛି...'],
      hi: ['एक मिनट, मैं कटऑफ लिस्ट देख रही हूँ...'],
      hinglish: ['Checking last year rank closing list...'],
      bn: ['একটু অপেক্ষা করুন, কাউন্সিলিং লিস্ট দেখছি...'],
    },
    knowledgeBase: [
      {
        id: 'uu_1',
        title: 'B.Tech Cutoffs & Eligibility',
        content: 'B.Tech Computer Science general category cutoff was Rank 18,500. Electronics is Rank 34,000. 100% tuition fee waiver (TFW) available for top 5% rank holders.',
        category: 'Cutoffs',
        tags: ['cse', 'cutoff', 'tfw', 'fees', 'scholarship', 'rank'],
        addedAt: '2026-10-12',
      },
    ],
    tools: [
      {
        id: 't_cutoff',
        name: 'check_branch_cutoff',
        displayName: 'Check OJEE / JEE Cutoff',
        description: 'Validates applicant rank against previous year closing cutoff.',
        parameters: [
          { name: 'rank', type: 'number', description: 'Applicant rank', required: true },
          { name: 'branch', type: 'string', description: 'Desired engineering discipline', required: true },
        ],
        handlerType: 'mock_admission',
      },
    ],
    humanHandoffContact: {
      department: 'Dean of Academic Counseling',
      phone: '+91-674-2580320',
      email: 'dean.admissions@utkaltech.ac.in',
    },
  },
];
