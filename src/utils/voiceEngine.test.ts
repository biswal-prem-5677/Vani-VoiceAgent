import test from 'node:test';
import assert from 'node:assert';
import { detectLanguage } from './languageDetector';
import { searchKnowledgeBase, RELEVANCE_THRESHOLD, extractRelevantSentences } from './ragEngine';
import { executeTenantTool } from './tools';
import { checkEmergencyCondition, checkHumanEscalationRequest } from './safety';
import { extractEntitiesFromInput, processTurn } from './callPipeline';
import { calculatePercentiles } from './latencyTracker';
import { INITIAL_TENANTS } from '../data/tenants';

const clinicTenant = INITIAL_TENANTS[0];

test('Safety: Emergency detection correctly flags Odia chest pain and advises 112', () => {
  const input = 'ମୋ ବାପାଙ୍କର ଛାତିରେ ବହୁତ କଷ୍ଟ ହେଉଛି! ଶୀଘ୍ର ସାହାଯ୍ୟ କରନ୍ତୁ!';
  const result = checkEmergencyCondition(input, 'or');
  assert.ok(result !== null, 'Emergency should be detected');
  assert.strictEqual(result.isEmergency, true);
  assert.ok(result.emergencyMessage.includes('୧୧୨'), 'Should instruct to dial 112 in Odia');
  assert.ok(result.actionRequired.includes('Duty Medical Officer'));
});

test('Safety: Emergency detection flags Hindi and English critical symptoms', () => {
  const hindiInput = 'मरीज को सांस नहीं आ रही है और बेहोश हो गए हैं!';
  const hindiResult = checkEmergencyCondition(hindiInput, 'hi');
  assert.ok(hindiResult !== null);
  assert.strictEqual(hindiResult.isEmergency, true);

  const englishInput = 'My father is having severe chest pain and cannot breathe!';
  const englishResult = checkEmergencyCondition(englishInput, 'en');
  assert.ok(englishResult !== null);
  assert.strictEqual(englishResult.isEmergency, true);
  assert.ok(englishResult.emergencyMessage.includes('112'));
});

test('Substring bug fix: "kal" does NOT match inside "Kalinga"', () => {
  const memory = {};
  const extracted = extractEntitiesFromInput('Welcome to Kalinga Care Clinic in Bhubaneswar', memory);
  assert.strictEqual(extracted.day, undefined, '"Kalinga" must not set day to Tomorrow');

  // Verify that an actual standalone "kal" or "kali" DOES match Tomorrow
  const extractedTomorrow = extractEntitiesFromInput('I want to visit kal morning', memory);
  assert.strictEqual(extractedTomorrow.day, 'Tomorrow');
});

test('Substring bug fix: "order" does NOT match inside "border"', () => {
  const memory = {};
  const extracted = extractEntitiesFromInput('The shipment reached near border checkpost', memory);
  assert.strictEqual(extracted.orderId, undefined, '"border" must not extract an order ID');

  // Exact ORD-XXXXX must match
  const extractedOrder = extractEntitiesFromInput('My tracking code is ORD-98421', memory);
  assert.strictEqual(extractedOrder.orderId, 'ORD-98421');
});

test('Substring bug fix: "human" does NOT match inside "humanities"', () => {
  const isEscalation = checkHumanEscalationRequest('I am a student of humanities and history');
  assert.strictEqual(isEscalation, false, '"humanities" must not trigger human supervisor escalation');

  const realEscalation = checkHumanEscalationRequest('I want to speak with a human agent please');
  assert.strictEqual(realEscalation, true, 'Whole-word "human" must trigger escalation');
});

test('Tools: book_appointment fails when required parameters are missing', () => {
  // Empty parameters
  const result1 = executeTenantTool('book_appointment', {}, 'Kalinga Care Clinic', 'en');
  assert.strictEqual(result1.success, false);
  assert.ok(result1.missingParameters?.includes('doctor'));
  assert.ok(result1.missingParameters?.includes('slot'));
  assert.ok(result1.missingParameters?.includes('patientName'));

  // Missing patient name
  const result2 = executeTenantTool(
    'book_appointment',
    { doctor: 'Dr. Jena', slot: 'Tomorrow 10:30 AM' },
    'Kalinga Care Clinic',
    'en'
  );
  assert.strictEqual(result2.success, false);
  assert.ok(result2.missingParameters?.includes('patientName'));
});

test('Tools: book_appointment requires confirmation before confirming', () => {
  const unconfirmed = executeTenantTool(
    'book_appointment',
    { doctor: 'Dr. Jena (Cardiology)', slot: 'Tomorrow 10:30 AM', patientName: 'Alex' },
    'Kalinga Care Clinic',
    'en'
  );
  assert.strictEqual(unconfirmed.success, false);
  assert.strictEqual(unconfirmed.requiresConfirmation, true);

  const confirmed = executeTenantTool(
    'book_appointment',
    { doctor: 'Dr. Jena (Cardiology)', slot: 'Tomorrow 10:30 AM', patientName: 'Alex', confirmed: true },
    'Kalinga Care Clinic',
    'en'
  );
  assert.strictEqual(confirmed.success, true);
  assert.strictEqual(confirmed.data.status, 'Confirmed');
  assert.ok(confirmed.data.bookingRef.startsWith('KAL-APT-'));
});

test('Tools: track_shipment requires valid orderId and does NOT default', () => {
  const emptyOrder = executeTenantTool('track_shipment', {}, 'Konark Express', 'en');
  assert.strictEqual(emptyOrder.success, false);
  assert.ok(emptyOrder.missingParameters?.includes('orderId'));

  const validOrder = executeTenantTool('track_shipment', { orderId: 'ORD-98421' }, 'Konark Express', 'en');
  assert.strictEqual(validOrder.success, true);
  assert.strictEqual(validOrder.data.status, 'Out for delivery');
});

test('Retrieval: Irrelevant queries are filtered out by relevance threshold', () => {
  const query = 'Do you sell second-hand motorcycles and automotive rubber tires?';
  const results = searchKnowledgeBase(query, clinicTenant.knowledgeBase, 2, RELEVANCE_THRESHOLD);
  assert.strictEqual(results.length, 0, 'Unrelated query must return 0 results above threshold');
});

test('Retrieval: Cross-lingual query matches fee policy and returns whole sentence', () => {
  const query = 'ଡାକ୍ତର ଦେଖାଇବା ପାଇଁ ଫି କେତେ ଟଙ୍କା ଲାଗିବ?';
  const results = searchKnowledgeBase(query, clinicTenant.knowledgeBase, 2, RELEVANCE_THRESHOLD);
  assert.ok(results.length > 0, 'Should match clinic fee policy chunk');
  assert.ok(results[0].chunk.title.includes('Fees'));
  assert.ok(results[0].excerpt.includes('₹500'));
  // Ensure excerpt is not a raw chopped slice ending in mid-word
  assert.ok(results[0].excerpt.includes('.'), 'Sentence excerpt should contain complete sentence punctuation');
});

test('Metrics: calculatePercentiles computes real p50/p95 and handles empty input', () => {
  assert.strictEqual(calculatePercentiles([]).p50, 0);
  assert.strictEqual(calculatePercentiles([]).count, 0);

  const latencies = [120, 180, 240, 310, 420, 500, 620, 710, 840, 950];
  const stats = calculatePercentiles(latencies);
  assert.strictEqual(stats.count, 10);
  assert.strictEqual(stats.p50, 420);
  assert.strictEqual(stats.underOneSecondPercent, 100);
});
