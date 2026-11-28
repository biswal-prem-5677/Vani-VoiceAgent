export interface LatencyStats {
  p50: number;
  p95: number;
  average: number;
  count: number;
  underOneSecondPercent: number;
}

export function calculatePercentiles(latencies: number[]): LatencyStats {
  if (latencies.length === 0) {
    return { p50: 0, p95: 0, average: 0, count: 0, underOneSecondPercent: 0 };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const average = Math.round(sum / count);

  const p50Index = Math.floor((count - 1) * 0.5);
  const p95Index = Math.min(count - 1, Math.floor((count - 1) * 0.95));

  const p50 = sorted[p50Index];
  const p95 = sorted[p95Index];

  const underOneSecond = sorted.filter(l => l <= 1000).length;
  const underOneSecondPercent = Math.round((underOneSecond / count) * 100);

  return {
    p50,
    p95,
    average,
    count,
    underOneSecondPercent,
  };
}

export interface CostBreakdown {
  sttCostPerMin: number;
  llmCostPerMin: number;
  ttsCostPerMin: number;
  infraCostPerMin: number;
  totalCostPerMin: number;
}

export function calculateVoiceCallCost(durationSeconds: number): {
  durationSeconds: number;
  totalCostUsd: number;
  totalCostInr: number;
  breakdown: CostBreakdown;
} {
  const minutes = durationSeconds / 60;
  // Cost breakdown based on 2026 production voice pipelines (e.g., Sarvam / Deepgram STT, Flash LLM, ElevenLabs/Sarvam TTS)
  const breakdown: CostBreakdown = {
    sttCostPerMin: 0.007, // $0.007 / min for streaming STT
    llmCostPerMin: 0.008, // $0.008 / min for Gemini 2.5/3.8 Flash
    ttsCostPerMin: 0.017, // $0.017 / min for streaming neural TTS
    infraCostPerMin: 0.010, // $0.010 / min for WebRTC / LiveKit / VM
    totalCostPerMin: 0.042, // Total $0.042 / min (~₹3.50 / min)
  };

  const totalCostUsd = Number((minutes * breakdown.totalCostPerMin).toFixed(4));
  const totalCostInr = Number((totalCostUsd * 86.5).toFixed(2)); // USD to INR conversion

  return {
    durationSeconds,
    totalCostUsd,
    totalCostInr,
    breakdown,
  };
}
