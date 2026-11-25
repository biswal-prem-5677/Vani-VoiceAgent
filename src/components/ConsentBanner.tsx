import React, { useState } from 'react';
import { ShieldCheck, Check, X } from 'lucide-react';

export interface ConsentChoice {
  decided: boolean;
  consented: boolean;
  retentionDays: 0 | 7 | 30 | 90;
}

interface ConsentBannerProps {
  authToken: string | null;
  tenantId: string;
  onConsentUpdated?: (choice: ConsentChoice) => void;
}

export const ConsentBanner: React.FC<ConsentBannerProps> = ({
  authToken,
  tenantId,
  onConsentUpdated,
}) => {
  const [retentionDays, setRetentionDays] = useState<0 | 7 | 30 | 90>(30);
  const [dismissed, setDismissed] = useState<boolean>(false);

  const submitChoice = async (consented: boolean, days: 0 | 7 | 30 | 90) => {
    setDismissed(true);
    onConsentUpdated?.({ decided: true, consented, retentionDays: days });

    if (!authToken) return;

    fetch('/api/consent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        consented,
        retentionDays: consented ? days : 0,
        tenantId,
      }),
    }).catch(() => {});
  };

  if (dismissed) return null;

  return (
    <div
      role="region"
      aria-label="Microphone and Audio Privacy Notice"
      className="bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-4 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs"
    >
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-slate-300">
          <span className="font-bold text-white block">
            Audio & Transcript Consent Notice (India DPDP Alignment)
          </span>
          <p className="text-slate-400 leading-relaxed max-w-3xl">
            Spoken audio uses your browser speech engine; transcribed turns are sent to our server for AI responses. Call transcripts are only saved if you consent with a retention window above 0 days. Choosing <strong>Delete on call end</strong> or <strong>Ephemeral Only</strong> keeps this session strictly ephemeral.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
        <select
          value={retentionDays}
          onChange={e => setRetentionDays(Number(e.target.value) as 0 | 7 | 30 | 90)}
          aria-label="Data retention period"
          className="bg-black/50 border border-white/[0.1] rounded-xl px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none"
        >
          <option value={7}>Retain 7 days</option>
          <option value={30}>Retain 30 days</option>
          <option value={90}>Retain 90 days</option>
          <option value={0}>Delete on call end (0 days)</option>
        </select>

        <button
          onClick={() => submitChoice(false, 0)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition-all cursor-pointer text-xs"
        >
          <X className="w-3.5 h-3.5" />
          <span>Ephemeral Only</span>
        </button>

        <button
          onClick={() => submitChoice(true, retentionDays)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all shadow-md cursor-pointer text-xs"
        >
          <Check className="w-3.5 h-3.5" />
          <span>Save & Consent</span>
        </button>
      </div>
    </div>
  );
};
