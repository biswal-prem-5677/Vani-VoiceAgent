import React, { useState } from 'react';
import {
  Award,
  Play,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Zap,
  BookOpen,
  ArrowRight,
  ShieldAlert,
  Clock,
  Filter,
} from 'lucide-react';
import { BENCHMARK_CASES } from '../data/evalBenchmark';
import { BenchmarkCase } from '../types';

interface EvaluationTabProps {
  authToken?: string | null;
}

export const EvaluationTab: React.FC<EvaluationTabProps> = ({ authToken }) => {
  const [testCases, setTestCases] = useState<BenchmarkCase[]>(BENCHMARK_CASES);
  const [isRunningBench, setIsRunningBench] = useState(false);
  const [activeFilterDifficulty, setActiveFilterDifficulty] = useState<string>('all');
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [runStats, setRunStats] = useState<{
    tested: boolean;
    totalCases: number;
    passedCount: number;
    accuracyPercent: number;
    averageLatencyMs: number;
  }>({
    tested: false,
    totalCases: BENCHMARK_CASES.length,
    passedCount: 0,
    accuracyPercent: 0,
    averageLatencyMs: 0,
  });

  const projectSummary = `Built a multilingual multi-tenant voice-agent prototype with intent routing, cross-lingual knowledge retrieval, safety emergency detection, and tool-calling for 4 tenants (clinic, coaching, logistics, university). Supports Odia, Hindi, Hinglish, Bengali, and English with browser speech recognition, turn-taking, and barge-in audio interruption.`;

  const handleCopySummary = () => {
    navigator.clipboard.writeText(projectSummary);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2500);
  };

  const handleRunBenchmark = async () => {
    setIsRunningBench(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      const res = await fetch('/api/benchmark/run', {
        method: 'POST',
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        setTestCases(data.cases);
        setRunStats({
          tested: true,
          totalCases: data.totalCases,
          passedCount: data.passedCount,
          accuracyPercent: data.overallAccuracy,
          averageLatencyMs: data.avgLatency,
        });
      } else {
        throw new Error('Server benchmark failed');
      }
    } catch {
      // Client-side fallback harness execution
      const updated: BenchmarkCase[] = [];
      let passed = 0;
      let totalLatency = 0;

      for (const tc of BENCHMARK_CASES) {
        const t0 = performance.now();
        try {
          const fallbackHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
          if (authToken) fallbackHeaders.Authorization = `Bearer ${authToken}`;
          const res = await fetch('/api/turn', {
            method: 'POST',
            headers: fallbackHeaders,
            body: JSON.stringify({
              tenantId: 'kalinga_clinic',
              userText: tc.userInput,
              language: tc.language,
              memory: {},
              demoMode: true,
            }),
          });
          const turnData = await res.json();
          const latency = Math.round(performance.now() - t0);
          totalLatency += latency;

          const intentCorrect = turnData.intent === tc.expectedIntent;
          const toolCorrect = tc.expectedTool
            ? turnData.toolCalls?.some((t: any) => t.name === tc.expectedTool)
            : true;
          const casePassed = intentCorrect && toolCorrect;
          if (casePassed) passed++;

          updated.push({
            ...tc,
            measuredLatencyMs: latency,
            measuredIntent: turnData.intent,
            intentCorrect,
            toolCallCorrect: toolCorrect,
            passed: casePassed,
            actualReply: turnData.reply,
            executionStatus: casePassed ? 'completed' : 'error',
          });
        } catch {
          updated.push({
            ...tc,
            measuredLatencyMs: Math.round(performance.now() - t0),
            passed: false,
            executionStatus: 'error',
          });
        }
      }

      setTestCases(updated);
      setRunStats({
        tested: true,
        totalCases: updated.length,
        passedCount: passed,
        accuracyPercent: Math.round((passed / updated.length) * 100),
        averageLatencyMs: Math.round(totalLatency / updated.length),
      });
    } finally {
      setIsRunningBench(false);
    }
  };

  const filteredCases = testCases.filter(c => {
    if (activeFilterDifficulty === 'all') return true;
    return c.difficulty === activeFilterDifficulty;
  });

  return (
    <div className="space-y-6">
      {/* Top Header Banner */}
      <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-6 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Award className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white tracking-tight">
              Deterministic Routing Test Suite ({BENCHMARK_CASES.length} Cases)
            </h2>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Evaluates rule-based intent classification, safety 112 detection, tool parameter extraction, and turnaround time locally across Odia, Hindi, Hinglish, Bengali, and English (no live LLM quota consumed).
          </p>
        </div>

        <button
          disabled={isRunningBench}
          onClick={handleRunBenchmark}
          aria-label="Run internal test set"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white shadow-xl bg-indigo-600 hover:bg-indigo-500 transition-all disabled:opacity-50 text-xs whitespace-nowrap cursor-pointer"
        >
          {isRunningBench ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Executing Test Cases...</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Run Internal Test Suite ({BENCHMARK_CASES.length} cases)</span>
            </>
          )}
        </button>
      </div>

      {/* Honest Project Summary Card */}
      <div className="bg-gradient-to-r from-indigo-950/30 via-[#0D111A] to-slate-900 border border-indigo-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-300 font-mono">
              Project Summary & Technical Scope
            </span>
          </div>
          <button
            onClick={handleCopySummary}
            aria-label="Copy project summary"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 text-xs transition-all font-semibold cursor-pointer"
          >
            {copiedSummary ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Summary</span>
              </>
            )}
          </button>
        </div>

        <p className="text-sm font-medium text-slate-200 leading-relaxed bg-black/40 border border-white/[0.06] rounded-xl p-4 font-mono select-all">
          {projectSummary}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-400 pt-2 border-t border-white/[0.06]">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>Multi-Tenant Architecture with 4 distinct business categories and isolated knowledge bases</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>Safety router detecting critical emergency symptoms with immediate 112 guidance</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>Odia, Hindi, Bengali, Hinglish, and English multi-lingual support</span>
          </div>
        </div>
      </div>

      {/* Real Execution Results Summary Bar */}
      {runStats.tested ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="bg-[#0D111A] border border-white/[0.08] rounded-xl p-4">
            <span className="text-xs text-slate-400 block font-medium">Test Set Size</span>
            <span className="text-2xl font-bold text-white font-mono">{runStats.totalCases} cases</span>
          </div>
          <div className="bg-[#0D111A] border border-white/[0.08] rounded-xl p-4">
            <span className="text-xs text-slate-400 block font-medium">Passed Cases</span>
            <span className="text-2xl font-bold text-emerald-400 font-mono">
              {runStats.passedCount} / {runStats.totalCases}
            </span>
          </div>
          <div className="bg-[#0D111A] border border-white/[0.08] rounded-xl p-4">
            <span className="text-xs text-slate-400 block font-medium">Measured Accuracy</span>
            <span className="text-2xl font-bold text-indigo-400 font-mono">
              {runStats.accuracyPercent}%
            </span>
          </div>
          <div className="bg-[#0D111A] border border-white/[0.08] rounded-xl p-4">
            <span className="text-xs text-slate-400 block font-medium">Avg Turnaround Latency</span>
            <span className="text-2xl font-bold text-amber-400 font-mono">
              {runStats.averageLatencyMs}ms
            </span>
          </div>
        </div>
      ) : (
        <div className="bg-[#0D111A] border border-dashed border-white/[0.12] rounded-xl p-4 text-center text-xs text-slate-400">
          Click <strong>"Run Internal Test Suite"</strong> above to execute all 16 test cases through the real backend API and observe measured pass rates and latencies.
        </div>
      )}

      {/* Test Scenarios Table */}
      <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">
              Test Cases ({filteredCases.length} of {testCases.length})
            </h3>
            <p className="text-xs text-slate-400">
              Evaluated on intent recognition, parameter checks, emergency routing, and execution speed.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={activeFilterDifficulty}
              onChange={e => setActiveFilterDifficulty(e.target.value)}
              aria-label="Filter difficulty"
              className="bg-black/40 border border-white/[0.1] rounded-lg px-2.5 py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Difficulties</option>
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Challenging (Code-switch)">Code-Switch</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] bg-black/30 text-[11px] font-mono uppercase tracking-wider text-slate-400">
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Language</th>
                <th className="py-3 px-4">Scenario & Test Input</th>
                <th className="py-3 px-4">Expected Intent</th>
                <th className="py-3 px-4">Measured Intent</th>
                <th className="py-3 px-4 text-right">Measured Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] text-xs">
              {filteredCases.map(tc => {
                const isRun = tc.executionStatus === 'completed' || tc.executionStatus === 'error';
                return (
                  <tr key={tc.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4">
                      {isRun ? (
                        tc.passed ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Pass
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                            <XCircle className="w-3.5 h-3.5" />
                            Fail
                          </span>
                        )
                      ) : (
                        <span className="text-slate-500 font-mono text-[11px]">Pending run</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-xs text-slate-300 uppercase">
                        {tc.language}
                      </span>
                    </td>
                    <td className="py-3 px-4 max-w-md">
                      <div className="font-semibold text-slate-200">{tc.scenario}</div>
                      <div className="text-slate-400 text-xs font-mono mt-0.5 line-clamp-2">
                        "{tc.userInput}"
                      </div>
                      {tc.actualReply && (
                        <div className="text-[11px] text-slate-500 mt-1 italic">
                          Reply: {tc.actualReply}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-400">
                      {tc.expectedIntent}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs">
                      {tc.measuredIntent ? (
                        <span className={tc.intentCorrect ? 'text-emerald-400' : 'text-rose-400'}>
                          {tc.measuredIntent}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-300">
                      {tc.measuredLatencyMs ? `${tc.measuredLatencyMs}ms` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
