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

      // Deliver verified token in-memory to parent portal session only (never browser storage)
      onSuccess(data.token, data.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto p-6 sm:p-8 bg-white border border-pink-200/80 rounded-2xl shadow-2xl text-left">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-pink-200/60">
        <div className="w-10 h-10 rounded-xl bg-white border border-pink-200 flex items-center justify-center text-pink-600 shrink-0">
          <ShieldCheck className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-zinc-900 tracking-tight">Admin PIN Login</h3>
          <p className="text-xs text-zinc-500">Zoya Release Management Portal</p>
        </div>
      </div>

      {error && (
        <div className="mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-700">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="admin-pin" className="block text-xs font-medium text-zinc-700 mb-1.5">
            Secret Admin PIN
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-pink-500">
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
              className="w-full pl-10 pr-3.5 py-3 bg-white border border-pink-200 rounded-xl text-base font-mono text-zinc-900 placeholder-zinc-400 focus-visible:outline-pink-600 min-h-[48px]"
            />
          </div>
          <div className="mt-2 text-[11px] text-zinc-500 leading-relaxed">
            Configured on server via <code className="text-pink-600 font-mono">ZOYA_ADMIN_PIN</code> env variable.
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !pin.trim()}
          className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 min-h-[48px] rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-500 hover:to-rose-500 transition-all shadow-[0_6px_20px_rgba(219,39,119,0.22)] disabled:opacity-50 cursor-pointer focus-visible:outline-pink-600"
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
