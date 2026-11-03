import React, { useState, useEffect, useMemo } from 'react';
import {
  Volume2,
  Sliders,
  Sparkles,
  Wrench,
  UserCheck,
  ShieldAlert,
  Play,
  Save,
  CheckCircle2,
  Globe2,
} from 'lucide-react';
import { TenantConfig, SupportedLanguage } from '../types';
import { SUPPORTED_LANGUAGES } from '../utils/languageDetector';
import { createSpeechController } from '../utils/speechSynthesis';

interface VoiceConfigTabProps {
  tenant: TenantConfig;
  onUpdateTenant: (updated: TenantConfig) => void;
}

export const VoiceConfigTab: React.FC<VoiceConfigTabProps> = ({
  tenant,
  onUpdateTenant,
}) => {
  // Sync state when tenant changes
  const [config, setConfig] = useState<TenantConfig>(tenant);
  const [savedNotice, setSavedNotice] = useState(false);
  const [testPlaying, setTestPlaying] = useState(false);

  useEffect(() => {
    setConfig(tenant);
  }, [tenant]);

  // Create speech controller once
  const speechCtrl = useMemo(() => createSpeechController(), []);

  const handleSave = () => {
    // Preserve any knowledgeBase chunks that might have been updated in KnowledgeBaseTab
    const merged: TenantConfig = {
      ...config,
      knowledgeBase: tenant.knowledgeBase,
    };
    onUpdateTenant(merged);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleTestVoiceSample = (lang: SupportedLanguage) => {
    setTestPlaying(true);
    const sample = config.greetings[lang] || config.greetings.en;
    speechCtrl.speak(
      sample,
      lang,
      () => {
        setTestPlaying(false);
      },
      {
        speed: config.voicePersona.speed,
        pitch: config.voicePersona.pitch,
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-6 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Sliders className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-bold text-white tracking-tight">
              Voice Persona, Multilingual Dialects & Tool Engine
            </h2>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Configure speaking rate, pitch, low-latency filler phrases, emergency contact escalation routing, and callable API tools.
          </p>
        </div>

        <button
          onClick={handleSave}
          aria-label="Save voice settings"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white shadow-xl bg-indigo-600 hover:bg-indigo-500 transition-all text-xs cursor-pointer"
        >
          {savedNotice ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Settings Saved</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              <span>Save Tenant Voice Config</span>
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Persona & Acoustic Modulation */}
        <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-6 shadow-2xl space-y-5">
          <div className="flex items-center gap-2 pb-3 border-b border-white/[0.08]">
            <Volume2 className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Acoustic Persona & Speech Modulation</h3>
          </div>

          <div className="space-y-4 text-xs">
            {/* Agent Name */}
            <div>
              <label className="block text-slate-300 font-medium mb-1.5">
                Agent Persona Name
              </label>
              <input
                type="text"
                value={config.agentName}
                onChange={e => setConfig({ ...config, agentName: e.target.value })}
                aria-label="Agent name"
                className="w-full bg-black/40 border border-white/[0.1] rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Speech Engine Provider */}
            <div>
              <label className="block text-slate-300 font-medium mb-1.5">
                Speech Synthesis Engine
              </label>
              <select
                value={config.voicePersona.provider}
                onChange={e =>
                  setConfig({
                    ...config,
                    voicePersona: { ...config.voicePersona, provider: e.target.value as any },
                  })
                }
                aria-label="Voice provider"
                className="w-full bg-black/40 border border-white/[0.1] rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-indigo-500"
              >
                <option value="Web Speech">Web Speech Synthesis (Browser Native)</option>
                <option value="Sarvam AI">Sarvam AI Saaras (Indic Optimized)</option>
                <option value="Google Cloud TTS">Google Cloud Text-to-Speech</option>
                <option value="ElevenLabs">ElevenLabs Multilingual v2</option>
              </select>
            </div>

            {/* Speed Slider */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-slate-300 font-medium">Speaking Rate (Speed)</span>
                <span className="font-mono text-emerald-400">{config.voicePersona.speed}x</span>
              </div>
              <input
                type="range"
                min="0.75"
                max="1.4"
                step="0.05"
                value={config.voicePersona.speed}
                onChange={e =>
                  setConfig({
                    ...config,
                    voicePersona: { ...config.voicePersona, speed: parseFloat(e.target.value) },
                  })
                }
                aria-label="Speaking rate"
                className="w-full accent-emerald-500"
              />
            </div>

            {/* Pitch Slider */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-slate-300 font-medium">Pitch Modulation</span>
                <span className="font-mono text-indigo-400">{config.voicePersona.pitch}x</span>
              </div>
              <input
                type="range"
                min="0.8"
                max="1.3"
                step="0.05"
                value={config.voicePersona.pitch}
                onChange={e =>
                  setConfig({
                    ...config,
                    voicePersona: { ...config.voicePersona, pitch: parseFloat(e.target.value) },
                  })
                }
                aria-label="Pitch modulation"
                className="w-full accent-indigo-500"
              />
            </div>

            {/* Audition Voice Sample */}
            <div className="pt-3 border-t border-white/[0.08]">
              <span className="block text-slate-300 font-medium mb-2">Audition Voice Greeting:</span>
              <div className="flex flex-wrap gap-2">
                {config.supportedLanguages.map(lang => (
                  <button
                    key={lang}
                    onClick={() => handleTestVoiceSample(lang)}
                    disabled={testPlaying}
                    aria-label={`Test ${lang} speech`}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 border border-white/[0.08] text-xs transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-current text-indigo-400" />
                    <span>{SUPPORTED_LANGUAGES[lang]?.name || lang}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Natural Spoken Fillers & Human Contact Routing */}
        <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-6 shadow-2xl space-y-5">
          <div className="flex items-center gap-2 pb-3 border-b border-white/[0.08]">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">Conversational Fillers & Escalation</h3>
          </div>

          <div className="space-y-4 text-xs">
            {/* Filler Phrases Manager */}
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Active Odia Spoken Fillers (Spoken during tool lookup)
              </label>
              <div className="space-y-1.5">
                {(config.fillers.or || []).map((filler, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded-xl bg-black/40 border border-white/[0.06] text-slate-300 font-sans"
                  >
                    "{filler}"
                  </div>
                ))}
              </div>
            </div>

            {/* Human Contact Routing */}
            <div className="pt-3 border-t border-white/[0.08] space-y-3">
              <label className="block text-slate-300 font-medium">
                Human Escalation & Safety Contact
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-400 text-[11px] block mb-1">Department / Desk</span>
                  <input
                    type="text"
                    value={config.humanHandoffContact.department}
                    onChange={e =>
                      setConfig({
                        ...config,
                        humanHandoffContact: {
                          ...config.humanHandoffContact,
                          department: e.target.value,
                        },
                      })
                    }
                    aria-label="Department"
                    className="w-full bg-black/40 border border-white/[0.1] rounded-xl px-3 py-1.5 text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <span className="text-slate-400 text-[11px] block mb-1">Escalation Phone</span>
                  <input
                    type="text"
                    value={config.humanHandoffContact.phone}
                    onChange={e =>
                      setConfig({
                        ...config,
                        humanHandoffContact: {
                          ...config.humanHandoffContact,
                          phone: e.target.value,
                        },
                      })
                    }
                    aria-label="Escalation Phone"
                    className="w-full bg-black/40 border border-white/[0.1] rounded-xl px-3 py-1.5 text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block mb-1">Escalation Email</span>
                <input
                  type="email"
                  value={config.humanHandoffContact.email}
                  onChange={e =>
                    setConfig({
                      ...config,
                      humanHandoffContact: {
                        ...config.humanHandoffContact,
                        email: e.target.value,
                      },
                    })
                  }
                  aria-label="Escalation Email"
                  className="w-full bg-black/40 border border-white/[0.1] rounded-xl px-3 py-1.5 text-white text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tools Catalog */}
      <div className="bg-[#0D111A] border border-white/[0.08] rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-white/[0.08]">
          <Wrench className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-bold text-white">Tenant-Scoped API Tools ({config.tools.length})</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {config.tools.map(tool => (
            <div
              key={tool.id}
              className="p-3.5 rounded-xl bg-black/40 border border-white/[0.06] space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">{tool.displayName}</span>
                <span className="font-mono text-[11px] text-emerald-400">{tool.name}</span>
              </div>
              <p className="text-slate-400 text-xs">{tool.description}</p>
              <div className="flex gap-1.5 flex-wrap pt-1 font-mono text-[11px]">
                {tool.parameters.map(p => (
                  <span
                    key={p.name}
                    className="px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-300"
                  >
                    {p.name}: {p.type} {p.required ? '*' : ''}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
