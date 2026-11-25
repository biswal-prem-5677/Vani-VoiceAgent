/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { LiveVoiceCall } from './components/LiveVoiceCall';
import { KnowledgeBaseTab } from './components/KnowledgeBaseTab';
import { VoiceConfigTab } from './components/VoiceConfigTab';
import { CallLogsTab } from './components/CallLogsTab';
import { EvaluationTab } from './components/EvaluationTab';
import { WidgetEmbedSimulator } from './components/WidgetEmbedSimulator';
import { NewTenantModal } from './components/NewTenantModal';
import { ConsentBanner, ConsentChoice } from './components/ConsentBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OfflineIndicator } from './components/OfflineIndicator';
import { LegalModal } from './components/LegalModal';
import { SupportDeskModal } from './components/SupportDeskModal';
import { SystemStatusModal } from './components/SystemStatusModal';
import { ShareModal } from './components/ShareModal';
import { AdminAuthPanel } from './components/AdminAuthPanel';
import { INITIAL_TENANTS } from './data/tenants';
import {
  TenantConfig,
  DocumentChunk,
  CallLog,
  AuthUser,
  HandoffTicket,
  AppointmentRecord,
  AuditLogEntry,
  IntegrationDelivery,
  OperationalMetricsSummary,
  WorkspaceUserRecord,
} from './types';
import { testConnection, getFirebaseAuth, signOutFirebase } from './lib/firebase';
import {
  syncTenantWorkspaceToFirestore,
  persistCallSessionToFirestore,
  persistHandoffToFirestore,
  updateHandoffInFirestore,
  updateAppointmentInFirestore,
  deleteUserSessionDocsFromFirestore,
} from './lib/firestoreStore';
import {
  Globe2,
  ShieldCheck,
  HeartHandshake,
  Lock,
  Activity,
  Share2,
  AlertCircle,
} from 'lucide-react';

