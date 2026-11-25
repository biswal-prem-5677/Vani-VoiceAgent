import type { DocumentChunk } from '../types/index.ts';

export interface SearchResult {
  chunk: DocumentChunk;
  score: number;
  matchedTerms: string[];
  excerpt: string;
}

export const RELEVANCE_THRESHOLD = 0.28;

// Cross-lingual semantic dictionary for Indic queries against English or bilingual documents
const CROSS_LINGUAL_SYNONYMS: Record<string, string[]> = {
  // Medical & Clinic
  'ଫି': ['fee', 'consultation', 'charge', 'cost', '₹500', 'upi', 'bsky'],
  'ଫିସ୍': ['fee', 'consultation', 'charge', 'cost', 'pricing'],
  'ଟଙ୍କା': ['fee', 'rupees', 'cost', 'payment', 'cash', 'upi'],
  'ଦେଖାଇବା': ['consult', 'opd', 'appointment', 'visit', 'doctor'],
  'ରବିବାର': ['sunday', 'weekend', 'emergency', 'closed', 'holiday'],
  'ସମୟ': ['timings', 'hours', 'schedule', 'am', 'pm', 'open'],
  'ଡାକ୍ତର': ['doctor', 'physician', 'specialist', 'jena', 'mishra', 'mohapatra'],
  'ଫିସ': ['fee', 'fees', 'charges', 'consultation'],
  'फीस': ['fee', 'fees', 'charges', 'cost', 'payment', 'upi'],
  'रविवार': ['sunday', 'weekend', 'opd', 'timing'],
  'समय': ['timing', 'hours', 'schedule', 'daily'],
  'डॉक्टर': ['doctor', 'physician', 'specialist'],
  'টাকা': ['fee', 'cost', 'charge'],
  'ফি': ['fee', 'consultation'],
  'সময়': ['timing', 'schedule', 'hours'],

  // Coaching & Admissions
  'କଟଅଫ୍': ['cutoff', 'rank', 'percentile', 'selection'],
  'ରାଙ୍କ': ['rank', 'cr', 'score', 'marks'],
  'ନାମଲେଖା': ['admission', 'enrollment', 'batch', 'seat'],
  'ବ୍ୟାଚ୍': ['batch', 'classes', 'commence', 'schedule'],
  'कटऑफ': ['cutoff', 'rank', 'merit', 'score'],
  'रैंक': ['rank', 'jee', 'neet', 'cutoff'],
  'दाखिला': ['admission', 'registration', 'eligibility'],

  // Logistics & Commerce
  'ଫେରସ୍ତ': ['refund', 'return', 'policy', 'days'],
  'ବାତିଲ': ['cancel', 'cancellation', 'charges'],
  'ଡେଲିଭରି': ['delivery', 'courier', 'shipping', 'transit', 'eta'],
  'ଅର୍ଡର': ['order', 'tracking', 'package', 'parcel'],
  'पार्सल': ['parcel', 'package', 'courier', 'tracking'],
  'वापसी': ['return', 'refund', 'replacement'],
  'रिफंड': ['refund', 'bank', 'account', 'days'],
};

const STOP_WORDS = new Set([
  'and', 'or', 'the', 'is', 'in', 'to', 'of', 'for', 'a', 'an', 'at', 'by', 'do',
  'you', 'we', 'here', 'with', 'from', 'our', 'it', 'on', 'this', 'that', 'are',
  'was', 'were', 'be', 'can', 'sell', 'buy',
  // Indic stop words
  'କଣ', 'ର', 'କୁ', 'ରେ', 'କି', 'ହେଉଛି', 'ନାହିଁ', 'ମୁଁ', 'ଆମ', 'କରିବା', 'ହେବ', 'କିପରି', 'କରି',
  'का', 'के', 'की', 'है', 'हैं', 'में', 'से', 'को', 'और', 'या', 'पर', 'यहाँ', 'क्या',
  'এবং', 'বা', 'এর', 'কে', 'তে', 'হয়', 'আছে',
]);

/**
 * Tokenizes text into distinct clean whole tokens, filtering common stop words.
 * Handles English, Odia, Hindi, and Bengali alphabets.
 */
