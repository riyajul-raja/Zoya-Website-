import React, { useState, useEffect, useMemo } from 'react';
import {
  Key,
  Plus,
  Copy,
  Check,
  Search,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Ban,
  CheckCircle2,
  AlertCircle,
  Smartphone,
  Activity,
  FileText,
  ChevronRight,
  Loader2,
  Eye,
  Lock,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  LicenseRecord,
  LicenseSummaryStats,
  LicenseStatus,
} from '../../../server/licenses';

interface LicenseManagerProps {
  token: string;
}

export const LicenseManager: React.FC<LicenseManagerProps> = ({ token }) => {
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [stats, setStats] = useState<LicenseSummaryStats>({
    total: 0,
    active: 0,
    pendingPayment: 0,
    revoked: 0,
    complimentary: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Generate License Form State
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [isComplimentary, setIsComplimentary] = useState(false);
  const [complimentaryReason, setComplimentaryReason] = useState('');
  const [generating, setGenerating] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // One-time revealed plaintext key state (shown ONLY immediately after generation)
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<{
    key: string;
    customerName: string;
    customerEmail: string;
    status: LicenseStatus;
    isComplimentary: boolean;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Filter & Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LicenseStatus>('all');

  // Selected License for Details + Actions
  const [selectedLicenseId, setSelectedLicenseId] = useState<string | null>(null);

  // Verify Payment Action State
  const [submittingVerify, setSubmittingVerify] = useState(false);

  // Revoke Action State
  const [revokingLicenseId, setRevokingLicenseId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [submittingRevoke, setSubmittingRevoke] = useState(false);

  // Action feedback inside details panel
  const [actionFeedback, setActionFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const fetchLicenses = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/admin/licenses', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const rawText = await res.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(`Unexpected response from server (HTTP ${res.status}).`);
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to load licenses (${res.status}).`);
      }

      const loadedLicenses: LicenseRecord[] = Array.isArray(data.licenses) ? data.licenses : [];
      setLicenses(loadedLicenses);
      if (data.stats) {
        setStats(data.stats);
      }
      if (!selectedLicenseId && loadedLicenses.length > 0) {
        setSelectedLicenseId(loadedLicenses[0].id);
      }
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'Unable to fetch licenses.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLicenses();
  }, [token]);

  const selectedLicense = useMemo(
    () => licenses.find((l) => l.id === selectedLicenseId) || null,
    [licenses, selectedLicenseId]
  );

  const filteredLicenses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return licenses.filter((lic) => {
      if (statusFilter !== 'all' && lic.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        lic.customerName.toLowerCase().includes(q) ||
        lic.customerEmail.toLowerCase().includes(q) ||
        lic.maskedKey.toLowerCase().includes(q) ||
        lic.keyLastFour.toLowerCase().includes(q) ||
        (lic.paymentReference && lic.paymentReference.toLowerCase().includes(q)) ||
        lic.id.toLowerCase().includes(q)
      );
    });
  }, [licenses, searchQuery, statusFilter]);

  const handleGenerateLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (generating) return;

    setFormFeedback(null);
    setActionFeedback(null);

    const trimmedName = customerName.trim();
    const trimmedEmail = customerEmail.trim();
    const trimmedRef = paymentReference.trim();
    const trimmedAmount = amount.trim();
    const trimmedReason = complimentaryReason.trim();

    if (trimmedName.length < 2) {
      setFormFeedback({
        type: 'error',
        text: 'Customer name is required (at least 2 characters).',
      });
      return;
    }

    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setFormFeedback({
        type: 'error',
        text: 'A valid customer email address is required.',
      });
      return;
    }

    if (isComplimentary && trimmedReason.length < 3) {
      setFormFeedback({
        type: 'error',
        text: 'Please provide a reason for issuing a complimentary license.',
      });
      return;
    }

    setGenerating(true);

    try {
      const res = await fetch('/api/admin/licenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          customerName: trimmedName,
          customerEmail: trimmedEmail,
          licenseType: 'Lifetime',
          paymentReference: isComplimentary ? undefined : trimmedRef || undefined,
          amount: isComplimentary ? undefined : trimmedAmount || undefined,
          currency: isComplimentary ? undefined : currency || undefined,
          isComplimentary,
          complimentaryReason: isComplimentary ? trimmedReason : undefined,
        }),
      });

      const rawText = await res.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(`Unexpected response from server (HTTP ${res.status}).`);
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to generate license (${res.status}).`);
      }

      const createdLicense: LicenseRecord = data.license;
      const generatedKey = String(data.generatedKey || '');

      setNewlyGeneratedKey({
        key: generatedKey,
        customerName: createdLicense.customerName,
        customerEmail: createdLicense.customerEmail,
        status: createdLicense.status,
        isComplimentary: createdLicense.isComplimentary,
      });
      setCopiedKey(false);

      // Reset form inputs
      setCustomerName('');
      setCustomerEmail('');
      setPaymentReference('');
      setAmount('');
      setIsComplimentary(false);
      setComplimentaryReason('');

      setFormFeedback({
        type: 'success',
        text:
          data.message ||
          `Lifetime license generated for ${createdLicense.customerName}.`,
      });

      await fetchLicenses();
      setSelectedLicenseId(createdLicense.id);
    } catch (err: unknown) {
      setFormFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to generate license.',
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyGeneratedKey = async () => {
    if (!newlyGeneratedKey?.key) return;
    try {
      await navigator.clipboard.writeText(newlyGeneratedKey.key);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 3000);
    } catch {
      // Fallback copy
      const textarea = document.createElement('textarea');
      textarea.value = newlyGeneratedKey.key;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 3000);
    }
  };

  const handleVerifyAndActivate = async (lic: LicenseRecord) => {
    if (!lic || lic.status !== 'pending_payment' || submittingVerify) return;

    setActionFeedback(null);
    setRevokingLicenseId(null);
    setSubmittingVerify(true);

    try {
      const res = await fetch(`/api/admin/licenses/${encodeURIComponent(lic.id)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'verify_payment',
          paymentReference: lic.paymentReference || undefined,
          amount: lic.amount || undefined,
          currency: lic.currency || undefined,
        }),
      });

      const rawText = await res.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(`Unexpected response from server (HTTP ${res.status}).`);
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to verify payment (${res.status}).`);
      }

      setActionFeedback({
        type: 'success',
        text: data.message || 'Payment verified and license activated.',
      });
      await fetchLicenses();
    } catch (err: unknown) {
      setActionFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to verify payment.',
      });
    } finally {
      setSubmittingVerify(false);
    }
  };

  const openRevokePanel = (lic: LicenseRecord) => {
    setActionFeedback(null);
    setRevokingLicenseId(lic.id);
    setRevokeReason('');
  };

  const handleConfirmRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokingLicenseId || submittingRevoke) return;

    const trimmedReason = revokeReason.trim();
    if (trimmedReason.length < 3) {
      setActionFeedback({
        type: 'error',
        text: 'Please enter a brief reason before revoking this license.',
      });
      return;
    }

    setSubmittingRevoke(true);
    setActionFeedback(null);

    try {
      const res = await fetch(`/api/admin/licenses/${encodeURIComponent(revokingLicenseId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'revoke',
          reason: trimmedReason,
        }),
      });

      const rawText = await res.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(`Unexpected response from server (HTTP ${res.status}).`);
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to revoke license (${res.status}).`);
      }

      setRevokingLicenseId(null);
      setActionFeedback({
        type: 'success',
        text: data.message || 'License has been permanently revoked.',
      });
      await fetchLicenses();
    } catch (err: unknown) {
      setActionFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to revoke license.',
      });
    } finally {
      setSubmittingRevoke(false);
    }
  };

  const renderStatusBadge = (status: LicenseStatus) => {
    if (status === 'active') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold">
          <CheckCircle2 className="w-3 h-3" />
          <span>Active</span>
        </span>
      );
    }
    if (status === 'pending_payment') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[11px] font-semibold">
          <Clock className="w-3 h-3" />
          <span>Pending Payment</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-red-500/15 border border-red-500/40 text-red-300 text-[11px] font-semibold">
        <Ban className="w-3 h-3" />
        <span>Revoked</span>
      </span>
    );
  };

  const formatTimestamp = (iso: string | null | undefined, fallback = 'Not available') => {
    if (!iso) return fallback;
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return fallback;
      return d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return fallback;
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* A. LICENSE OVERVIEW METRICS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-xl bg-[#071319] border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Total Licenses</span>
            <Key className="w-4 h-4 text-teal-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-white font-mono tabular-nums">
            {stats.total}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Lifetime keys issued
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#071319] border border-emerald-500/30">
          <div className="flex items-center justify-between text-xs text-emerald-300 mb-1">
            <span>Active Licenses</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-emerald-300 font-mono tabular-nums">
            {stats.active}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Authorized for Android activation
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#071319] border border-amber-500/30">
          <div className="flex items-center justify-between text-xs text-amber-300 mb-1">
            <span>Pending Payment</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-amber-300 font-mono tabular-nums">
            {stats.pendingPayment}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Awaiting manual admin verification
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#071319] border border-red-500/30">
          <div className="flex items-center justify-between text-xs text-red-300 mb-1">
            <span>Revoked Licenses</span>
            <Ban className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-red-300 font-mono tabular-nums">
            {stats.revoked}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Permanently blocked from validation
          </div>
        </div>
      </div>

      {/* ONE-TIME GENERATED KEY REVEAL BANNER */}
      {newlyGeneratedKey && (
        <div
          role="region"
          aria-label="Newly generated license key"
          className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-teal-950/90 via-[#071921] to-slate-950 border-2 border-teal-400/70 shadow-[0_12px_40px_rgba(20,184,166,0.18)] space-y-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-teal-500/20 border border-teal-400/50 text-teal-300 flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm sm:text-base font-bold text-white">
                  One-Time License Key Display — Copy &amp; Save Now
                </h4>
                <p className="text-xs text-teal-200/90">
                  Issued for <strong>{newlyGeneratedKey.customerName}</strong> ({newlyGeneratedKey.customerEmail}) ·{' '}
                  {newlyGeneratedKey.isComplimentary
                    ? 'Active (Complimentary)'
                    : 'Pending Payment Verification'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setNewlyGeneratedKey(null)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/70 transition-colors cursor-pointer"
              title="Dismiss one-time key display"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-3.5 rounded-xl bg-[#03090c] border border-teal-500/40">
            <code
              data-testid="generated-license-key"
              className="flex-1 font-mono text-base sm:text-xl font-bold tracking-wider text-teal-300 select-all break-all text-center sm:text-left"
            >
              {newlyGeneratedKey.key}
            </code>
            <button
              type="button"
              onClick={handleCopyGeneratedKey}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[42px] rounded-xl font-bold text-xs sm:text-sm text-slate-950 bg-teal-400 hover:bg-teal-300 transition-colors cursor-pointer shrink-0"
            >
              {copiedKey ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Copied to Clipboard</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy Key</span>
                </>
              )}
            </button>
          </div>

          <div className="flex items-start gap-2 text-[11px] text-amber-200/90 bg-amber-950/40 border border-amber-500/30 rounded-xl p-3">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              <strong>Security Notice:</strong> Plaintext license keys are never stored in the database. Only a SHA-256 cryptographic hash and masked identifier are persisted. Once you close this banner, the full key cannot be retrieved again.
              {!newlyGeneratedKey.isComplimentary && (
                <>
                  {' '}
                  This paid license is currently in <strong>Pending Payment</strong> status and will not activate in the Zoya Android app until you independently verify the payment transaction below.
                </>
              )}
            </span>
          </div>
        </div>
      )}

      {/* B. GENERATE LIFETIME LICENSE FORM */}
      <section
        aria-labelledby="generate-license-heading"
        className="p-4 sm:p-6 rounded-2xl bg-[#071319] border border-teal-500/30 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-teal-950 border border-teal-500/40 text-teal-300 flex items-center justify-center shrink-0">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h4 id="generate-license-heading" className="text-sm sm:text-base font-bold text-white">
                Generate Lifetime License Key
              </h4>
              <p className="text-[11px] text-slate-400">
                Cryptographically generates a unique <code className="text-teal-300 font-mono">ZOYA-XXXX-XXXX-XXXX</code> key stored via SHA-256 hash
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-teal-300">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
            <span>License Type: Lifetime</span>
          </span>
        </div>

        {formFeedback && (
          <div
            role="status"
            className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 ${
              formFeedback.type === 'success'
                ? 'bg-teal-950/40 border border-teal-500/40 text-teal-200'
                : 'bg-red-950/40 border border-red-500/40 text-red-200'
            }`}
          >
            {formFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            )}
            <span>{formFeedback.text}</span>
          </div>
        )}

        <form onSubmit={handleGenerateLicense} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label htmlFor="lic-customer-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                Customer Name <span className="text-teal-400">*</span>
              </label>
              <input
                id="lic-customer-name"
                type="text"
                required
                maxLength={120}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g., Aarav Sharma"
                className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus-visible:outline-teal-400"
              />
            </div>

            <div>
              <label htmlFor="lic-customer-email" className="block text-xs font-medium text-slate-300 mb-1.5">
                Customer Email <span className="text-teal-400">*</span>
              </label>
              <input
                id="lic-customer-email"
                type="email"
                required
                maxLength={160}
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="customer@example.com"
                className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus-visible:outline-teal-400"
              />
            </div>

            <div>
              <label htmlFor="lic-type-select" className="block text-xs font-medium text-slate-300 mb-1.5">
                License Tier
              </label>
              <input
                id="lic-type-select"
                type="text"
                readOnly
                value="Lifetime"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm font-mono font-semibold text-teal-300 cursor-not-allowed"
              />
            </div>
          </div>

          {/* Paid vs Complimentary Mode Toggle */}
          <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2.5 text-xs font-semibold text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isComplimentary}
                  onChange={(e) => setIsComplimentary(e.target.checked)}
                  className="w-4 h-4 rounded accent-teal-400 cursor-pointer"
                />
                <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                <span>Issue as Admin-Authorized Complimentary License (No Payment Required)</span>
              </label>
              <span className="text-[11px] font-mono text-slate-400">
                {isComplimentary ? 'Initial status: Active' : 'Initial status: Pending Payment'}
              </span>
            </div>

            {isComplimentary ? (
              <div>
                <label htmlFor="lic-comp-reason" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Complimentary Issuance Reason <span className="text-teal-400">*</span>
                </label>
                <input
                  id="lic-comp-reason"
                  type="text"
                  required={isComplimentary}
                  maxLength={300}
                  value={complimentaryReason}
                  onChange={(e) => setComplimentaryReason(e.target.value)}
                  placeholder="e.g., Core beta tester / Press review unit / Internal team device"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-teal-500/40 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus-visible:outline-teal-400"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="sm:col-span-2">
                  <label htmlFor="lic-payment-ref" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Payment Reference / Transaction ID (Optional at creation)
                  </label>
                  <input
                    id="lic-payment-ref"
                    type="text"
                    maxLength={120}
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="e.g., UPI/UTR 412983749182 or Bank Ref"
                    className="w-full px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs sm:text-sm font-mono text-white placeholder-slate-500 focus-visible:outline-teal-400"
                  />
                </div>

                <div className="grid grid-cols-5 gap-2">
                  <div className="col-span-3">
                    <label htmlFor="lic-amount" className="block text-xs font-medium text-slate-300 mb-1.5">
                      Amount
                    </label>
                    <input
                      id="lic-amount"
                      type="number"
                      min="0"
                      step="any"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="999"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs sm:text-sm font-mono text-white placeholder-slate-500 focus-visible:outline-teal-400"
                    />
                  </div>
                  <div className="col-span-2">
                    <label htmlFor="lic-currency" className="block text-xs font-medium text-slate-300 mb-1.5">
                      Currency
                    </label>
                    <select
                      id="lic-currency"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full px-2.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs sm:text-sm font-mono text-white focus-visible:outline-teal-400"
                    >
                      <option value="INR">INR</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-slate-400">
              {isComplimentary
                ? 'Complimentary licenses become Active immediately with your admin audit signature.'
                : 'Paid licenses start in Pending Payment status until you verify the transaction.'}
            </p>
            <button
              type="submit"
              disabled={generating}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[44px] rounded-xl font-bold text-xs sm:text-sm text-slate-950 bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 transition-all shadow-md cursor-pointer disabled:opacity-50 shrink-0"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generating Key...</span>
                </>
              ) : (
                <>
                  <Key className="w-4 h-4" />
                  <span>Generate Lifetime Key</span>
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* C. LICENSE DIRECTORY & DETAILS VIEW */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Search, Status Filter, and License List */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-4 rounded-2xl bg-[#071319] border border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by customer name, email, last 4 key chars, or payment ref..."
                  className="w-full pl-9 pr-3.5 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus-visible:outline-teal-400"
                />
              </div>
              <button
                type="button"
                onClick={fetchLicenses}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-teal-300 font-semibold cursor-pointer shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {/* Status Filter Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: `All (${stats.total})` },
                  { id: 'active', label: `Active (${stats.active})` },
                  { id: 'pending_payment', label: `Pending Payment (${stats.pendingPayment})` },
                  { id: 'revoked', label: `Revoked (${stats.revoked})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    statusFilter === tab.id
                      ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
                      : 'text-slate-400 hover:text-white bg-slate-900/60 border border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {fetchError && (
            <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-xs text-red-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{fetchError}</span>
            </div>
          )}

          {loading ? (
            <div className="p-8 rounded-2xl bg-[#071319] border border-slate-800 flex items-center justify-center gap-2.5 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-teal-400" />
              <span>Loading persistent license records...</span>
            </div>
          ) : filteredLicenses.length === 0 ? (
            <div className="p-8 rounded-2xl bg-[#071319] border border-slate-800 text-center space-y-2">
              <Key className="w-6 h-6 text-slate-500 mx-auto" />
              <p className="text-xs sm:text-sm font-semibold text-slate-300">
                No matching license records found
              </p>
              <p className="text-xs text-slate-500">
                {licenses.length === 0
                  ? 'Use the "Generate Lifetime License Key" form above to create the first customer license.'
                  : 'Try clearing your search query or switching the status filter.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredLicenses.map((lic) => {
                const isSelected = lic.id === selectedLicense?.id;
                return (
                  <div
                    key={lic.id}
                    onClick={() => {
                      setSelectedLicenseId(lic.id);
                      setActionFeedback(null);
                      setRevokingLicenseId(null);
                    }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#0b1f29] border-teal-400/60 shadow-[0_0_0_1px_rgba(45,212,191,0.2)]'
                        : 'bg-[#071319] border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="font-mono text-xs sm:text-sm font-bold text-teal-300">
                            {lic.maskedKey}
                          </code>
                          {renderStatusBadge(lic.status)}
                          {lic.isComplimentary && (
                            <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[10px] font-semibold">
                              Complimentary
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-semibold text-white truncate">
                          {lic.customerName}{' '}
                          <span className="font-normal text-slate-400">&lt;{lic.customerEmail}&gt;</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-mono shrink-0">
                        <span>{formatTimestamp(lic.createdAt)}</span>
                        <ChevronRight className="w-4 h-4 text-slate-500" />
                      </div>
                    </div>

                    <div className="mt-2.5 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>Type: {lic.licenseType}</span>
                        <span>·</span>
                        <span>
                          Payment:{' '}
                          {lic.isComplimentary
                            ? 'Complimentary'
                            : lic.paymentVerified
                            ? `Verified (${lic.paymentReference || 'Ref recorded'})`
                            : lic.paymentReference
                            ? `Unverified Ref: ${lic.paymentReference}`
                            : 'No reference yet'}
                        </span>
                      </div>
                      <span className="text-teal-400/90 inline-flex items-center gap-1 font-medium">
                        <Eye className="w-3 h-3" />
                        <span>Inspect Details</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Selected License Details, Payment Verification, Revocation & Audit Log */}
        <div className="lg:col-span-5">
          {selectedLicense ? (
            <div className="p-4 sm:p-5 rounded-2xl bg-[#071319] border border-teal-500/30 space-y-4 sticky top-4">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
                    License Record Details
                  </span>
                  <code className="font-mono text-base font-bold text-teal-300">
                    {selectedLicense.maskedKey}
                  </code>
                </div>
                {renderStatusBadge(selectedLicense.status)}
              </div>

              {actionFeedback && (
                <div
                  role="status"
                  className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                    actionFeedback.type === 'success'
                      ? 'bg-teal-950/40 border border-teal-500/40 text-teal-200'
                      : 'bg-red-950/40 border border-red-500/40 text-red-200'
                  }`}
                >
                  {actionFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  )}
                  <span>{actionFeedback.text}</span>
                </div>
              )}

              {/* Primary Metadata Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="p-2.5 rounded-xl bg-[#050d12] border border-slate-800/90">
                  <span className="block text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
                    Customer Name
                  </span>
                  <strong className="text-white break-words">{selectedLicense.customerName}</strong>
                </div>

                <div className="p-2.5 rounded-xl bg-[#050d12] border border-slate-800/90">
                  <span className="block text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
                    Customer Email
                  </span>
                  <strong className="text-slate-200 font-mono text-[11px] break-all">
                    {selectedLicense.customerEmail}
                  </strong>
                </div>

                <div className="p-2.5 rounded-xl bg-[#050d12] border border-slate-800/90">
                  <span className="block text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
                    License Type
                  </span>
                  <strong className="text-teal-300 font-mono">{selectedLicense.licenseType}</strong>
                </div>

                <div className="p-2.5 rounded-xl bg-[#050d12] border border-slate-800/90">
                  <span className="block text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
                    Creation Date
                  </span>
                  <strong className="text-white font-mono text-[11px] tabular-nums">
                    {formatTimestamp(selectedLicense.createdAt)}
                  </strong>
                </div>

                <div className="p-2.5 rounded-xl bg-[#050d12] border border-slate-800/90">
                  <span className="block text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
                    Activation Date
                  </span>
                  <strong className="text-slate-200 font-mono text-[11px] tabular-nums">
                    {formatTimestamp(selectedLicense.activatedAt, 'Not activated yet')}
                  </strong>
                </div>

                <div className="p-2.5 rounded-xl bg-[#050d12] border border-slate-800/90">
                  <span className="block text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
                    Last-Seen Telemetry
                  </span>
                  <strong className="text-slate-200 font-mono text-[11px] tabular-nums">
                    {formatTimestamp(selectedLicense.lastSeenAt, 'Not available')}
                  </strong>
                </div>
              </div>

              {/* Payment & Verification Status Card */}
              <div className="p-3.5 rounded-xl bg-[#050d12] border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                    Payment &amp; Authorization
                  </span>
                  {selectedLicense.isComplimentary ? (
                    <span className="text-[11px] font-semibold text-cyan-300">
                      Complimentary License
                    </span>
                  ) : selectedLicense.paymentVerified ? (
                    <span className="text-[11px] font-semibold text-emerald-300">
                      Verified by Admin
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-amber-300">
                      Unverified Payment
                    </span>
                  )}
                </div>

                {selectedLicense.isComplimentary ? (
                  <p className="text-slate-300 text-xs">
                    Reason: <strong className="text-white">{selectedLicense.complimentaryReason}</strong>
                  </p>
                ) : (
                  <div className="space-y-1 text-slate-300">
                    <div>
                      Payment Reference:{' '}
                      <strong className="font-mono text-white">
                        {selectedLicense.paymentReference || 'None recorded'}
                      </strong>
                    </div>
                    {selectedLicense.amount && (
                      <div>
                        Amount:{' '}
                        <strong className="font-mono text-white tabular-nums">
                          {selectedLicense.currency || 'INR'} {selectedLicense.amount}
                        </strong>
                      </div>
                    )}
                    {selectedLicense.paymentVerified && selectedLicense.verifiedBy && (
                      <div className="text-[11px] text-emerald-300/90 pt-1">
                        Verified by <strong>{selectedLicense.verifiedBy.name}</strong> (
                        {selectedLicense.verifiedBy.email}) on{' '}
                        <span className="font-mono">{formatTimestamp(selectedLicense.verifiedAt)}</span>
                      </div>
                    )}
                  </div>
                )}

                {selectedLicense.status === 'revoked' && (
                  <div className="pt-2 border-t border-red-900/50 text-red-300 text-[11px]">
                    <strong>Revoked:</strong> {selectedLicense.revokeReason || 'Revoked by admin'} (
                    {formatTimestamp(selectedLicense.revokedAt)})
                  </div>
                )}
              </div>

              {/* Linked Phone / Device Status Card (Honest Telemetry) */}
              <div className="p-3.5 rounded-xl bg-[#050d12] border border-slate-800 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                    <Smartphone className="w-3.5 h-3.5 text-teal-400" />
                    <span>Linked Android Phone</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    Validations: {selectedLicense.validationCount || 0}
                  </span>
                </div>

                {selectedLicense.linkedDevice ? (
                  <div className="space-y-1 text-slate-300 text-[11px] font-mono">
                    {selectedLicense.linkedDevice.deviceModel && (
                      <div>Model: {selectedLicense.linkedDevice.deviceModel}</div>
                    )}
                    {selectedLicense.linkedDevice.androidVersion && (
                      <div>Android: {selectedLicense.linkedDevice.androidVersion}</div>
                    )}
                    {selectedLicense.linkedDevice.appVersion && (
                      <div>Zoya App: {selectedLicense.linkedDevice.appVersion}</div>
                    )}
                    {selectedLicense.linkedDevice.deviceId && (
                      <div className="truncate">Device ID: {selectedLicense.linkedDevice.deviceId}</div>
                    )}
                    <div className="text-slate-400">
                      Linked: {formatTimestamp(selectedLicense.linkedDevice.linkedAt)}
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-400 text-xs">
                    Status: <strong className="text-slate-300">Not linked</strong> (No Android device has activated this license yet)
                  </p>
                )}
              </div>

              {/* Administrative Action Controls */}
              <div className="space-y-3 pt-1">
                {selectedLicense.status === 'pending_payment' && (
                  <button
                    type="button"
                    disabled={submittingVerify}
                    onClick={() => handleVerifyAndActivate(selectedLicense)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[42px] rounded-xl font-bold text-xs text-slate-950 bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-300 hover:to-teal-300 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {submittingVerify ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Activating License...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Verify Payment &amp; Activate License</span>
                      </>
                    )}
                  </button>
                )}

                {selectedLicense.status !== 'revoked' &&
                  revokingLicenseId !== selectedLicense.id && (
                    <button
                      type="button"
                      onClick={() => openRevokePanel(selectedLicense)}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[38px] rounded-xl font-semibold text-xs text-red-300 bg-red-950/40 hover:bg-red-900/50 border border-red-500/30 transition-colors cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Revoke License</span>
                    </button>
                  )}

                {/* Inline Revoke Confirmation Form */}
                {revokingLicenseId === selectedLicense.id && (
                  <form
                    onSubmit={handleConfirmRevoke}
                    className="p-3.5 rounded-xl bg-slate-900 border border-red-500/40 space-y-3 text-xs"
                  >
                    <div className="font-bold text-red-300 uppercase tracking-wider text-[11px]">
                      Confirm License Revocation
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-300 mb-1">
                        Revocation Reason <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={300}
                        value={revokeReason}
                        onChange={(e) => setRevokeReason(e.target.value)}
                        placeholder="e.g., Chargeback / Refunded / Key compromised"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={submittingRevoke}
                        className="flex-1 py-2 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs cursor-pointer disabled:opacity-50"
                      >
                        {submittingRevoke ? 'Revoking...' : 'Permanently Revoke'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRevokingLicenseId(null)}
                        className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Audit History Log */}
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                  <Activity className="w-3.5 h-3.5 text-teal-400" />
                  <span>Audit History ({selectedLicense.auditLog?.length || 0})</span>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                  {(selectedLicense.auditLog || [])
                    .slice()
                    .reverse()
                    .map((entry) => (
                      <div
                        key={entry.id}
                        className="p-2.5 rounded-lg bg-[#050d12] border border-slate-800/80 text-[11px] space-y-0.5"
                      >
                        <div className="flex items-center justify-between gap-2 text-slate-400 font-mono text-[10px]">
                          <span className="uppercase text-teal-300 font-semibold">
                            {entry.action.replace(/_/g, ' ')}
                          </span>
                          <span>{formatTimestamp(entry.timestamp)}</span>
                        </div>
                        <p className="text-slate-200 leading-relaxed">{entry.details}</p>
                        <div className="text-[10px] text-slate-500">Actor: {entry.actor}</div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-2xl bg-[#071319] border border-slate-800 text-center text-xs text-slate-400">
              Select a license from the list to inspect its verification status, linked device info, and audit log.
            </div>
          )}
        </div>
      </div>

      {/* ANDROID VALIDATION API SPECIFICATION FOOTER */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#071319] border border-slate-800 space-y-2 text-xs text-slate-300">
        <div className="flex items-center gap-2 font-bold text-white">
          <FileText className="w-4 h-4 text-teal-400" />
          <span>Zoya Android App Integration — License Validation Endpoint</span>
        </div>
        <p className="text-slate-400 leading-relaxed">
          The Zoya Android client validates lifetime keys via <code className="text-teal-300 font-mono">POST /api/licenses/validate</code> with JSON payload{' '}
          <code className="text-slate-200 font-mono">{`{ "licenseKey": "ZOYA-XXXX-XXXX-XXXX", "deviceInfo": { "deviceId", "deviceModel", "androidVersion", "appVersion" } }`}</code>.
          Only <strong className="text-emerald-300">Active</strong> licenses (with verified payment or admin complimentary authorization) pass validation; unknown, malformed, pending-payment, and revoked keys are rejected.
        </p>
      </div>
    </div>
  );
};
