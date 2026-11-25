import React, { useState } from 'react';
import { Lock, ShieldCheck, KeyRound, UserPlus, LogIn, AlertCircle, X } from 'lucide-react';
import type { AuthUser } from '../types';
import { signInWithGoogleOidc } from '../lib/firebase';
import { upsertUserProfileInFirestore } from '../lib/firestoreStore';

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
  subtitle = 'Sign in with Google OIDC or your workspace administrator credentials.',
  onClose,
}) => {
  const [name, setName] = useState('Workspace Admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setGoogleLoading(true);

    try {
      const { user: fbUser, idToken } = await signInWithGoogleOidc();
      const res = await fetch('/api/auth/firebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token || !data.user) {
        setErrorMsg(data.error || 'Google sign-in could not be verified by server.');
        return;
      }

      // Sync verified OIDC profile to Firestore (non-blocking)
      void upsertUserProfileInFirestore(data.user, fbUser.uid);

      if (data.user.role === 'caller') {
        setInfoMsg(
          `Signed in as ${data.user.email} (caller role). Ask the workspace super-admin to promote this account if admin permissions are needed.`
        );
      }
      onAuthenticated(data.token, data.user);
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/popup-closed-by-user') {
        setErrorMsg('Google sign-in window was closed before completion.');
      } else if (code === 'auth/popup-blocked') {
        setErrorMsg('Popup blocked by browser. Allow popups for this site and try again.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Google sign-in failed.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
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

      {/* Primary Google OIDC Sign-In */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={googleLoading || loading}
        className="w-full py-2.5 px-4 rounded-xl bg-white text-slate-900 hover:bg-slate-100 disabled:opacity-50 font-semibold text-xs flex items-center justify-center gap-2.5 shadow-sm transition cursor-pointer"
      >
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
          />
        </svg>
        <span>{googleLoading ? 'Connecting Google Account...' : 'Sign in with Google'}</span>
      </button>

      <div className="relative flex items-center py-0.5">
        <div className="flex-grow border-t border-white/[0.08]" />
        <span className="shrink mx-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">
          Or Workspace Credentials
        </span>
        <div className="flex-grow border-t border-white/[0.08]" />
      </div>

      {adminBootstrapNeeded && (
        <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-[11px] text-emerald-200 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong>First-Run Setup:</strong> No workspace administrator has been claimed yet. Set your initial admin credentials below (hashed with salted <code>scrypt</code> on the server).
          </span>
        </div>
      )}

      {infoMsg && (
        <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-xs text-indigo-200">
          {infoMsg}
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
          disabled={loading || googleLoading}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2 transition cursor-pointer"
        >
          {adminBootstrapNeeded ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
          <span>
            {loading
              ? 'Verifying...'
              : adminBootstrapNeeded
              ? 'Claim Workspace Admin'
              : 'Sign In with Password'}
          </span>
        </button>
      </form>
    </div>
  );
};