export function extractTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\p{L}\p{M}]/gu, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Extracts complete sentences containing matched terms instead of arbitrary character slicing.
 */
export function extractRelevantSentences(content: string, matchedTerms: string[], maxSentences = 2): string {
  if (!content) return '';

  // Split on sentence terminators (., !, ?, and Indic danda ।)
  const rawSentences = content
    .split(/(?<=[.!?।])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (rawSentences.length <= 1) return content.trim();

  const termSet = new Set(matchedTerms.map(t => t.toLowerCase()));
  const scoredSentences: { sentence: string; score: number }[] = [];

  for (const sentence of rawSentences) {
    const sTokens = extractTokens(sentence);
    let matchCount = 0;
    for (const t of sTokens) {
      if (termSet.has(t)) matchCount++;
    }
    scoredSentences.push({ sentence, score: matchCount });
  }

  // Filter sentences that contain at least one matched term
  const hits = scoredSentences.filter(s => s.score > 0);
  if (hits.length > 0) {
    return hits
      .slice(0, maxSentences)
      .map(h => h.sentence)
      .join(' ');
  }

  // Default to first 2 whole sentences
  return rawSentences.slice(0, maxSentences).join(' ');
}

/**
 * Whole-token matching knowledge base search with cross-lingual synonym boosting
 * and strict relevance thresholding.
 */
export function searchKnowledgeBase(
  query: string,
  chunks: DocumentChunk[],
  topK = 2,
  minThreshold = RELEVANCE_THRESHOLD
): SearchResult[] {
  if (!query || chunks.length === 0) return [];

  const queryTokens = extractTokens(query);
  if (queryTokens.length === 0) return [];

  // Expand query tokens with cross-lingual synonyms
  const expandedTokens = new Set<string>(queryTokens);
  for (const token of queryTokens) {
    const synonyms = CROSS_LINGUAL_SYNONYMS[token];
    if (synonyms) {
      for (const syn of synonyms) {
        expandedTokens.add(syn.toLowerCase());
      }
    }
  }

  const results: SearchResult[] = [];

  for (const chunk of chunks) {
    // Build token sets for chunk components to guarantee whole-token matching
    const titleTokens = new Set(extractTokens(chunk.title));
    const contentTokens = new Set(extractTokens(chunk.content));
    const tagTokens = new Set(chunk.tags.flatMap(t => extractTokens(t)));
    const categoryTokens = new Set(extractTokens(chunk.category));

    let score = 0;
    const matchedTerms: string[] = [];

    for (const token of expandedTokens) {
      let tokenMatched = false;

      // Exact whole token matching (never substring "kal" inside "Kalinga")
      if (titleTokens.has(token)) {
        score += 3.0;
        tokenMatched = true;
      }
      if (tagTokens.has(token)) {
        score += 2.5;
        tokenMatched = true;
      }
      if (contentTokens.has(token)) {
        score += 1.2;
        tokenMatched = true;
      }
      if (categoryTokens.has(token)) {
        score += 1.0;
        tokenMatched = true;
      }

      if (tokenMatched) {
        matchedTerms.push(token);
      }
    }

    if (score === 0) continue;

    // Normalize by chunk length
    const normalizedScore = score / (1 + Math.log10(chunk.content.length + 20));

    if (normalizedScore >= minThreshold) {
      const excerpt = extractRelevantSentences(chunk.content, matchedTerms, 2);
      results.push({
        chunk,
        score: Number(normalizedScore.toFixed(3)),
        matchedTerms: Array.from(new Set(matchedTerms)),
        excerpt,
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function chunkDocumentText(
  title: string,
  category: string,
  rawText: string,
  tags: string[] = []
): DocumentChunk[] {
  const paragraphs = rawText
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 20);

  if (paragraphs.length <= 1) {
    return [{
      id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title,
      content: rawText.trim(),
      category,
      tags,
      addedAt: new Date().toISOString(),
    }];
  }

  return paragraphs.map((para, index) => ({
    id: `chk_${Date.now()}_${index}`,
    title: `${title} (Part ${index + 1})`,
    content: para,
    category,
    tags,
    addedAt: new Date().toISOString(),
  }));
}
