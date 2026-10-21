import React, { useState } from 'react';
import { KeyRound, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';

interface AdminLoginFormProps {
  onSuccess: (token: string, user: { email: string; name: string }) => void;
}

export const AdminLoginForm: React.FC<AdminLoginFormProps> = ({ onSuccess }) => {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanPin = pin.trim();
    if (!cleanPin) {
      setError('Please enter the administrator PIN.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pin: cleanPin }),
      });

      const rawText = await res.text();
      let data: { success?: boolean; error?: string; token?: string; user?: { email: string; name: string } } = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        if (res.status === 401) {
          throw new Error('Invalid administrator PIN.');
        }
        throw new Error(
          res.ok
            ? 'Unexpected response from server.'
            : `Authentication error (${res.status}): ${rawText.slice(0, 100) || res.statusText || 'Unable to connect'}`
        );
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Invalid administrator PIN.');
      }

      if (!data.token || !data.user) {
        throw new Error('Server returned incomplete authentication payload.');
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
    <div className="max-w-sm mx-auto p-6 sm:p-8 bg-[#071319] border border-teal-500/30 rounded-2xl shadow-2xl text-left">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-800">
        <div className="w-10 h-10 rounded-xl bg-teal-950 border border-teal-500/40 flex items-center justify-center text-teal-400 shrink-0">
          <ShieldCheck className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white tracking-tight">Admin PIN Login</h3>
          <p className="text-xs text-slate-400">Zoya Release Management Portal</p>
        </div>
      </div>

      {error && (
        <div className="mb-5 p-3.5 rounded-xl bg-red-950/40 border border-red-500/40 flex items-start gap-2.5 text-xs text-red-300">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="admin-pin" className="block text-xs font-medium text-slate-300 mb-1.5">
            Secret Admin PIN
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <KeyRound className="w-4 h-4" aria-hidden="true" />
            </div>
            <input
              id="admin-pin"
              type="password"
              inputMode="numeric"
              required
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter PIN"
              className="w-full pl-10 pr-3.5 py-3 bg-slate-900 border border-slate-700/80 rounded-xl text-base font-mono text-white placeholder-slate-500 focus-visible:outline-teal-400 min-h-[48px]"
            />
          </div>
          <div className="mt-2 text-[11px] text-slate-500 leading-relaxed">
            Configured on server via <code className="text-teal-400 font-mono">ZOYA_ADMIN_PIN</code> env variable.
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !pin.trim()}
          className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 min-h-[48px] rounded-xl text-sm font-bold text-slate-950 bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 transition-all shadow-md active:scale-98 disabled:opacity-50 cursor-pointer focus-visible:outline-teal-400"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span>Verifying PIN...</span>
            </>
          ) : (
            <span>Unlock Admin Portal</span>
          )}
        </button>
      </form>
    </div>
  );
};
