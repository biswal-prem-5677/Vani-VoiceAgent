import React, { useState } from 'react';
import {
  FileText,
  PhoneCall,
  Clock,
  Zap,
  Globe2,
  CheckCircle2,
  AlertCircle,
  Search,
  Filter,
  Eye,
  Trash2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { CallLog, SupportedLanguage } from '../types';
import { calculatePercentiles, calculateVoiceCallCost } from '../utils/latencyTracker';

interface CallLogsTabProps {
  logs: CallLog[];
  onClearLogs?: () => void;
}

export const CallLogsTab: React.FC<CallLogsTabProps> = ({ logs, onClearLogs }) => {
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [isDeleting, setIsDeleting] = useState(false);

  // Compute all metrics strictly from actual data in logs
  const allLatencies = logs
    .map(l => l.metrics?.averageLatencyMs)
    .filter((l): l is number => typeof l === 'number' && l > 0);

  const stats = calculatePercentiles(allLatencies);
  const totalDuration = logs.reduce((acc, l) => acc + (l.durationSeconds || 0), 0);
  const costReport = calculateVoiceCallCost(totalDuration);

  const completedCalls = logs.filter(l => l.metrics?.taskCompleted).length;
  const taskCompletionRate = logs.length > 0 ? Math.round((completedCalls / logs.length) * 100) : 0;
  const bargeInRate = logs.length > 0
    ? Math.round((logs.filter(l => (l.metrics?.bargeInCount || 0) > 0).length / logs.length) * 100)
    : 0;

  const handleDeleteAll = async () => {
    if (!confirm('Are you sure you want to delete all call logs? This action will permanently remove stored session transcripts.')) {
      return;
    }
    setIsDeleting(true);
    try {
      await fetch('/api/logs/all', { method: 'DELETE' });
      onClearLogs?.();
    } catch (e) {
      console.error('Failed to delete logs:', e);
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch =
      (log.callerName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.callerNumber || '').includes(searchTerm) ||
      (log.tenantName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.detectedIntent || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesLang =
      languageFilter === 'all' ||
      log.languagesUsed?.includes(languageFilter as SupportedLanguage);

    return matchesSearch && matchesLang;
  });

  return (
    <div className="space-y-6">
      {/* Top Telemetry Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-4 shadow-xl">
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1 font-medium">
            <PhoneCall className="w-3.5 h-3.5 text-indigo-400" />
            <span>Logged Calls</span>
          </div>
          <span className="text-2xl font-bold text-white font-mono tabular-nums">
            {logs.length}
          </span>
          <span className="text-[11px] text-slate-400 block mt-1 font-mono">
            {logs.some(l => l.isSampleData) ? 'Includes sample records' : 'Recorded sessions'}
          </span>
        </div>

        <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-4 shadow-xl">
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1 font-medium">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            <span>Median p50</span>
          </div>
          <span className="text-2xl font-bold text-emerald-400 font-mono tabular-nums">
            {stats.count > 0 ? `${stats.p50}ms` : 'No data yet'}
          </span>
          <span className="text-[11px] text-slate-400 block mt-1 font-mono">
            {stats.count > 0 ? `${stats.count} turns measured` : 'Awaiting calls'}
          </span>
        </div>

        <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-4 shadow-xl">
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1 font-medium">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Tail p95</span>
          </div>
          <span className="text-2xl font-bold text-amber-400 font-mono tabular-nums">
            {stats.count > 0 ? `${stats.p95}ms` : 'No data yet'}
          </span>
          <span className="text-[11px] text-slate-400 block mt-1 font-mono">
            {stats.count > 0 ? '95th percentile' : 'Awaiting calls'}
          </span>
        </div>

        <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-4 shadow-xl">
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
            <span>Task Completion</span>
          </div>
          <span className="text-2xl font-bold text-blue-400 font-mono tabular-nums">
            {logs.length > 0 ? `${taskCompletionRate}%` : 'No data yet'}
          </span>
          <span className="text-[11px] text-slate-400 block mt-1 font-mono">
            {logs.length > 0 ? `${completedCalls}/${logs.length} completed` : 'Awaiting calls'}
          </span>
        </div>

        <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-4 shadow-xl">
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1 font-medium">
            <Clock className="w-3.5 h-3.5 text-purple-400" />
            <span>Total Duration</span>
          </div>
          <span className="text-2xl font-bold text-purple-400 font-mono tabular-nums">
            {Math.floor(totalDuration / 60)}m {totalDuration % 60}s
          </span>
          <span className="text-[11px] text-slate-400 block mt-1 font-mono">
            {logs.length} total sessions
          </span>
        </div>

        <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-4 shadow-xl">
          <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1 font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Barge-in Rate</span>
          </div>
          <span className="text-2xl font-bold text-white font-mono tabular-nums">
            {logs.length > 0 ? `${bargeInRate}%` : 'No data yet'}
          </span>
          <span className="text-[11px] text-slate-400 block mt-1 font-mono">Interruption sessions</span>
        </div>
      </div>

      {/* Action Header & Privacy Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0D111A] border border-white/[0.08] rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-bold text-white tracking-tight">Call Transcripts & Audit</h3>
          <span className="text-xs text-slate-400">({filteredLogs.length} records)</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search caller, tenant, intent..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              aria-label="Search call logs"
              className="bg-black/40 border border-white/[0.1] rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-56"
            />
          </div>

          {/* Language Filter */}
          <select
            value={languageFilter}
            onChange={e => setLanguageFilter(e.target.value)}
            aria-label="Filter by language"
            className="bg-black/40 border border-white/[0.1] rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Languages</option>
            <option value="or">Odia</option>
            <option value="hi">Hindi</option>
            <option value="hinglish">Hinglish</option>
            <option value="bn">Bengali</option>
            <option value="en">English</option>
          </select>

          {/* Delete My Data Action (Data Privacy DPDP) */}
          <button
            onClick={handleDeleteAll}
            disabled={isDeleting || logs.length === 0}
            aria-label="Delete all call records"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 text-xs transition-all disabled:opacity-40 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete My Data</span>
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl">
        {filteredLogs.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/10 text-slate-400 flex items-center justify-center mx-auto">
              <FileText className="w-6 h-6 text-slate-500" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">No Call Transcripts Found</h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                {searchTerm || languageFilter !== 'all'
                  ? 'No records match your active search or language filters.'
                  : 'No call sessions have been recorded yet. Launch a session in the Live Voice Console to view live turn metrics.'}
              </p>
            </div>
            {(searchTerm || languageFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setLanguageFilter('all');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition"
              >
                Reset Search Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] bg-black/30 text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-4">Caller & Session</th>
                  <th className="py-3 px-4">Tenant</th>
                  <th className="py-3 px-4">Languages</th>
                  <th className="py-3 px-4">Intent</th>
                  <th className="py-3 px-4 text-center">Avg Latency</th>
                  <th className="py-3 px-4 text-center">Duration</th>
                  <th className="py-3 px-4 text-center">Outcome</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04] text-xs">
                {filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{log.callerName}</span>
                        {log.isSampleData && (
                          <span className="text-[10px] bg-slate-800 border border-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-mono">
                            Sample
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                        {log.callerNumber} • {log.startedAt}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-300 font-medium">{log.tenantName}</td>
                    <td className="py-3 px-4">
                      <div className="flex gap-1 flex-wrap">
                        {log.languagesUsed?.map(lang => (
                          <span
                            key={lang}
                            className="px-1.5 py-0.5 rounded bg-black/40 border border-white/[0.08] font-mono text-[11px] uppercase text-slate-300"
                          >
                            {lang}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300 text-[11px]">
                      {log.detectedIntent}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-emerald-400">
                      {log.metrics?.averageLatencyMs ? `${log.metrics.averageLatencyMs}ms` : '—'}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-slate-400">
                      {log.durationSeconds}s
                    </td>
                    <td className="py-3 px-4 text-center">
                      {log.metrics?.handedOffToHuman ? (
                        <span className="text-amber-400 bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded text-[11px] font-mono">
                          Handoff Requested
                        </span>
                      ) : log.metrics?.taskCompleted ? (
                        <span className="text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded text-[11px] font-mono">
                          Completed
                        </span>
                      ) : (
                        <span className="text-slate-400 font-mono text-[11px]">Incomplete</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setSelectedCall(log)}
                        aria-label={`View transcript for ${log.id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 text-xs transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal for Transcript Inspection */}
      {selectedCall && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="transcript-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onKeyDown={e => {
            if (e.key === 'Escape') setSelectedCall(null);
          }}
        >
          <div className="bg-[#0D111A] border border-white/[0.1] rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-white/[0.08] flex items-center justify-between">
              <div>
                <h3 id="transcript-modal-title" className="text-sm font-bold text-white">
                  Session Transcript: {selectedCall.callerName}
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  ID: {selectedCall.id} • {selectedCall.tenantName} • Duration: {selectedCall.durationSeconds}s
                </p>
              </div>
              <button
                onClick={() => setSelectedCall(null)}
                aria-label="Close transcript modal"
                className="p-1 rounded-lg hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3 flex-1 text-xs">
              {selectedCall.turns?.map((turn, idx) => (
                <div
                  key={turn.id || idx}
                  className={`p-3 rounded-xl border ${
                    turn.speaker === 'user'
                      ? 'bg-slate-900 border-white/[0.06] ml-6'
                      : turn.speaker === 'agent'
                      ? 'bg-indigo-950/20 border-indigo-500/20 mr-6'
                      : 'bg-amber-950/20 border-amber-500/20 text-center font-mono text-[11px]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1 text-[11px] text-slate-400 font-mono">
                    <span className="uppercase font-semibold">
                      {turn.speaker === 'user' ? 'Caller' : turn.speaker === 'agent' ? 'AI Voice Agent' : 'System Notice'}
                    </span>
                    <span>Lang: {turn.language} {turn.latencyMs ? `• ${turn.latencyMs}ms` : ''}</span>
                  </div>
                  <p className="text-slate-200 leading-relaxed font-sans">{turn.text}</p>
                  {turn.toolInvoked && (
                    <div className="mt-2 p-2 rounded bg-black/40 border border-white/[0.06] font-mono text-[11px] text-emerald-400">
                      Tool Executed: {turn.toolInvoked.toolName}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-white/[0.08] flex items-center justify-between bg-black/30 text-xs">
              <span className="text-slate-400">
                P95 Latency: {selectedCall.metrics?.p95LatencyMs || '—'}ms • Barged-in: {selectedCall.metrics?.bargeInCount || 0} times
              </span>
              <button
                onClick={() => setSelectedCall(null)}
                className="px-4 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] text-white transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
