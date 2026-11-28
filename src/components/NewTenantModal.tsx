import React, { useState, useEffect } from 'react';
import { Building2, X, Plus } from 'lucide-react';
import { TenantConfig, SupportedLanguage } from '../types';

interface NewTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTenantCreated: (tenant: TenantConfig) => void;
}

export const NewTenantModal: React.FC<NewTenantModalProps> = ({
  isOpen,
  onClose,
  onTenantCreated,
}) => {
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [category, setCategory] = useState<'clinic' | 'coaching' | 'logistics' | 'university' | 'custom'>('custom');
  const [agentName, setAgentName] = useState('Ananya');
  const [defaultLanguage, setDefaultLanguage] = useState<SupportedLanguage>('or');
  const primaryColor = '#10B981';
  const [escalationEmail, setEscalationEmail] = useState('');
  const initialDocTitle = 'Business Overview & FAQs';
  const [initialDocContent, setInitialDocContent] = useState(
    'Our business operates Monday to Saturday 9:00 AM to 6:00 PM. We provide local delivery and instant support in Odia, Hindi, and English.'
  );

  // Auto-generate sanitized email slug when name changes (ASCII only)
  useEffect(() => {
    const slug = name
      .toLowerCase()
      .replace(/[^\w]/g, '')
      .slice(0, 20) || 'support';
    setEscalationEmail(`escalation@${slug}.local`);
  }, [name]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newId = `tenant_${Date.now()}`;
    const newTenant: TenantConfig = {
      id: newId,
      name,
      tagline: tagline || `${name} Voice Service Desk`,
      category,
      primaryColor,
      accentColor: primaryColor,
      logoIcon: 'Building2',
      agentName,
      voicePersona: {
        gender: 'female',
        speed: 1.05,
        pitch: 1.0,
        tone: 'Friendly and professional assistant',
        provider: 'Sarvam AI',
      },
      supportedLanguages: ['or', 'hi', 'en', 'hinglish'],
      defaultLanguage,
      systemPrompt: `You are ${agentName}, the AI voice receptionist for ${name}. Speak natural spoken Odia, Hindi, and English. Keep answers under 2 sentences. Always identify as an AI assistant.`,
      greetings: {
        or: `ନମସ୍କାର! ${name}କୁ ସ୍ୱାଗତ। ମୁଁ ଏଆଇ ସହାୟକ ${agentName} କହୁଛି, କିପରି ସାହାଯ୍ୟ କରିପାରିବି?`,
        hi: `नमस्ते! ${name} में आपका स्वागत है। मैं एआई असिस्टेंट ${agentName}, आपकी क्या सहायता करूँ?`,
        hinglish: `Hello! Welcome to ${name}. Main AI voice assistant ${agentName} hoon, how can I help you today?`,
        bn: `নমস্কার! ${name}-এ স্বাগতম। আমি এআই সহকারী ${agentName}, কীভাবে সাহায্য করতে পারি?`,
        en: `Hello and welcome to ${name}. I am ${agentName}, an AI voice assistant. How may I assist you today?`,
      },
      fillers: {
        or: ['ହଁ ଆଜ୍ଞା, ମୁଁ ତୁରନ୍ତ ଦେଖି ଜଣାଉଛି...', 'ଟିକିଏ ଅପେକ୍ଷା କରନ୍ତୁ...'],
        hi: ['जी, मैं अभी सिस्टम में चेक करता हूँ...', 'एक सेकंड दीजिए...'],
        hinglish: ['One sec, let me pull that up for you...', 'Checking right away...'],
        bn: ['একটু অপেক্ষা করুন, আমি দেখে নিচ্ছি...'],
        en: ['Checking that for you right now...', 'One moment please...'],
      },
      knowledgeBase: [
        {
          id: `doc_${Date.now()}_1`,
          title: initialDocTitle,
          content: initialDocContent,
          category: 'Company Policy',
          tags: ['faq', 'timings', 'services'],
          addedAt: new Date().toISOString().slice(0, 10),
        },
      ],
      tools: [
        {
          id: `tool_${Date.now()}`,
          name: 'raise_support_ticket',
          displayName: 'Create Customer Service Ticket',
          description: 'Generates reference ticket for follow-up inquiries.',
          parameters: [
            { name: 'issue', type: 'string', description: 'Query details', required: true },
          ],
          handlerType: 'mock_ticket',
        },
      ],
      humanHandoffContact: {
        department: 'Customer Escalations Team',
        phone: '+91-00000-00000',
        email: escalationEmail || 'support@tenant.local',
      },
    };

    onTenantCreated(newTenant);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div className="bg-[#0D111A] border border-white/[0.1] rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
        <div className="flex items-center justify-between pb-3.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-emerald-400" />
            <h3 id="modal-title" className="text-base font-bold text-white tracking-tight">Deploy New Business Tenant</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-300 mb-1">Company / Business Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Jagannath Sweets & Bakers (Bhubaneswar)"
              aria-label="Business Name"
              className="w-full bg-[#131926] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-slate-200 focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-300 mb-1">Tagline</label>
              <input
                type="text"
                value={tagline}
                onChange={e => setTagline(e.target.value)}
                placeholder="e.g. Traditional Odia Delicacies"
                aria-label="Tagline"
                className="w-full bg-[#131926] border border-white/[0.08] rounded-xl px-3.5 py-2 text-slate-200 text-xs"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-300 mb-1">Agent Persona Name</label>
              <input
                type="text"
                value={agentName}
                onChange={e => setAgentName(e.target.value)}
                aria-label="Agent Persona Name"
                className="w-full bg-[#131926] border border-white/[0.08] rounded-xl px-3.5 py-2 text-slate-200 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-300 mb-1">Default Spoken Language</label>
              <select
                value={defaultLanguage}
                onChange={e => setDefaultLanguage(e.target.value as SupportedLanguage)}
                aria-label="Default Spoken Language"
                className="w-full bg-[#131926] border border-white/[0.08] rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none"
              >
                <option value="or">Odia (ଓଡ଼ିଆ)</option>
                <option value="hi">Hindi (हिन्दी)</option>
                <option value="hinglish">Hinglish</option>
                <option value="bn">Bengali (বাংলা)</option>
                <option value="en">Indian English</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-300 mb-1">Business Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as any)}
                aria-label="Business Category"
                className="w-full bg-[#131926] border border-white/[0.08] rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none"
              >
                <option value="clinic">Clinic / Healthcare</option>
                <option value="coaching">Coaching / EdTech</option>
                <option value="logistics">Logistics / E-Commerce</option>
                <option value="university">University / Higher Ed</option>
                <option value="custom">Custom Enterprise</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-300 mb-1">Escalation Email (Sanitized Slug)</label>
            <input
              type="email"
              value={escalationEmail}
              onChange={e => setEscalationEmail(e.target.value)}
              aria-label="Escalation Email"
              className="w-full bg-[#131926] border border-white/[0.08] rounded-xl px-3.5 py-2 text-slate-200 text-xs"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-300 mb-1">Seed Document Content (RAG)</label>
            <textarea
              rows={3}
              value={initialDocContent}
              onChange={e => setInitialDocContent(e.target.value)}
              aria-label="Seed Document Content"
              className="w-full bg-[#131926] border border-white/[0.08] rounded-xl p-3 text-slate-200 text-xs focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-white transition-colors cursor-pointer text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-all shadow-lg cursor-pointer text-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Deploy Tenant</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
