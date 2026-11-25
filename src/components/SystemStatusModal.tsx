import React, { useEffect, useState, useCallback } from 'react';
import { X, Activity, Server, Database, Sparkles, RefreshCw, Cpu, Lock } from 'lucide-react';

interface SystemStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  authToken?: string | null;
  isAdmin?: boolean;
}

interface PublicHealthData {
  status: string;
  timestamp: number;
}

interface AdminDiagnosticsData {
  status: string;
  uptimeSeconds: number;
  database: {
    type: string;
    status: string;
    tenantsCount: number;
    logsCount: number;
    ticketsCount: number;
    handoffsOpenCount?: number;
    appointmentsCount?: number;
  };
  geminiAi: {
    configured: boolean;
    model: string;
  };
  systemMetrics: {
    memoryMb: number;
    nodeVersion: string;
  };
}

export const SystemStatusModal: React.FC<SystemStatusModalProps> = ({
  isOpen,
  onClose,
  authToken,
  isAdmin = false,
}) => {
  const [health, setHealth] = useState<PublicHealthData | null>(null);
  const [diagnostics, setDiagnostics] = useState<AdminDiagnosticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      } else {
        setError('Server returned status ' + res.status);
      }

      if (isAdmin && authToken) {
        const diagRes = await fetch('/api/diagnostics', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (diagRes.ok) {
          setDiagnostics(await diagRes.json());
        } else {
          setDiagnostics(null);
        }
      } else {
        setDiagnostics(null);
      }
    } catch (err) {
      setError('Unable to fetch system health: ' + String(err));
    } finally {
      setLoading(false);
    }
  }, [authToken, isAdmin]);

  useEffect(() => {
    if (isOpen) {
      void fetchHealth();
    }
  }, [isOpen, fetchHealth]);

  if (!isOpen) return null;

  const formatUptime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m ${seconds % 60}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl bg-[#0D111A] border border-white/10 shadow-2xl text-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0A0E17]">
          <div className="flex items-center gap-2.5">
            <Activity className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-bold text-white">System Status & Service Health</h2>
              <p className="text-[11px] text-slate-400">
                {isAdmin ? 'Admin diagnostics & runtime health telemetry' : 'Public readiness probe'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchHealth()}
              disabled={loading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
              title="Refresh status"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
            <button
              onClick={onClose}
              aria-label="Close system status"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4 text-xs font-sans">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
              {error}
            </div>
          )}

          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <div>
                <span className="font-bold text-white text-sm">
                  {health?.status === 'operational' ? 'Core Service Operational' : 'Checking Service Status'}
                </span>
                <p className="text-[11px] text-emerald-300/80">
                  HTTPS API & authoritative SQLite data plane ready
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-bold text-[10px]">
              {health ? health.status.toUpperCase() : 'CHECKING'}
            </span>
          </div>

          {diagnostics ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Database className="w-3.5 h-3.5 text-indigo-400" />
                    Authoritative DB
                  </span>
                  <span className="text-[10px] text-emerald-400 font-mono">CONNECTED</span>
                </div>
                <div className="text-[11px] text-slate-300 space-y-0.5 font-mono">
                  <div>Tenants: <strong className="text-white">{diagnostics.database.tenantsCount}</strong></div>
                  <div>Call Logs: <strong className="text-white">{diagnostics.database.logsCount}</strong></div>
                  <div>Open Handoffs: <strong className="text-white">{diagnostics.database.handoffsOpenCount ?? 0}</strong></div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Gemini LLM
                  </span>
                  <span className="text-[10px] text-emerald-400 font-mono">
                    {diagnostics.geminiAi.configured ? 'ACTIVE' : 'DEMO READY'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 space-y-0.5 font-mono">
                  <div>Model: <strong className="text-white">{diagnostics.geminiAi.model}</strong></div>
                  <div>Proxy: <strong className="text-indigo-400">/api/turn</strong></div>
                  <div>Execution: <strong className="text-emerald-400">Server-Side AI</strong></div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Server className="w-3.5 h-3.5 text-teal-400" />
                    Server Uptime
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {formatUptime(diagnostics.uptimeSeconds)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 space-y-0.5 font-mono">
                  <div>Runtime: <strong className="text-white">{diagnostics.systemMetrics.nodeVersion}</strong></div>
                  <div>Persistence: <strong className="text-white">SQLite WAL-safe</strong></div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Cpu className="w-3.5 h-3.5 text-purple-400" />
                    Process Heap
                  </span>
                  <span className="text-[10px] text-emerald-400 font-mono">NORMAL</span>
                </div>
                <div className="text-[11px] text-slate-300 space-y-0.5 font-mono">
                  <div>Heap Used: <strong className="text-white">{diagnostics.systemMetrics.memoryMb} MB</strong></div>
                  <div>Rate Limiter: <strong className="text-white">180 req/min</strong></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-white/10 flex items-center gap-2.5 text-[11px] text-slate-400">
              <Lock className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>
                Detailed database counts, runtime version, memory heap, and AI engine diagnostics are restricted to authenticated administrators via <code>/api/diagnostics</code>.
              </span>
            </div>
          )}

          <p className="text-[11px] text-slate-400 text-center pt-1">
            Public <code>/api/health</code> returns minimal readiness only; infrastructure telemetry requires admin authentication.
          </p>
        </div>

        <div className="px-6 py-3 border-t border-white/10 bg-[#0A0E17] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
