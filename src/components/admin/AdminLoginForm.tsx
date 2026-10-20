import React, { useState } from 'react';
import { Lock, Mail, AlertCircle, Loader2, Shield } from 'lucide-react';

interface AdminLoginFormProps {
  onSuccess: (token: string, user: { email: string; name: string }) => void;
}

export const AdminLoginForm: React.FC<AdminLoginFormProps> = ({ onSuccess }) => {
  const [email, setEmail] = useState('riyajulansari113b@gmail.com');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Authentication failed. Please verify credentials.');
      }

      // Store in sessionStorage for client API requests
      sessionStorage.setItem('zoya_admin_token', data.token);
      onSuccess(data.token, data.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 sm:p-8 bg-[#071319] border border-teal-500/30 rounded-2xl shadow-2xl text-left">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-800">
        <div className="w-10 h-10 rounded-xl bg-teal-950 border border-teal-500/40 flex items-center justify-center text-teal-400 shrink-0">
          <Shield className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white tracking-tight">Admin Authentication</h3>
          <p className="text-xs text-slate-400">Restricted APK Release Management Portal</p>
        </div>
      </div>

      {error && (
        <div className="mb-5 p-3.5 rounded-xl bg-red-950/40 border border-red-500/40 flex items-start gap-2.5 text-xs text-red-300">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="admin-email" className="block text-xs font-medium text-slate-300 mb-1.5">
            Administrator Email
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Mail className="w-4 h-4" aria-hidden="true" />
            </div>
            <input
              id="admin-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@zoya.ai"
              className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus-visible:outline-teal-400"
            />
          </div>
        </div>

        <div>
          <label htmlFor="admin-password" className="block text-xs font-medium text-slate-300 mb-1.5">
            Admin Password
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Lock className="w-4 h-4" aria-hidden="true" />
            </div>
            <input
              id="admin-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus-visible:outline-teal-400"
            />
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            Default local setup password: <code className="text-teal-400 font-mono">zoya-admin-2026</code> (configurable via <code className="text-slate-400">ADMIN_PASSWORD</code> in <code className="text-slate-400">.env</code>).
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-2 inline-flex items-center justify-center gap-2 py-3 px-4 min-h-[44px] rounded-xl text-sm font-bold text-slate-950 bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 transition-all shadow-md active:scale-98 disabled:opacity-50 cursor-pointer focus-visible:outline-teal-400"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span>Authenticating...</span>
            </>
          ) : (
            <span>Sign In to Admin Portal</span>
          )}
        </button>
      </form>
    </div>
  );
};
