import React, { useState } from 'react';
import { Lock, ShieldCheck, KeyRound, UserPlus, LogIn, AlertCircle, X } from 'lucide-react';
import type { AuthUser } from '../types';

interface AdminAuthPanelProps {
  adminBootstrapNeeded: boolean;
  bootstrapRequiresToken?: boolean;
  passcodeConfigured: boolean;
  onAuthenticated: (token: string, user: AuthUser) => void;
  title?: string;
  subtitle?: string;
  onClose?: () => void;
}

export const AdminAuthPanel: React.FC<AdminAuthPanelProps> = ({
  adminBootstrapNeeded,
  bootstrapRequiresToken = false,
  passcodeConfigured,
  onAuthenticated,
  title = 'Workspace Administrator Access',
  subtitle = 'Protected multi-tenant controls require a signed server session.',
  onClose,
}) => {
  const [name, setName] = useState('Workspace Admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const endpoint = adminBootstrapNeeded ? '/api/auth/bootstrap' : '/api/auth/login';
      const body = adminBootstrapNeeded
        ? {
            name: name.trim(),
            email: email.trim(),
            password,
            ...(bootstrapToken.trim() ? { bootstrapToken: bootstrapToken.trim() } : {}),
          }
        : { email: email.trim() || undefined, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token || !data.user) {
        setErrorMsg(data.error || 'Authentication failed.');
        return;
      }

      onAuthenticated(data.token, data.user);
    } catch (err) {
      setErrorMsg('Network error: ' + String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#0D111A] border border-indigo-500/30 rounded-2xl p-6 shadow-2xl max-w-md w-full mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            {adminBootstrapNeeded ? <UserPlus className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">{title}</h3>
            <p className="text-[11px] text-slate-400">{subtitle}</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close authentication modal"
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {adminBootstrapNeeded && (
        <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-[11px] text-emerald-200 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong>First-Run Setup:</strong> No workspace administrator has been claimed yet. Set your initial admin credentials below (hashed with salted <code>scrypt</code> on the server).
          </span>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3 text-xs">
        {adminBootstrapNeeded && (
          <div>
            <label className="block text-slate-300 font-medium mb-1">Full Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Workspace Admin"
              className="w-full bg-black/40 border border-white/[0.1] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
        )}

        <div>
          <label className="block text-slate-300 font-medium mb-1">
            Admin Email {passcodeConfigured && !adminBootstrapNeeded ? '(optional for passcode)' : ''}
          </label>
          <input
            type="email"
            required={adminBootstrapNeeded || !passcodeConfigured}
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="admin@company.com"
            className="w-full bg-black/40 border border-white/[0.1] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-slate-300 font-medium mb-1">
            {passcodeConfigured && !adminBootstrapNeeded ? 'Password or Workspace Passcode' : 'Password (min 8 chars)'}
          </label>
          <div className="relative">
            <KeyRound className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="password"
              required
              minLength={adminBootstrapNeeded ? 8 : 1}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={adminBootstrapNeeded ? 'Choose a strong password' : 'Enter password'}
              className="w-full bg-black/40 border border-white/[0.1] rounded-xl pl-9 pr-3 py-2 text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {adminBootstrapNeeded && bootstrapRequiresToken && (
          <div>
            <label htmlFor="admin-bootstrap-token" className="block text-slate-300 font-medium mb-1">
              Administrator Setup Token (ADMIN_BOOTSTRAP_TOKEN)
            </label>
            <input
              id="admin-bootstrap-token"
              type="password"
              required
              value={bootstrapToken}
              onChange={e => setBootstrapToken(e.target.value)}
              placeholder="Enter deployment bootstrap token"
              className="w-full bg-black/40 border border-white/[0.1] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 transition cursor-pointer"
        >
          {adminBootstrapNeeded ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
          <span>
            {loading
              ? 'Verifying...'
              : adminBootstrapNeeded
              ? 'Claim Workspace Admin'
              : 'Sign In as Admin'}
          </span>
        </button>
      </form>
    </div>
  );
};
