import React, { useState } from 'react';
import {
  FileText,
  PhoneCall,
  Clock,
  Zap,
  CheckCircle2,
  Search,
  Eye,
  Trash2,
  ShieldCheck,
  X,
  AlertTriangle,
  Lock,
  BellRing,
  CalendarCheck,
  History,
} from 'lucide-react';
import { CallLog, HandoffTicket, SupportedLanguage, AppointmentRecord, AuditLogEntry } from '../types';
import { calculatePercentiles } from '../utils/latencyTracker';

interface CallLogsTabProps {
  logs: CallLog[];
  handoffs?: HandoffTicket[];
  appointments?: AppointmentRecord[];
  auditLogs?: AuditLogEntry[];
  isAdmin?: boolean;
  authToken?: string | null;
  onClearLogs?: () => void;
  onUpdateHandoffStatus?: (id: string, status: HandoffTicket['status']) => Promise<void> | void;
  onUpdateAppointmentStatus?: (id: string, status: AppointmentRecord['status']) => Promise<void> | void;
  onOpenAuth?: () => void;
}

export const CallLogsTab: React.FC<CallLogsTabProps> = ({
  logs,
  handoffs = [],
  appointments = [],
  auditLogs = [],
  isAdmin = false,
  authToken = null,
  onClearLogs,
  onUpdateHandoffStatus,
  onUpdateAppointmentStatus,
  onOpenAuth,
}) => {
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updatingHandoffId, setUpdatingHandoffId] = useState<string | null>(null);
  const [updatingAppointmentId, setUpdatingAppointmentId] = useState<string | null>(null);

  // Compute all metrics strictly from actual data in logs
  const allLatencies = logs
    .map(l => l.metrics?.averageLatencyMs)
    .filter((l): l is number => typeof l === 'number' && l > 0);

  const stats = calculatePercentiles(allLatencies);
  const totalDuration = logs.reduce((acc, l) => acc + (l.durationSeconds || 0), 0);

  const completedCalls = logs.filter(l => l.metrics?.taskCompleted).length;
  const taskCompletionRate = logs.length > 0 ? Math.round((completedCalls / logs.length) * 100) : 0;
  const bargeInRate = logs.length > 0
    ? Math.round((logs.filter(l => (l.metrics?.bargeInCount || 0) > 0).length / logs.length) * 100)
    : 0;

  const handleDeleteConfirmed = async () => {
    setIsDeleting(true);
    setActionError(null);
    try {
      const endpoint = isAdmin ? '/api/logs/all' : '/api/session/data';
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error || `Delete failed (${res.status})`);
        return;
      }
      setConfirmingDelete(false);
      onClearLogs?.();
    } catch (e) {
      setActionError('Failed to delete logs: ' + String(e));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleStatusUpdate = async (ticketId: string, nextStatus: HandoffTicket['status']) => {
    if (!onUpdateHandoffStatus) return;
    setUpdatingHandoffId(ticketId);
    setActionError(null);
    try {
      await onUpdateHandoffStatus(ticketId, nextStatus);
    } catch (e) {
      setActionError('Failed to update handoff ticket: ' + String(e));
    } finally {
      setUpdatingHandoffId(null);
    }
  };

  const handleAppointmentUpdate = async (id: string, nextStatus: AppointmentRecord['status']) => {
    if (!onUpdateAppointmentStatus) return;
    setUpdatingAppointmentId(id);
    setActionError(null);
    try {
      await onUpdateAppointmentStatus(id, nextStatus);
    } catch (e) {
      setActionError('Failed to update appointment: ' + String(e));
    } finally {
      setUpdatingAppointmentId(null);
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
      {/* Caller vs Admin Scope Notice */}
      {!isAdmin && (
        <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5 text-indigo-200">
            <Lock className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-white block">Caller Session Scope</strong>
              <span className="text-slate-300">
                Showing only consented transcripts recorded during your active browser session. Cross-tenant audit logs and the Staff Handoff Queue require Workspace Admin sign-in.
              </span>
            </div>
          </div>
          {onOpenAuth && (
            <button
              onClick={onOpenAuth}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shrink-0 cursor-pointer"
            >
              Admin Sign-In
            </button>
          )}
        </div>
      )}

      {actionError && (
        <div role="alert" className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-200">
          {actionError}
        </div>
      )}

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
            {logs.some(l => l.isSampleData) ? 'Includes sample records' : isAdmin ? 'Authorized tenants' : 'Active session'}
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
            {stats.count > 0 ? `${stats.count} calls measured` : 'Awaiting calls'}
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

      {/* Staff Handoff Queue (Admin Only) */}
      {isAdmin && (
        <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-5 shadow-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BellRing className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white tracking-tight">
                Staff Callback & Handoff Queue ({handoffs.length})
              </h3>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              {handoffs.filter(h => h.status !== 'resolved').length} open tickets
            </span>
          </div>

          {handoffs.length === 0 ? (
            <p className="text-xs text-slate-400 py-3">
              No human callback or emergency handoff tickets have been queued yet.
            </p>
          ) : (
            <div className="space-y-2.5">
              {handoffs.map(ticket => (
                <div
                  key={ticket.id}
                  className="p-3.5 rounded-xl bg-black/40 border border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-white">{ticket.id}</span>
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[10px] uppercase ${
                          ticket.priority === 'critical'
                            ? 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                            : ticket.priority === 'high'
                            ? 'bg-amber-950/60 text-amber-300 border border-amber-500/40'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {ticket.priority}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[10px] uppercase ${
                          ticket.status === 'resolved'
                            ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-500/30'
                            : ticket.status === 'acknowledged'
                            ? 'bg-indigo-950/50 text-indigo-300 border border-indigo-500/30'
                            : 'bg-amber-950/50 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {ticket.status}
                      </span>
                      <span className="text-slate-300 font-semibold">
                        {ticket.tenantName || ticket.tenantId}
                      </span>
                    </div>
                    <p className="text-slate-300">
                      <strong className="text-slate-200">{ticket.reason}</strong> — "{ticket.summary}"
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono">
                      Desk: {ticket.department} ({ticket.phone})
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {ticket.status === 'queued' && (
                      <button
                        onClick={() => handleStatusUpdate(ticket.id, 'acknowledged')}
                        disabled={updatingHandoffId === ticket.id}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold cursor-pointer"
                      >
                        Acknowledge
                      </button>
                    )}
                    {ticket.status !== 'resolved' && (
                      <button
                        onClick={() => handleStatusUpdate(ticket.id, 'resolved')}
                        disabled={updatingHandoffId === ticket.id}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold cursor-pointer"
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Clinic Appointments Ledger (Admin Only) */}
      {isAdmin && (
        <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-5 shadow-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white tracking-tight">
                Clinic Appointments Ledger ({appointments.length})
              </h3>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              {appointments.filter(a => a.status === 'confirmed').length} active slots
            </span>
          </div>

          {appointments.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">
              No persistent appointments have been booked yet.
            </p>
          ) : (
            <div className="space-y-2.5">
              {appointments.map(apt => (
                <div
                  key={apt.id}
                  className="p-3.5 rounded-xl bg-black/40 border border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-white">{apt.id}</span>
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[10px] uppercase ${
                          apt.status === 'confirmed'
                            ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {apt.status}
                      </span>
                      <span className="text-slate-200 font-semibold">{apt.doctor}</span>
                    </div>
                    <p className="text-slate-300">
                      Patient: <strong className="text-white">{apt.patientName}</strong> • Slot:{' '}
                      <span className="font-mono text-indigo-300">{apt.slot}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono">
                      Action ID: {apt.actionId} • Tenant: {apt.tenantId}
                    </p>
                  </div>

                  {apt.status === 'confirmed' && (
                    <button
                      onClick={() => handleAppointmentUpdate(apt.id, 'cancelled')}
                      disabled={updatingAppointmentId === apt.id}
                      className="px-3 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 border border-rose-500/40 disabled:opacity-50 text-rose-200 font-semibold cursor-pointer shrink-0"
                    >
                      {updatingAppointmentId === apt.id ? 'Updating...' : 'Cancel Slot'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Operational Audit Trail (Admin Only) */}
      {isAdmin && (
        <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-5 shadow-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-sky-400" />
              <h3 className="text-sm font-bold text-white tracking-tight">
                Operational Audit Trail ({auditLogs.length})
              </h3>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">Trace-correlated SQLite events</span>
          </div>

          {auditLogs.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">No audit events recorded yet.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {auditLogs.slice(0, 25).map(entry => (
                <div
                  key={entry.id}
                  className="px-3 py-2 rounded-lg bg-black/40 border border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] font-mono"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sky-300 font-semibold">{entry.action}</span>
                    {entry.targetId && <span className="text-slate-300">target={entry.targetId}</span>}
                    {entry.tenantId && <span className="text-indigo-300">tenant={entry.tenantId}</span>}
                  </div>
                  <div className="text-slate-500">
                    actor={entry.actorRole} • trace={entry.traceId.slice(0, 8)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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

          {/* Delete My Data Action (Inline confirmation, no browser confirm dialog) */}
          {confirmingDelete ? (
            <div className="flex items-center gap-2 bg-rose-950/60 border border-rose-500/40 rounded-xl px-2.5 py-1 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span className="text-rose-200">
                {isAdmin ? 'Erase authorized logs?' : 'Delete session data?'}
              </span>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirmed}
                disabled={isDeleting}
                className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold cursor-pointer"
              >
                {isDeleting ? 'Deleting...' : 'Confirm'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={isDeleting || logs.length === 0 || !authToken}
              aria-label="Delete call records"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 text-xs transition-all disabled:opacity-40 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isAdmin ? 'Delete Authorized Logs' : 'Delete My Data'}</span>
            </button>
          )}
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
                  : 'No consented call sessions have been stored yet. Grant consent with retention > 0 days and complete a call in the Voice Console, or sign in as Admin to review authorized tenant transcripts.'}
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
