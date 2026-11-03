import React, { useState, useEffect } from 'react';
import { ShieldCheck, Info, X, Check } from 'lucide-react';

interface ConsentBannerProps {
  onConsentChange?: (consented: boolean) => void;
}

export const ConsentBanner: React.FC<ConsentBannerProps> = ({ onConsentChange }) => {
  const [hasConsented, setHasConsented] = useState<boolean>(true);
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    const saved = localStorage.getItem('vanivoice_mic_consent');
    if (!saved) {
      setHasConsented(false);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem('vanivoice_mic_consent', 'true');
    setHasConsented(true);
    setDismissed(true);
    onConsentChange?.(true);

    fetch('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consented: true, retentionDays }),
    }).catch(() => {});
  };

  if (hasConsented || dismissed) return null;

  return (
    <div
      role="region"
      aria-label="Microphone and Audio Privacy Notice"
      className="bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-4 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
    >
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-slate-300">
          <span className="font-bold text-white block">
            Microphone Access & Audio Privacy Notice (India DPDP Act Alignment)
          </span>
          <p className="text-slate-400 leading-relaxed max-w-3xl">
            This voice prototype processes spoken audio locally in your browser for speech-to-text. Call session transcripts are stored in your local session workspace. You can permanently delete stored transcripts at any time via <strong>"Delete My Data"</strong> in the Call Transcripts tab.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <select
          value={retentionDays}
          onChange={e => setRetentionDays(Number(e.target.value))}
          aria-label="Data retention period"
          className="bg-black/50 border border-white/[0.1] rounded-xl px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none"
        >
          <option value={7}>Retain 7 days</option>
          <option value={30}>Retain 30 days</option>
          <option value={0}>Delete on call end</option>
        </select>

        <button
          onClick={handleAccept}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all shadow-md cursor-pointer text-xs"
        >
          <Check className="w-3.5 h-3.5" />
          <span>I Understand & Consent</span>
        </button>
      </div>
    </div>
  );
};
