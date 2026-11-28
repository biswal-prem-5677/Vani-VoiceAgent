import React, { useState, useMemo, useEffect } from 'react';
import {
  Code,
  Copy,
  Check,
  Monitor,
  Sparkles,
  PhoneCall,
  X,
  Volume2,
  Info,
} from 'lucide-react';
import { TenantConfig } from '../types';
import { createSpeechController } from '../utils/speechSynthesis';

interface WidgetEmbedSimulatorProps {
  tenant: TenantConfig;
}

export const WidgetEmbedSimulator: React.FC<WidgetEmbedSimulatorProps> = ({ tenant }) => {
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [widgetPosition, setWidgetPosition] = useState<'right' | 'left'>('right');
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [activeCodeTab, setActiveCodeTab] = useState<'script' | 'react' | 'curl'>('script');
  const [simulatedMessages, setSimulatedMessages] = useState<string[]>([]);
  const [simulatedSpeaking, setSimulatedSpeaking] = useState(false);

  // Create speech controller once
  const speechCtrl = useMemo(() => createSpeechController(), []);

  useEffect(() => {
    return () => {
      speechCtrl.stop();
    };
  }, [speechCtrl]);

  const handleOpenWidget = () => {
    setWidgetOpen(true);
    const greeting = tenant.greetings[tenant.defaultLanguage] || tenant.greetings.en;
    setSimulatedMessages([greeting]);
    setSimulatedSpeaking(true);
    speechCtrl.speak(
      greeting,
      tenant.defaultLanguage,
      () => {
        setSimulatedSpeaking(false);
      },
      { speed: tenant.voicePersona.speed, pitch: tenant.voicePersona.pitch }
    );
  };

  const handleCloseWidget = () => {
    speechCtrl.stop();
    setWidgetOpen(false);
    setSimulatedSpeaking(false);
  };

  // Illustrative prototype integration snippets
  const scriptTagCode = `<!-- [ILLUSTRATIVE / PROTOTYPE EXAMPLE] HTML embed snippet -->
<div id="vanivoice-widget-root"></div>
<script>
  window.VaniVoiceConfig = {
    tenantId: "${tenant.id}",
    defaultLang: "${tenant.defaultLanguage}",
    primaryColor: "${tenant.primaryColor}",
    position: "bottom-${widgetPosition}",
    apiEndpoint: "https://your-domain.example/api/turn"
  };
</script>
<!-- Note: Widget CDN package is currently in internal prototype phase -->
<script src="/widget/vanivoice-bundle.js" async></script>`;

  const reactSnippet = `// [ILLUSTRATIVE / PROTOTYPE EXAMPLE] React component integration
import React from 'react';

// Connects to your backend /api/turn endpoint
export function VoiceAgentWidget() {
  return (
    <div
      data-tenant="${tenant.id}"
      data-primary-color="${tenant.primaryColor}"
      style={{ position: 'fixed', bottom: 24, ${widgetPosition}: 24, zIndex: 9999 }}
    >
      <button
        onClick={() => startVoiceSession({ tenantId: "${tenant.id}" })}
        style={{ backgroundColor: "${tenant.primaryColor}", color: '#fff', padding: '12px 20px', borderRadius: 9999 }}
      >
        Talk to ${tenant.agentName}
      </button>
    </div>
  );
}`;

  const curlSnippet = `# [LIVE WORKING ENDPOINT] 1) Mint caller session token, 2) Call /api/turn
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/caller-session | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(d.token)")
curl -X POST http://localhost:3000/api/turn \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $TOKEN" \\
  -d '{
    "tenantId": "${tenant.id}",
    "userText": "Hello, I want to book an appointment with Dr. Jena tomorrow",
    "language": "${tenant.defaultLanguage}",
    "memory": {}
  }'`;

  const getActiveCode = () => {
    switch (activeCodeTab) {
      case 'script':
        return scriptTagCode;
      case 'react':
        return reactSnippet;
      case 'curl':
        return curlSnippet;
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getActiveCode());
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-6 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Monitor className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white tracking-tight">
              Embeddable Web Widget Simulator
            </h2>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Test how this tenant's voice agent appears and behaves when embedded on an external website. Try the floating button on the right.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-400 font-mono">Widget Position:</label>
          <div className="flex bg-black/40 border border-white/[0.08] p-0.5 rounded-lg text-xs">
            <button
              onClick={() => setWidgetPosition('right')}
              className={`px-3 py-1 rounded font-mono text-[11px] transition-all cursor-pointer ${
                widgetPosition === 'right' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400'
              }`}
            >
              Bottom Right
            </button>
            <button
              onClick={() => setWidgetPosition('left')}
              className={`px-3 py-1 rounded font-mono text-[11px] transition-all cursor-pointer ${
                widgetPosition === 'left' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400'
              }`}
            >
              Bottom Left
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Code Snippets */}
        <div className="lg:col-span-6 bg-[#0D111A] border border-white/[0.08] rounded-2xl p-6 shadow-2xl flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Code className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Integration Snippets</h3>
              </div>

              <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/[0.06]">
                <button
                  onClick={() => setActiveCodeTab('script')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                    activeCodeTab === 'script' ? 'bg-indigo-600 text-white' : 'text-slate-400'
                  }`}
                >
                  HTML Embed
                </button>
                <button
                  onClick={() => setActiveCodeTab('react')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                    activeCodeTab === 'react' ? 'bg-indigo-600 text-white' : 'text-slate-400'
                  }`}
                >
                  React Component
                </button>
                <button
                  onClick={() => setActiveCodeTab('curl')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                    activeCodeTab === 'curl' ? 'bg-indigo-600 text-white' : 'text-slate-400'
                  }`}
                >
                  cURL Test
                </button>
              </div>
            </div>

            <div className="mt-3 relative">
              <pre className="p-4 rounded-xl bg-black/60 border border-white/[0.06] text-slate-300 font-mono text-xs overflow-x-auto leading-relaxed max-h-72">
                {getActiveCode()}
              </pre>

              <button
                onClick={handleCopy}
                aria-label="Copy snippet code"
                className="absolute top-3 right-3 p-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] text-slate-300 border border-white/[0.08] text-xs transition-all flex items-center gap-1.5 cursor-pointer"
              >
                {copiedSnippet ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-200/80">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              <strong>Note:</strong> Snippets above illustrate embedding patterns for the prototype. The `curl` command points directly to this server's live `/api/turn` route.
            </span>
          </div>
        </div>

        {/* Right: Mock Website Simulator */}
        <div className="lg:col-span-6 bg-[#080B10] border border-white/[0.1] rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[460px] relative">
          {/* Browser Top Chrome */}
          <div className="bg-[#0D111A] border-b border-white/[0.08] px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
            </div>

            <div className="bg-black/50 border border-white/[0.06] rounded-md px-3 py-1 text-[11px] font-mono text-slate-400 max-w-xs truncate">
              https://www.{tenant.id}.demo/portal
            </div>

            <div className="w-12" />
          </div>

          {/* Website Canvas Area */}
          <div className="flex-1 p-6 relative overflow-hidden flex flex-col justify-center items-center text-center">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-3 shadow-lg"
              style={{ backgroundColor: `${tenant.primaryColor}20`, border: `1px solid ${tenant.primaryColor}40` }}
            >
              <Sparkles className="w-6 h-6" style={{ color: tenant.primaryColor }} />
            </div>
            <h4 className="text-base font-bold text-white mb-1">{tenant.name}</h4>
            <p className="text-xs text-slate-400 max-w-sm mb-4">{tenant.tagline}</p>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Voice assistant ready in bottom {widgetPosition}</span>
            </div>

            {/* Simulated Floating Widget Button */}
            <div
              className={`absolute bottom-6 ${
                widgetPosition === 'right' ? 'right-6' : 'left-6'
              } z-20`}
            >
              {!widgetOpen ? (
                <button
                  onClick={handleOpenWidget}
                  style={{ backgroundColor: tenant.primaryColor }}
                  className="flex items-center gap-2 px-4 py-3 rounded-full text-white font-bold shadow-2xl hover:brightness-110 active:scale-95 transition-all text-xs cursor-pointer"
                >
                  <PhoneCall className="w-4 h-4 animate-bounce" />
                  <span>Talk to {tenant.agentName}</span>
                </button>
              ) : (
                <div className="bg-[#0D111A] border border-white/[0.12] rounded-2xl w-72 shadow-2xl overflow-hidden flex flex-col text-left">
                  {/* Widget Modal Header */}
                  <div
                    className="p-3.5 flex items-center justify-between text-white"
                    style={{ backgroundColor: tenant.primaryColor }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                      <span className="font-bold text-xs">{tenant.agentName} (Voice AI)</span>
                    </div>
                    <button
                      onClick={handleCloseWidget}
                      aria-label="Close widget"
                      className="p-1 rounded hover:bg-black/20 text-white transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Widget Body */}
                  <div className="p-3.5 space-y-2.5 max-h-48 overflow-y-auto text-xs">
                    {simulatedMessages.map((msg, i) => (
                      <div
                        key={i}
                        className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-slate-200"
                      >
                        {msg}
                      </div>
                    ))}
                    {simulatedSpeaking && (
                      <div className="flex items-center gap-1.5 text-xs text-indigo-400 italic">
                        <Volume2 className="w-3.5 h-3.5 animate-pulse" />
                        <span>Speaking response...</span>
                      </div>
                    )}
                  </div>

                  <div className="p-2.5 bg-black/40 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span>Lang: {tenant.defaultLanguage}</span>
                    <button
                      onClick={handleCloseWidget}
                      className="text-rose-400 hover:underline cursor-pointer"
                    >
                      End
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