export default function App() {
  const [tenants, setTenants] = useState<TenantConfig[]>(INITIAL_TENANTS);
  const [activeTenant, setActiveTenant] = useState<TenantConfig>(INITIAL_TENANTS[0]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('call');
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffTicket[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationDelivery[]>([]);
  const [operationalMetrics, setOperationalMetrics] = useState<OperationalMetricsSummary | null>(null);
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUserRecord[]>([]);

  // In-memory auth session state (tokens are never written to localStorage/sessionStorage)
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [sessionMeta, setSessionMeta] = useState<{
    loaded: boolean;
    adminBootstrapNeeded: boolean;
    bootstrapRequiresToken: boolean;
    passcodeConfigured: boolean;
    serverAiActive: boolean | null;
  }>({
    loaded: false,
    adminBootstrapNeeded: false,
    bootstrapRequiresToken: false,
    passcodeConfigured: false,
    serverAiActive: null,
  });

  const [consentChoice, setConsentChoice] = useState<ConsentChoice>({
    decided: false,
    consented: false,
    retentionDays: 0,
  });

  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isNewTenantModalOpen, setIsNewTenantModalOpen] = useState<boolean>(false);
  const [isLegalModalOpen, setIsLegalModalOpen] = useState<boolean>(false);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState<boolean>(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);
  const [adminErrorBanner, setAdminErrorBanner] = useState<string | null>(null);

  const isAdmin =
    authUser?.role === 'super_admin' || authUser?.role === 'tenant_admin';
  const isSuperAdmin = authUser?.role === 'super_admin';

  const fetchTenantsForToken = useCallback(async (token: string | null) => {
    try {
      const res = await fetch('/api/tenants', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setTenants(data);
        setActiveTenant(prev => data.find((t: TenantConfig) => t.id === prev.id) || data[0]);
      }
    } catch {
      // keep existing fallback summaries
    }
  }, []);

  const loadCallerLogs = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/session/logs', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setCallLogs(data);
      }
    } catch {
      // ignore
    }
  }, []);

  const loadAdminWorkspaceData = useCallback(async (token: string, role?: AuthUser['role']) => {
    await fetchTenantsForToken(token);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [logsRes, handoffsRes, apptsRes, auditRes, intRes, metricsRes, usersRes] = await Promise.all([
        fetch('/api/logs', { headers }),
        fetch('/api/handoffs', { headers }),
        fetch('/api/appointments', { headers }),
        fetch('/api/audit-logs', { headers }),
        fetch('/api/integrations', { headers }),
        fetch('/api/metrics/operational', { headers }),
        role === 'super_admin' ? fetch('/api/auth/users', { headers }) : Promise.resolve(null),
      ]);
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        if (Array.isArray(logsData)) setCallLogs(logsData);
      }
      if (handoffsRes.ok) {
        const handoffsData = await handoffsRes.json();
        if (Array.isArray(handoffsData)) setHandoffs(handoffsData);
      }
      if (apptsRes.ok) {
        const apptsData = await apptsRes.json();
        if (Array.isArray(apptsData)) setAppointments(apptsData);
      }
      if (auditRes.ok) {
        const auditData = await auditRes.json();
        if (Array.isArray(auditData)) setAuditLogs(auditData);
      }
      if (intRes.ok) {
        const intData = await intRes.json();
        if (Array.isArray(intData)) setIntegrations(intData);
      }
      if (metricsRes.ok) {
        const metricsData = await metricsRes.json();
        if (metricsData && typeof metricsData.totalSessions === 'number') {
          setOperationalMetrics(metricsData);
        }
      }
      if (usersRes && usersRes.ok) {
        const usersData = await usersRes.json();
        if (Array.isArray(usersData)) setWorkspaceUsers(usersData);
      }
    } catch {
      // ignore
    }
  }, [fetchTenantsForToken]);

  const bootstrapCallerSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/caller-session', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data?.token && data?.user) {
          setAuthToken(data.token);
          setAuthUser(data.user);
          await fetchTenantsForToken(data.token);
          await loadCallerLogs(data.token);
          return;
        }
      }
    } catch {
      // fallback without token until reconnect
    }
    await fetchTenantsForToken(null);
  }, [fetchTenantsForToken, loadCallerLogs]);

  // Initial mount: read server capabilities, probe Firestore connectivity, and initialize caller session
  useEffect(() => {
    void testConnection();
    fetch('/api/session')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data) {
          setSessionMeta({
            loaded: true,
            adminBootstrapNeeded: Boolean(data.adminBootstrapNeeded),
            bootstrapRequiresToken: Boolean(data.bootstrapRequiresToken),
            passcodeConfigured: Boolean(data.passcodeConfigured),
            serverAiActive: Boolean(data.serverAiActive),
          });
        } else {
          setSessionMeta(prev => ({ ...prev, loaded: true, serverAiActive: false }));
        }
      })
      .catch(() => {
        setSessionMeta(prev => ({ ...prev, loaded: true, serverAiActive: false }));
      });

    bootstrapCallerSession();
  }, [bootstrapCallerSession]);

  const handleAdminAuthenticated = async (token: string, user: AuthUser) => {
    setAuthToken(token);
    setAuthUser(user);
    setSessionMeta(prev => ({ ...prev, adminBootstrapNeeded: false }));
    setIsAuthModalOpen(false);
    setAdminErrorBanner(null);
    if (user.role === 'super_admin' || user.role === 'tenant_admin') {
      await loadAdminWorkspaceData(token, user.role);
    } else {
      await fetchTenantsForToken(token);
      await loadCallerLogs(token);
    }
  };

  const handleSignOut = async () => {
    setHandoffs([]);
    setAppointments([]);
    setAuditLogs([]);
    setIntegrations([]);
    setOperationalMetrics(null);
    setWorkspaceUsers([]);
    setCallLogs([]);
    setAdminErrorBanner(null);
    setAuthToken(null);
    setAuthUser(null);
    await signOutFirebase().catch(() => {});
    await bootstrapCallerSession();
  };

  const handleConsentUpdated = (choice: ConsentChoice) => {
    setConsentChoice(choice);
    if (!choice.consented || choice.retentionDays === 0) {
      // Zero-retention removes current session logs immediately
      if (!isAdmin) {
        setCallLogs([]);
      }
    }
  };

  const handleAddNewTenantRequest = () => {
    if (!isSuperAdmin) {
      setAdminErrorBanner('Workspace Super-Admin sign-in is required to deploy a new tenant.');
      setIsAuthModalOpen(true);
      return;
    }
    setIsNewTenantModalOpen(true);
  };

  const handleTenantCreated = async (newTenant: TenantConfig) => {
    if (!authToken) return;
    setAdminErrorBanner(null);
    try {
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(newTenant),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAdminErrorBanner(data.error || `Failed to save tenant (${res.status}).`);
        return;
      }
      const saved = data.tenant || newTenant;
      setTenants(prev => [...prev, saved]);
      setActiveTenant(saved);
      const fbUid = getFirebaseAuth().currentUser?.uid;
      if (fbUid) {
        void syncTenantWorkspaceToFirestore(saved, fbUid).catch(() => {});
      }
    } catch (err) {
      setAdminErrorBanner('Failed to create tenant: ' + String(err));
    }
  };

  const handleUpdateKnowledgeBase = async (updatedChunks: DocumentChunk[]) => {
    if (!authToken || !isAdmin) return;
    setAdminErrorBanner(null);
    const previous = activeTenant;
    const updated = { ...activeTenant, knowledgeBase: updatedChunks };
    setActiveTenant(updated);
    setTenants(prev => prev.map(t => (t.id === updated.id ? updated : t)));

    try {
      const res = await fetch(`/api/tenants/${updated.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(updated),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActiveTenant(previous);
        setTenants(prev => prev.map(t => (t.id === previous.id ? previous : t)));
        setAdminErrorBanner(data.error || `Failed to save knowledge base (${res.status}).`);
      }
    } catch (err) {
      setActiveTenant(previous);
      setTenants(prev => prev.map(t => (t.id === previous.id ? previous : t)));
      setAdminErrorBanner('Network error updating knowledge base: ' + String(err));
    }
  };

  const handleUpdateTenantConfig = async (updatedTenant: TenantConfig) => {
    if (!authToken || !isAdmin) return;
    setAdminErrorBanner(null);
    const previous = activeTenant;
    setActiveTenant(updatedTenant);
    setTenants(prev => prev.map(t => (t.id === updatedTenant.id ? updatedTenant : t)));

    try {
      const res = await fetch(`/api/tenants/${updatedTenant.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(updatedTenant),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActiveTenant(previous);
        setTenants(prev => prev.map(t => (t.id === previous.id ? previous : t)));
        setAdminErrorBanner(data.error || `Failed to update tenant settings (${res.status}).`);
        return;
      }
      const fbUid = getFirebaseAuth().currentUser?.uid;
      if (fbUid) {
        void syncTenantWorkspaceToFirestore(data.tenant || updatedTenant, fbUid).catch(() => {});
      }
    } catch (err) {
      setActiveTenant(previous);
      setTenants(prev => prev.map(t => (t.id === previous.id ? previous : t)));
      setAdminErrorBanner('Network error updating tenant settings: ' + String(err));
    }
  };

  const handleCallEnded = (newLog: CallLog, persisted: boolean) => {
    if (persisted) {
      setCallLogs(prev => [newLog, ...prev]);
      const fbUid = getFirebaseAuth().currentUser?.uid;
      if (fbUid && consentChoice.retentionDays > 0) {
        void persistCallSessionToFirestore(newLog, fbUid, consentChoice.retentionDays).catch(() => {});
      }
    }
    if (isAdmin && authToken) {
      loadAdminWorkspaceData(authToken, authUser?.role);
    }
  };

  const handleHandoffCreated = (ticket: HandoffTicket) => {
    const fbUid = getFirebaseAuth().currentUser?.uid;
    if (fbUid) {
      void persistHandoffToFirestore(ticket, fbUid).catch(() => {});
    }
    if (isAdmin) {
      setHandoffs(prev => [ticket, ...prev]);
    }
  };

  const handleUpdateHandoffStatus = async (
    id: string,
    status: HandoffTicket['status']
  ) => {
    if (!authToken) return;
    const res = await fetch(`/api/handoffs/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Failed to update handoff (${res.status})`);
    }
    setHandoffs(prev =>
      prev.map(h => (h.id === id ? { ...h, status, updatedAt: Date.now() } : h))
    );
    if (getFirebaseAuth().currentUser?.uid) {
      void updateHandoffInFirestore(id, status).catch(() => {});
    }
  };

  const handleUpdateAppointmentStatus = async (
    id: string,
    status: AppointmentRecord['status']
  ) => {
    if (!authToken) return;
    const res = await fetch(`/api/appointments/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Failed to update appointment (${res.status})`);
    }
    setAppointments(prev => prev.map(a => (a.id === id ? { ...a, status } : a)));
    if (data?.integrationDelivery) {
      setIntegrations(prev => [data.integrationDelivery, ...prev]);
    }
    if (getFirebaseAuth().currentUser?.uid) {
      void updateAppointmentInFirestore(id, status).catch(() => {});
    }
  };

  const handleRetryIntegration = async (id: string) => {
    if (!authToken) return;
    const res = await fetch(`/api/integrations/${id}/retry`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Retry failed (${res.status})`);
    }
    if (data?.delivery) {
      setIntegrations(prev => prev.map(item => (item.id === id ? data.delivery : item)));
    }
  };

  const handleUpdateUserRole = async (userId: string, role: WorkspaceUserRecord['role']) => {
    if (!authToken) return;
    const res = await fetch(`/api/auth/users/${userId}/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Role update failed (${res.status})`);
    }
    if (data?.user) {
      setWorkspaceUsers(prev =>
        prev.map(u =>
          u.id === userId ? { ...u, role: data.user.role, allowedTenants: data.user.allowedTenants } : u
        )
      );
    }
  };

  const handleToggleUserRevoke = async (userId: string, revoked: boolean) => {
    if (!authToken) return;
    const res = await fetch(`/api/auth/users/${userId}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ revoked }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Revocation update failed (${res.status})`);
    }
    setWorkspaceUsers(prev => prev.map(u => (u.id === userId ? { ...u, revoked } : u)));
  };

  const handleClearLogs = () => {
    setCallLogs([]);
    const fbUid = getFirebaseAuth().currentUser?.uid;
    if (fbUid && !isAdmin) {
      void deleteUserSessionDocsFromFirestore(fbUid).catch(() => {});
    }
  };

  const canPersistLogs = consentChoice.consented && consentChoice.retentionDays > 0;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#080B10] text-[#F1F5F9] flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
        {/* Navbar with Tenant Switcher, Auth & Navigation Tabs */}
        <Navbar
          tenants={tenants}
          activeTenant={activeTenant}
          onSelectTenant={setActiveTenant}
          onAddNewTenant={handleAddNewTenantRequest}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onStartCallFromNav={() => setActiveTab('call')}
          onOpenLegal={() => setIsLegalModalOpen(true)}
          onOpenSupport={() => setIsSupportModalOpen(true)}
          onOpenStatus={() => setIsStatusModalOpen(true)}
          onOpenShare={() => setIsShareModalOpen(true)}
          authUser={authUser}
          onOpenAuth={() => setIsAuthModalOpen(true)}
          onSignOut={handleSignOut}
        />

        {/* Offline Connectivity Warning Banner */}
        <OfflineIndicator />

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          {/* Audio Privacy & Consent Notice */}
          <ConsentBanner
            authToken={authToken}
            tenantId={activeTenant.id}
            onConsentUpdated={handleConsentUpdated}
          />

          {adminErrorBanner && (
            <div
              role="alert"
              className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-200 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{adminErrorBanner}</span>
              </div>
              <button
                onClick={() => setAdminErrorBanner(null)}
                className="text-slate-300 hover:text-white px-2 py-0.5 rounded bg-white/5 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

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
                <span>Safety Router Active</span>
              </span>
            </div>
          </div>

          {/* Tab Views with Key Reset on Tenant Switch */}
          {activeTab === 'call' && (
            <LiveVoiceCall
              key={`call_${activeTenant.id}`}
              tenant={activeTenant}
              authToken={authToken}
              canPersistLogs={canPersistLogs}
              geminiConfigured={sessionMeta.serverAiActive}
              onCallEnded={handleCallEnded}
              onHandoffCreated={handleHandoffCreated}
            />
          )}

          {activeTab === 'knowledge' && (
            isAdmin ? (
              <KnowledgeBaseTab
                key={`kb_${activeTenant.id}`}
                tenant={activeTenant}
                onUpdateKnowledgeBase={handleUpdateKnowledgeBase}
              />
            ) : (
              <div className="py-8">
                <AdminAuthPanel
                  adminBootstrapNeeded={sessionMeta.adminBootstrapNeeded}
                  bootstrapRequiresToken={sessionMeta.bootstrapRequiresToken}
                  passcodeConfigured={sessionMeta.passcodeConfigured}
                  onAuthenticated={handleAdminAuthenticated}
                  title="Sign In to Manage Knowledge Base"
                  subtitle="Tenant system prompts and document collections are restricted to authorized tenant administrators."
                />
              </div>
            )
          )}

          {activeTab === 'voice' && (
            isAdmin ? (
              <VoiceConfigTab
                key={`voice_${activeTenant.id}`}
                tenant={activeTenant}
                onUpdateTenant={handleUpdateTenantConfig}
              />
            ) : (
              <div className="py-8">
                <AdminAuthPanel
                  adminBootstrapNeeded={sessionMeta.adminBootstrapNeeded}
                  bootstrapRequiresToken={sessionMeta.bootstrapRequiresToken}
                  passcodeConfigured={sessionMeta.passcodeConfigured}
                  onAuthenticated={handleAdminAuthenticated}
                  title="Sign In to Configure Voice & Tools"
                  subtitle="Voice persona parameters, escalation contacts, and tool definitions require tenant administrator access."
                />
              </div>
            )
          )}

          {activeTab === 'logs' && (
            <CallLogsTab
              logs={callLogs}
              handoffs={handoffs}
              appointments={appointments}
              auditLogs={auditLogs}
              integrations={integrations}
              operationalMetrics={operationalMetrics}
              workspaceUsers={workspaceUsers}
              isAdmin={isAdmin}
              isSuperAdmin={isSuperAdmin}
              authToken={authToken}
              onClearLogs={handleClearLogs}
              onUpdateHandoffStatus={handleUpdateHandoffStatus}
              onUpdateAppointmentStatus={handleUpdateAppointmentStatus}
              onRetryIntegration={handleRetryIntegration}
              onUpdateUserRole={handleUpdateUserRole}
              onToggleUserRevoke={handleToggleUserRevoke}
              onOpenAuth={() => setIsAuthModalOpen(true)}
            />
          )}

          {activeTab === 'eval' && (
            <EvaluationTab authToken={authToken} />
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
                Multilingual Voice Agent Prototype (Odia, Hindi, Hinglish, Bengali, English)
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
            <span>© 2026 VaniVoice AI. Multilingual voice workflow prototype.</span>
            <span className="mt-1 sm:mt-0">Licensed under Apache-2.0. No 3rd-party tracking SDKs.</span>
          </div>
        </footer>

        {/* Modals */}
        {isAuthModalOpen && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <AdminAuthPanel
              adminBootstrapNeeded={sessionMeta.adminBootstrapNeeded}
              bootstrapRequiresToken={sessionMeta.bootstrapRequiresToken}
              passcodeConfigured={sessionMeta.passcodeConfigured}
              onAuthenticated={handleAdminAuthenticated}
              onClose={() => setIsAuthModalOpen(false)}
            />
          </div>
        )}

        <NewTenantModal
          isOpen={isNewTenantModalOpen}
          onClose={() => setIsNewTenantModalOpen(false)}
          onTenantCreated={handleTenantCreated}
        />

        <LegalModal
          isOpen={isLegalModalOpen}
          onClose={() => setIsLegalModalOpen(false)}
          authToken={authToken}
          authUser={authUser}
          onDataWiped={scope => {
            setCallLogs([]);
            if (scope === 'workspace' && authToken) {
              setHandoffs([]);
              setAppointments([]);
              setAuditLogs([]);
              setIntegrations([]);
              setOperationalMetrics(null);
              loadAdminWorkspaceData(authToken, authUser?.role);
            }
          }}
        />

        <SupportDeskModal
          isOpen={isSupportModalOpen}
          onClose={() => setIsSupportModalOpen(false)}
          authToken={authToken}
          tenantId={activeTenant.id}
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
