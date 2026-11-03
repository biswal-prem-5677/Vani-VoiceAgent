import React, { useState } from 'react';
import { X, ShieldAlert, FileText, Trash2, CheckCircle2, Lock, AlertTriangle } from 'lucide-react';

interface LegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataWiped?: () => void;
}

export const LegalModal: React.FC<LegalModalProps> = ({ isOpen, onClose, onDataWiped }) => {
  const [activeSubTab, setActiveSubTab] = useState<'privacy' | 'terms' | 'manifest' | 'deletion'>('privacy');
  const [isWiping, setIsWiping] = useState(false);
  const [wipeSuccess, setWipeSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleWipeAllData = async () => {
    if (!window.confirm('Are you sure you want to permanently delete all call transcripts, user preferences, and custom tenants from the server? This cannot be undone.')) {
      return;
    }

    setIsWiping(true);
    setWipeSuccess(null);
    try {
      const res = await fetch('/api/user/wipe-all', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setWipeSuccess('All user records, call transcripts, and session logs have been permanently deleted from SQLite storage and memory.');
        localStorage.clear();
        sessionStorage.clear();
        if (onDataWiped) onDataWiped();
      } else {
        alert(data.error || 'Failed to wipe data.');
      }
    } catch (err) {
      alert('Error contacting server: ' + String(err));
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
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-white/10 bg-[#0D111A]/60 text-xs font-semibold overflow-x-auto">
          <button
            onClick={() => setActiveSubTab('privacy')}
            className={`pb-2.5 px-3 border-b-2 transition-all flex items-center gap-1.5 ${
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
            className={`pb-2.5 px-3 border-b-2 transition-all flex items-center gap-1.5 ${
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
            className={`pb-2.5 px-3 border-b-2 transition-all flex items-center gap-1.5 ${
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
            className={`pb-2.5 px-3 border-b-2 transition-all flex items-center gap-1.5 ${
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
              <h3 className="text-sm font-bold text-white">Privacy Policy (India DPDP Act 2023, GDPR & CCPA Aligned)</h3>
              <p>
                <strong>Last Updated:</strong> November 2026. VaniVoice AI (&quot;we&quot;, &quot;our&quot;, &quot;platform&quot;) operates as a multi-tenant voice agent engine. We treat user privacy with the highest engineering rigor.
              </p>
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                <h4 className="font-semibold text-white">1. Audio & Speech Processing</h4>
                <p>
                  Microphone audio captured during a voice session is processed directly in your client browser via the standard Web Speech API. Raw audio bytes are never recorded or stored on remote servers. Only transcribed text turns are transmitted to the backend for intent routing and tool execution.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                <h4 className="font-semibold text-white">2. Multi-Tenant Data Isolation</h4>
                <p>
                  Knowledge base files, FAQs, and business policies uploaded by companies are partitioned per tenant ID. Queries from one tenant cannot access or leak documents belonging to another tenant.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                <h4 className="font-semibold text-white">3. Zero Third-Party Tracking SDKs</h4>
                <p>
                  This application contains zero third-party advertising SDKs, behavioral fingerprinting scripts, or cross-site tracking pixels.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                <h4 className="font-semibold text-white">4. User Rights & Data Deletion</h4>
                <p>
                  In compliance with Apple, Google Play, and DPDP mandates, you retain the unconditional right to erase all session transcripts and user identifiers at any time via the &quot;Account &amp; Data Deletion&quot; tab.
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
                  Critical Healthcare & Safety Disclaimer
                </h4>
                <p className="mt-1 text-[11px]">
                  VaniVoice AI is an automated AI software system. For clinic and healthcare tenants, the voice agent is strictly an informational appointment and scheduling assistant. It cannot triage emergencies or provide medical diagnosis. In case of acute medical symptoms (chest pain, respiratory distress, trauma), callers must immediately dial <strong>112</strong> or proceed to the nearest emergency room.
                </p>
              </div>
              <p>
                <strong>Acceptance:</strong> By using VaniVoice AI, you agree not to submit unlawful, infringing, or abusive content. Commercial tenants are solely responsible for ensuring their uploaded documents, clinic fees, and policy statements comply with relevant regional regulations.
              </p>
              <p>
                <strong>Intellectual Property:</strong> Code architecture and software design are protected under open-source Apache-2.0 and author copyrights.
              </p>
            </div>
          )}

          {activeSubTab === 'manifest' && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-white">App Store & Play Store Data Safety Manifest</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse border border-white/10 text-[11px]">
                  <thead>
                    <tr className="bg-white/5 text-slate-400 border-b border-white/10">
                      <th className="p-2">Data Category</th>
                      <th className="p-2">Collected?</th>
                      <th className="p-2">Shared with 3rd Parties?</th>
                      <th className="p-2">Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    <tr>
                      <td className="p-2 font-medium text-white">Microphone / Audio</td>
                      <td className="p-2 text-emerald-400">Streamed locally</td>
                      <td className="p-2 text-emerald-400">No (Zero sharing)</td>
                      <td className="p-2 text-slate-400">In-browser speech-to-text recognition</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-medium text-white">Call Transcripts</td>
                      <td className="p-2 text-indigo-300">Session text only</td>
                      <td className="p-2 text-emerald-400">No</td>
                      <td className="p-2 text-slate-400">Displaying dialog history to caller</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-medium text-white">Location Data</td>
                      <td className="p-2 text-slate-500">No</td>
                      <td className="p-2 text-emerald-400">No</td>
                      <td className="p-2 text-slate-400">Not requested or used</td>
                    </tr>
                    <tr>
                      <td className="p-2 font-medium text-white">Device Identifiers / Ad IDs</td>
                      <td className="p-2 text-slate-500">No</td>
                      <td className="p-2 text-emerald-400">No</td>
                      <td className="p-2 text-slate-400">Zero advertising or fingerprinting</td>
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
                  Full Account & Data Deletion (Apple / Google Compliance)
                </h4>
                <p className="text-xs">
                  Triggering this action immediately purges all stored call transcripts, user retention consent timestamps, custom tenant documents, and temporary server tokens from the SQLite database.
                </p>
              </div>

              {wipeSuccess ? (
                <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{wipeSuccess}</span>
                </div>
              ) : (
                <div className="pt-2">
                  <button
                    onClick={handleWipeAllData}
                    disabled={isWiping}
                    className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition shadow-lg cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{isWiping ? 'Purging All Records...' : 'Permanently Delete All My Data Now'}</span>
                  </button>
                  <p className="text-[11px] text-slate-400 text-center mt-2">
                    Action takes effect immediately across server SQLite databases and client storage.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 bg-[#0A0E17] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
