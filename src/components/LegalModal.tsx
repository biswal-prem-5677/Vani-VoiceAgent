import React, { useState } from 'react';
import { X, ShieldAlert, FileText, Trash2, CheckCircle2, Lock, AlertTriangle } from 'lucide-react';
import type { AuthUser } from '../types';

interface LegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  authToken: string | null;
  authUser: AuthUser | null;
  onDataWiped?: (scope: 'session' | 'workspace') => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({
  isOpen,
  onClose,
  authToken,
  authUser,
  onDataWiped,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'privacy' | 'terms' | 'manifest' | 'deletion'>('privacy');
  const [confirmingWipe, setConfirmingWipe] = useState<'session' | 'workspace' | null>(null);
  const [isWiping, setIsWiping] = useState(false);
  const [wipeSuccess, setWipeSuccess] = useState<string | null>(null);
  const [wipeError, setWipeError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isSuperAdmin = authUser?.role === 'super_admin';

  const handleWipeSessionData = async () => {
    setIsWiping(true);
    setWipeSuccess(null);
    setWipeError(null);
    try {
      const res = await fetch('/api/session/data', {
        method: 'DELETE',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setWipeSuccess(
          'All transcripts, safety handoff tickets, support tickets, appointments, consent records, and pending confirmations for your active session have been permanently deleted.'
        );
        setConfirmingWipe(null);
        onDataWiped?.('session');
      } else {
        setWipeError(data.error || 'Failed to delete session data.');
      }
    } catch (err) {
      setWipeError('Error contacting server: ' + String(err));
    } finally {
      setIsWiping(false);
    }
  };

  const handleWipeWorkspaceData = async () => {
    setIsWiping(true);
    setWipeSuccess(null);
    setWipeError(null);
    try {
      const res = await fetch('/api/user/wipe-all', {
        method: 'POST',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setWipeSuccess('All workspace call logs, consent records, handoff queues, support tickets, and custom tenants have been permanently wiped.');
        setConfirmingWipe(null);
        onDataWiped?.('workspace');
      } else {
        setWipeError(data.error || 'Failed to wipe workspace data.');
      }
    } catch (err) {
      setWipeError('Error contacting server: ' + String(err));
    } finally {
      setIsWiping(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-[#0D111A] border border-white/10 shadow-2xl text-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0A0E17]">
          <div className="flex items-center gap-2.5">
            <Lock className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-white">Legal, Privacy & Compliance Center</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close legal modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-white/10 bg-[#0D111A]/60 text-xs font-semibold overflow-x-auto">
          <button
            onClick={() => setActiveSubTab('privacy')}
            className={`pb-2.5 px-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'privacy'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Privacy Policy
          </button>
          <button
            onClick={() => setActiveSubTab('terms')}
            className={`pb-2.5 px-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'terms'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Terms & EULA
          </button>
          <button
            onClick={() => setActiveSubTab('manifest')}
            className={`pb-2.5 px-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'manifest'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Data Safety Manifest
          </button>
          <button
            onClick={() => setActiveSubTab('deletion')}
            className={`pb-2.5 px-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'deletion'
                ? 'border-rose-500 text-rose-400'
                : 'border-transparent text-slate-400 hover:text-rose-300'
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Account & Data Deletion
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 text-xs text-slate-300 space-y-4 leading-relaxed font-sans">
          {activeSubTab === 'privacy' && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-white">Privacy Policy (India DPDP Act 2023 Aligned)</h3>
              <p>
                <strong>Last Updated:</strong> November 2026. VaniVoice AI is a multilingual, multi-tenant voice workflow prototype.
              </p>
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                <h4 className="font-semibold text-white">1. Audio & Speech Processing</h4>
                <p>
                  Microphone audio is processed via your browser Web Speech API engine. Raw audio waveforms are not uploaded to VaniVoice AI servers. Transcribed turns are transmitted over HTTPS to <code>/api/turn</code> for AI processing.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                <h4 className="font-semibold text-white">2. Consent & Retention Enforcement</h4>
                <p>
                  Transcript persistence is strictly gated on explicit consent and a retention window above 0 days. Choosing <strong>Delete on call end (0 days)</strong> or <strong>Ephemeral Only</strong> skips SQLite transcript storage and purges prior logs for your active session.
                </p>
                <p>
                  Safety/human-handoff tickets auto-expire after <strong>30 days</strong>, and support desk tickets and confirmed appointments auto-expire after <strong>90 days</strong>. All expired records across every table are removed automatically on startup and every 15 minutes.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                <h4 className="font-semibold text-white">3. Tenant Isolation & Authorization</h4>
                <p>
                  Administrative transcript views, handoff queues, clinic appointments, audit logs, knowledge base editing, and workspace wipes require authenticated server-signed tokens scoped to authorized tenant IDs.
                </p>
              </div>
            </div>
          )}

          {activeSubTab === 'terms' && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-white">Terms of Service & End User License Agreement (EULA)</h3>
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-200">
                <h4 className="font-semibold flex items-center gap-1.5 text-rose-300">
                  <AlertTriangle className="w-4 h-4" />
                  Critical Healthcare & Prototype Disclaimer
                </h4>
                <p className="mt-1 text-[11px]">
                  VaniVoice AI is an automated software prototype. It cannot triage emergencies, bridge live emergency telephone lines, or provide medical diagnoses. In acute emergencies, immediately dial <strong>112</strong>.
                </p>
              </div>
              <p>
                <strong>Prototype Data Fixtures:</strong> Built-in tool integrations (clinic appointment booking, parcel tracking, batch schedules, rank cutoffs) operate on sample demonstration records rather than live external EHR or courier carrier systems.
              </p>
            </div>
          )}

          {activeSubTab === 'manifest' && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-white">Data Safety Manifest</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse border border-white/10 text-[11px]">
                  <thead>
                    <tr className="bg-white/5 text-slate-400 border-b border-white/10">
                      <th className="p-2">Data Category</th>
                      <th className="p-2">Collected?</th>
                      <th className="p-2">Third-Party Sharing</th>
                      <th className="p-2">Purpose & Controls</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    <tr>
                      <td className="p-2 font-medium text-white">Microphone Audio</td>
                      <td className="p-2 text-emerald-400">Browser Speech API</td>
                      <td className="p-2 text-slate-300">Browser speech vendor</td>
                      <td className="p-2 text-slate-400">Not stored by VaniVoice servers</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-medium text-white">Text Turns & Prompts</td>
                      <td className="p-2 text-indigo-300">Sent to /api/turn</td>
                      <td className="p-2 text-amber-300">Google Gemini API</td>
                      <td className="p-2 text-slate-400">Generative response synthesis</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-medium text-white">Call Transcripts</td>
                      <td className="p-2 text-indigo-300">Consent-gated SQLite</td>
                      <td className="p-2 text-emerald-400">None</td>
                      <td className="p-2 text-slate-400">Auto-expires per retention setting; 0 days = never stored</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-medium text-white">Safety Handoff Tickets</td>
                      <td className="p-2 text-indigo-300">Escalation summary</td>
                      <td className="p-2 text-emerald-400">None</td>
                      <td className="p-2 text-slate-400">30-day auto-expiry; deleted immediately via Delete My Current Session Data</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-medium text-white">Support & Appointments</td>
                      <td className="p-2 text-indigo-300">SQLite operational queue</td>
                      <td className="p-2 text-emerald-400">None</td>
                      <td className="p-2 text-slate-400">90-day auto-expiry; deleted immediately via Delete My Current Session Data</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-medium text-white">Ad IDs / Trackers</td>
                      <td className="p-2 text-slate-500">None</td>
                      <td className="p-2 text-emerald-400">None</td>
                      <td className="p-2 text-slate-400">Zero advertising or fingerprinting SDKs</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeSubTab === 'deletion' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-200 space-y-2">
                <h4 className="font-bold flex items-center gap-1.5 text-rose-300 text-sm">
                  <Trash2 className="w-4 h-4" />
                  Session & Workspace Data Deletion
                </h4>
                <p className="text-xs">
                  Delete data strictly scoped to your active session at any time, or (when signed in as a Workspace Super Admin) reset all workspace records.
                </p>
              </div>

              {wipeError && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs">
                  {wipeError}
                </div>
              )}

              {wipeSuccess && (
                <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{wipeSuccess}</span>
                </div>
              )}

              <div className="space-y-3 pt-1">
                {confirmingWipe === 'session' ? (
                  <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 flex items-center justify-between gap-3">
                    <span className="text-rose-200">Confirm deleting all transcripts, handoff tickets, support tickets, appointments, and consent records for this session?</span>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setConfirmingWipe(null)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleWipeSessionData}
                        disabled={isWiping}
                        className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold cursor-pointer"
                      >
                        {isWiping ? 'Deleting...' : 'Confirm Delete'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingWipe('session')}
                    disabled={isWiping || !authToken}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-white font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4 text-rose-400" />
                    <span>Delete My Current Session Data</span>
                  </button>
                )}

                {isSuperAdmin && (
                  confirmingWipe === 'workspace' ? (
                    <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-500/50 flex items-center justify-between gap-3">
                      <span className="text-rose-200">Confirm wiping ALL workspace transcripts, handoffs, tickets, and custom tenants?</span>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => setConfirmingWipe(null)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleWipeWorkspaceData}
                          disabled={isWiping}
                          className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold cursor-pointer"
                        >
                          {isWiping ? 'Wiping...' : 'Confirm Global Wipe'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingWipe('workspace')}
                      disabled={isWiping}
                      className="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition shadow-lg cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Wipe All Workspace Data (Super Admin)</span>
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
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
