import React, { useState } from 'react';
import {
  ChevronDown,
  BookOpen,
  Sliders,
  FileText,
  Award,
  Code,
  PhoneCall,
  Plus,
  Check,
  Share2,
  Headphones,
  ShieldCheck,
  Activity,
  LogIn,
  LogOut,
} from 'lucide-react';
import { TenantConfig, AuthUser } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

export type ActiveTab = 'call' | 'knowledge' | 'voice' | 'logs' | 'eval' | 'widget';

interface NavbarProps {
  tenants: TenantConfig[];
  activeTenant: TenantConfig;
  onSelectTenant: (tenant: TenantConfig) => void;
  onAddNewTenant: () => void;
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onStartCallFromNav: () => void;
  onOpenLegal: () => void;
  onOpenSupport: () => void;
  onOpenStatus: () => void;
  onOpenShare: () => void;
  authUser: AuthUser | null;
  onOpenAuth: () => void;
  onSignOut: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  tenants,
  activeTenant,
  onSelectTenant,
  onAddNewTenant,
  activeTab,
  onSelectTab,
  onOpenLegal,
  onOpenSupport,
  onOpenStatus,
  onOpenShare,
  authUser,
  onOpenAuth,
  onSignOut,
}) => {
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);

  const navItems = [
    { id: 'call' as ActiveTab, label: 'Voice Console', icon: PhoneCall },
    { id: 'knowledge' as ActiveTab, label: 'Knowledge Base', icon: BookOpen },
    { id: 'voice' as ActiveTab, label: 'Voice & Tools', icon: Sliders },
    { id: 'logs' as ActiveTab, label: 'Call Transcripts', icon: FileText },
    { id: 'eval' as ActiveTab, label: 'Eval Harness', icon: Award },
    { id: 'widget' as ActiveTab, label: 'Web Widget', icon: Code },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#080B10]/95 backdrop-blur-xl border-b border-white/[0.08]">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16 gap-2">
          {/* Zone 1: Single Wordmark Brand */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 via-teal-400 to-indigo-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white font-black text-sm tracking-wider">
              V
            </div>
            <div className="leading-tight">
              <span className="font-extrabold text-sm text-white tracking-tight block whitespace-nowrap">
                VaniVoice AI
              </span>
              <span className="text-[10px] text-slate-400 font-mono tracking-tight hidden 2xl:block">
                Multilingual Voice Prototype
              </span>
            </div>
          </div>

          {/* Zone 2: Navigation Links */}
          <nav className="hidden lg:flex items-center gap-0.5 bg-[#0F141F] p-1 rounded-xl border border-white/[0.06] shrink-0">
            {navItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white/10 text-white shadow-sm font-semibold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                  }`}
                >
                  <Icon
                    className={`w-3.5 h-3.5 ${
                      isActive ? 'text-emerald-400' : 'text-slate-400'
                    }`}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Actions Toolbar & Active Tenant Switcher */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* PWA Install Button */}
            <PWAInstallButton />

            {/* Quick Utility Icon Group */}
            <div className="hidden sm:flex items-center gap-0.5 bg-[#0F141F] p-1 rounded-xl border border-white/[0.06]">
              <button
                onClick={onOpenStatus}
                title="System Operational Status & Telemetry"
                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-white/[0.04] transition-all cursor-pointer relative"
              >
                <Activity className="w-3.5 h-3.5" />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute top-1 right-1" />
              </button>

              <button
                onClick={onOpenShare}
                title="Share VaniVoice AI"
                className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-white/[0.04] transition-all cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={onOpenSupport}
                title="Customer Support & Help Desk"
                className="p-1.5 rounded-lg text-slate-400 hover:text-teal-400 hover:bg-white/[0.04] transition-all cursor-pointer"
              >
                <Headphones className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={onOpenLegal}
                title="Legal, Privacy Policy & Account Deletion"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition-all cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
              </button>
            </div>

            {authUser && (authUser.role === 'super_admin' || authUser.role === 'tenant_admin' || authUser.authProvider === 'firebase_oidc') ? (
              <button
                onClick={onSignOut}
                title={`Signed in as ${authUser.email} (${authUser.role}) — click to sign out`}
                className={`px-2.5 py-1.5 rounded-xl border transition-all cursor-pointer flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap shrink-0 ${
                  authUser.role === 'super_admin' || authUser.role === 'tenant_admin'
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                    : 'bg-sky-500/15 border-sky-500/30 text-sky-300 hover:bg-sky-500/25'
                }`}
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>
                  {authUser.role === 'super_admin' || authUser.role === 'tenant_admin' ? 'Admin' : 'Signed In'}
                </span>
              </button>
            ) : (
              <button
                onClick={onOpenAuth}
                title="Workspace Sign-In"
                className="px-2.5 py-1.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 transition-all cursor-pointer flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </button>
            )}

            <div className="relative shrink-0">
              <button
                onClick={() => setTenantDropdownOpen(!tenantDropdownOpen)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-[#0F141F] border border-white/[0.08] hover:border-white/[0.16] text-[11px] text-slate-200 transition-all shadow-sm cursor-pointer"
              >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: activeTenant.primaryColor }}
              />
              <span className="font-semibold max-w-[115px] xl:max-w-[155px] truncate">
                {activeTenant.name}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            {tenantDropdownOpen && (
              <div className="absolute right-0 mt-2 w-80 rounded-2xl bg-[#0F141F] border border-white/[0.1] shadow-2xl py-2 z-50">
                <div className="px-3.5 py-2 text-[10px] uppercase font-bold text-slate-400 tracking-wider border-b border-white/[0.06]">
                  Active Pilot Businesses (Multi-tenant)
                </div>
                <div className="max-h-64 overflow-y-auto py-1">
                  {tenants.map(t => (
                    <button
                      key={t.id}
                      onClick={() => {
                        onSelectTenant(t);
                        setTenantDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3.5 py-2.5 text-xs flex items-center justify-between hover:bg-white/[0.06] transition-colors ${
                        t.id === activeTenant.id ? 'bg-white/[0.08] text-white' : 'text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: t.primaryColor }}
                        />
                        <div className="truncate">
                          <span className="font-semibold block truncate text-slate-200">{t.name}</span>
                          <span className="text-[10px] text-slate-400 block truncate">{t.tagline}</span>
                        </div>
                      </div>
                      {t.id === activeTenant.id && (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 ml-2" />
                      )}
                    </button>
                  ))}
                </div>

                <div className="pt-2 mt-1 border-t border-white/[0.06] px-2">
                  <button
                    onClick={() => {
                      setTenantDropdownOpen(false);
                      onAddNewTenant();
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-emerald-400 hover:bg-emerald-500/10 transition-colors flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Deploy New Business Tenant...</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

        {/* Mobile Nav Tabs Overflow Bar */}
        <div className="flex lg:hidden items-center overflow-x-auto space-x-1 py-1.5 no-scrollbar border-t border-white/[0.06]">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-white/10 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
