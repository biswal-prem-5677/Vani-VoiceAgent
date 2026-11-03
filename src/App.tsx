/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { LiveVoiceCall } from './components/LiveVoiceCall';
import { KnowledgeBaseTab } from './components/KnowledgeBaseTab';
import { VoiceConfigTab } from './components/VoiceConfigTab';
import { CallLogsTab } from './components/CallLogsTab';
import { EvaluationTab } from './components/EvaluationTab';
import { WidgetEmbedSimulator } from './components/WidgetEmbedSimulator';
import { NewTenantModal } from './components/NewTenantModal';
import { ConsentBanner } from './components/ConsentBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OfflineIndicator } from './components/OfflineIndicator';
import { LegalModal } from './components/LegalModal';
import { SupportDeskModal } from './components/SupportDeskModal';
import { SystemStatusModal } from './components/SystemStatusModal';
import { ShareModal } from './components/ShareModal';
import { INITIAL_TENANTS } from './data/tenants';
import { INITIAL_CALL_LOGS } from './data/mockCallLogs';
import { TenantConfig, DocumentChunk, CallLog } from './types';
import { Zap, Globe2, ShieldCheck, HeartHandshake, Lock, Activity, Share2 } from 'lucide-react';

export default function App() {
  const [tenants, setTenants] = useState<TenantConfig[]>(INITIAL_TENANTS);
  const [activeTenant, setActiveTenant] = useState<TenantConfig>(INITIAL_TENANTS[0]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('call');
  const [callLogs, setCallLogs] = useState<CallLog[]>(INITIAL_CALL_LOGS);
  const [isNewTenantModalOpen, setIsNewTenantModalOpen] = useState<boolean>(false);
  const [isLegalModalOpen, setIsLegalModalOpen] = useState<boolean>(false);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState<boolean>(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);

  // Load persisted tenants & logs from server on mount
  useEffect(() => {
    fetch('/api/tenants')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setTenants(data);
          setActiveTenant(data[0]);
        }
      })
      .catch(() => {});

    fetch('/api/logs')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (Array.isArray(data)) {
          setCallLogs(data);
        }
      })
      .catch(() => {});
  }, []);

  const handleTenantCreated = (newTenant: TenantConfig) => {
    setTenants(prev => [...prev, newTenant]);
    setActiveTenant(newTenant);
    fetch('/api/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTenant),
    }).catch(err => console.warn('Failed to save tenant:', err));
  };

  const handleUpdateKnowledgeBase = (updatedChunks: DocumentChunk[]) => {
    const updated = { ...activeTenant, knowledgeBase: updatedChunks };
    setActiveTenant(updated);
    setTenants(prev => prev.map(t => (t.id === updated.id ? updated : t)));
    fetch(`/api/tenants/${updated.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(err => console.warn('Failed to update tenant KB:', err));
  };

  const handleUpdateTenantConfig = (updatedTenant: TenantConfig) => {
    setActiveTenant(updatedTenant);
    setTenants(prev => prev.map(t => (t.id === updatedTenant.id ? updatedTenant : t)));
    fetch(`/api/tenants/${updatedTenant.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedTenant),
    }).catch(err => console.warn('Failed to update tenant config:', err));
  };

  const handleCallEnded = (newLog: CallLog) => {
    setCallLogs(prev => [newLog, ...prev]);
  };

  const handleClearLogs = () => {
    setCallLogs([]);
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#080B10] text-[#F1F5F9] flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
        {/* Navbar with Tenant Switcher, Actions & Navigation Tabs */}
        <Navbar
          tenants={tenants}
          activeTenant={activeTenant}
          onSelectTenant={setActiveTenant}
          onAddNewTenant={() => setIsNewTenantModalOpen(true)}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onStartCallFromNav={() => setActiveTab('call')}
          onOpenLegal={() => setIsLegalModalOpen(true)}
          onOpenSupport={() => setIsSupportModalOpen(true)}
          onOpenStatus={() => setIsStatusModalOpen(true)}
          onOpenShare={() => setIsShareModalOpen(true)}
        />

        {/* Offline Connectivity Warning Banner */}
        <OfflineIndicator />

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          {/* Audio Privacy & Consent Notice */}
          <ConsentBanner />

          {/* Sub-header Context Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-[#0D111A] border border-white/[0.08] text-xs">
            <div className="flex items-center gap-2.5">
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                style={{ backgroundColor: activeTenant.primaryColor }}
              />
              <span className="text-slate-400">Active Tenant:</span>
              <span className="font-bold text-white">{activeTenant.name}</span>
              <span className="text-slate-400 hidden md:inline">({activeTenant.tagline})</span>
            </div>

            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span className="flex items-center gap-1.5 text-slate-300">
                <Globe2 className="w-3.5 h-3.5 text-indigo-400" />
                <span>Odia • Hindi • Hinglish • Bengali • English</span>
              </span>
              <span className="text-slate-600">·</span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Safety Emergency Router Active</span>
              </span>
            </div>
          </div>

          {/* Tab Views with Key Reset on Tenant Switch */}
          {activeTab === 'call' && (
            <LiveVoiceCall
              key={`call_${activeTenant.id}`}
              tenant={activeTenant}
              onCallEnded={handleCallEnded}
            />
          )}

          {activeTab === 'knowledge' && (
            <KnowledgeBaseTab
              key={`kb_${activeTenant.id}`}
              tenant={activeTenant}
              onUpdateKnowledgeBase={handleUpdateKnowledgeBase}
            />
          )}

          {activeTab === 'voice' && (
            <VoiceConfigTab
              key={`voice_${activeTenant.id}`}
              tenant={activeTenant}
              onUpdateTenant={handleUpdateTenantConfig}
            />
          )}

          {activeTab === 'logs' && (
            <CallLogsTab logs={callLogs} onClearLogs={handleClearLogs} />
          )}

          {activeTab === 'eval' && (
            <EvaluationTab />
          )}

          {activeTab === 'widget' && (
            <WidgetEmbedSimulator key={`widget_${activeTenant.id}`} tenant={activeTenant} />
          )}
        </main>

        {/* Compliant Production Footer */}
        <footer className="border-t border-white/[0.08] bg-[#07090E] py-6 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-400">
            <div className="flex flex-col sm:flex-row items-center gap-3 text-center sm:text-left">
              <span className="font-bold text-white">VaniVoice AI</span>
              <span className="hidden sm:inline text-slate-600">|</span>
              <span className="font-mono text-[11px] text-slate-400">
                Multilingual Voice Agent Engine (Odia, Hindi, Hinglish, Bengali, English)
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 text-[11px]">
              <button
                onClick={() => setIsStatusModalOpen(true)}
                className="hover:text-emerald-400 transition cursor-pointer flex items-center gap-1"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span>System Status</span>
              </button>

              <button
                onClick={() => setIsSupportModalOpen(true)}
                className="hover:text-white transition cursor-pointer flex items-center gap-1"
              >
                <HeartHandshake className="w-3.5 h-3.5 text-indigo-400" />
                <span>Support & Contact</span>
              </button>

              <button
                onClick={() => setIsLegalModalOpen(true)}
                className="hover:text-white transition cursor-pointer flex items-center gap-1"
              >
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>Privacy, Terms & Manifest</span>
              </button>

              <button
                onClick={() => setIsShareModalOpen(true)}
                className="hover:text-white transition cursor-pointer flex items-center gap-1"
              >
                <Share2 className="w-3.5 h-3.5 text-sky-400" />
                <span>Share Prototype</span>
              </button>
            </div>
          </div>

          <div className="max-w-7xl mx-auto mt-4 pt-3 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between text-[10px] text-slate-500 font-mono">
            <span>© 2026 VaniVoice AI. Built for real-world enterprise Indian voice deployments.</span>
            <span className="mt-1 sm:mt-0">Licensed under Apache-2.0. No 3rd-party tracking SDKs.</span>
          </div>
        </footer>

        {/* Modals */}
        <NewTenantModal
          isOpen={isNewTenantModalOpen}
          onClose={() => setIsNewTenantModalOpen(false)}
          onTenantCreated={handleTenantCreated}
        />

        <LegalModal
          isOpen={isLegalModalOpen}
          onClose={() => setIsLegalModalOpen(false)}
          onDataWiped={() => {
            fetch('/api/tenants')
              .then(res => res.json())
              .then(data => {
                if (Array.isArray(data)) {
                  setTenants(data);
                  setActiveTenant(data[0]);
                }
              });
            setCallLogs([]);
          }}
        />

        <SupportDeskModal
          isOpen={isSupportModalOpen}
          onClose={() => setIsSupportModalOpen(false)}
        />

        <SystemStatusModal
          isOpen={isStatusModalOpen}
          onClose={() => setIsStatusModalOpen(false)}
        />

        <ShareModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
        />
      </div>
    </ErrorBoundary>
  );
}
