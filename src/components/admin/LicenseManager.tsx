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
  EyeOff,
  Lock,
  X,
} from 'lucide-react';
import type {
  LicenseRecord,
  LicenseSummaryStats,
  LicenseStatus,
} from '../../../server/licenses';

interface LicenseManagerProps {
  token: string;
  onUnauthorized?: () => void;
}

export const LicenseManager: React.FC<LicenseManagerProps> = ({ token, onUnauthorized }) => {
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [stats, setStats] = useState<LicenseSummaryStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Generate License Form State
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
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
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Known in-memory keys for newly generated items in this active session (never written to browser storage)
  const [knownKeys, setKnownKeys] = useState<Record<string, string>>({});

  // Decrypted plaintext keys retrieved on-demand from authenticated admin endpoint
  const [decryptedKeys, setDecryptedKeys] = useState<Record<string, string>>({});
  const [loadingKeyIds, setLoadingKeyIds] = useState<Record<string, boolean>>({});

  // Revealed state per license ID (toggled by Eye icon)
  const [revealedKeyIds, setRevealedKeyIds] = useState<Record<string, boolean>>({});

  // Copied confirmation feedback state per license ID
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null);

  // Filter & Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LicenseStatus>('all');

  // Selected License for Details + Actions
  const [selectedLicenseId, setSelectedLicenseId] = useState<string | null>(null);

  // Rebind Device Action State
  const [rebindLicenseId, setRebindLicenseId] = useState<string | null>(null);
  const [rebindReason, setRebindReason] = useState('');
  const [submittingRebind, setSubmittingRebind] = useState(false);

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
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
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
      const fullKey = getFullKeyForLicense(lic);
      return (
        lic.customerName.toLowerCase().includes(q) ||
        lic.customerEmail.toLowerCase().includes(q) ||
        'zoya-xxxx-xxxx-xxxx'.includes(q) ||
        (fullKey && fullKey.toLowerCase().includes(q)) ||
        lic.maskedKey.toLowerCase().includes(q) ||
        lic.keyLastFour.toLowerCase().includes(q) ||
        lic.id.toLowerCase().includes(q) ||
        (lic.linkedDevice?.deviceModel && lic.linkedDevice.deviceModel.toLowerCase().includes(q)) ||
        (lic.linkedDevice?.deviceId && lic.linkedDevice.deviceId.toLowerCase().includes(q))
      );
    });
  }, [licenses, searchQuery, statusFilter, knownKeys, newlyGeneratedKey]);

  const handleGenerateLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (generating) return;

    setFormFeedback(null);
    setActionFeedback(null);

    const trimmedName = customerName.trim();
    const trimmedEmail = customerEmail.trim();

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
        }),
      });

      const rawText = await res.text();
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }

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
      });
      setCopiedKey(false);

      if (generatedKey) {
        setKnownKeys((prev) => ({
          ...prev,
          [createdLicense.id]: generatedKey,
          [createdLicense.keyHash]: generatedKey,
        }));
      }

      // Reset form inputs
      setCustomerName('');
      setCustomerEmail('');

      setFormFeedback({
        type: 'success',
        text: data.message || `Lifetime license generated for ${createdLicense.customerName} (Unactivated).`,
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

  /**
   * Verifies that a candidate string is a complete unmasked license key (ZOYA-XXXX-XXXX-XXXX)
   * and never the masked placeholder ("ZOYA-XXXX-XXXX-XXXX" or "ZOYA-••••-••••-XXXX").
   */
  const isValidCompleteLicenseKey = (val: unknown): val is string => {
    if (typeof val !== 'string') return false;
    const trimmed = val.trim().toUpperCase();
    if (trimmed === 'ZOYA-XXXX-XXXX-XXXX' || trimmed.includes('•')) {
      return false;
    }
    return /^ZOYA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(trimmed);
  };

  /**
   * Resolves the complete plaintext key for a license if already cached in memory.
   */
  const getFullKeyForLicense = (lic: LicenseRecord): string | null => {
    if (isValidCompleteLicenseKey(decryptedKeys[lic.id])) {
      return decryptedKeys[lic.id].trim().toUpperCase();
    }
    if (isValidCompleteLicenseKey((lic as any).licenseKey)) {
      return (lic as any).licenseKey.trim().toUpperCase();
    }
    if (isValidCompleteLicenseKey((lic as any).fullKey)) {
      return (lic as any).fullKey.trim().toUpperCase();
    }
    if (isValidCompleteLicenseKey(knownKeys[lic.id])) {
      return knownKeys[lic.id].trim().toUpperCase();
    }
    if (lic.keyHash && isValidCompleteLicenseKey(knownKeys[lic.keyHash])) {
      return knownKeys[lic.keyHash].trim().toUpperCase();
    }
    return null;
  };

  /**
   * Fetches the complete decrypted key from the authenticated admin backend endpoint.
   * Uses POST /api/admin/licenses/:id with { action: 'reveal' } for full compatibility
   * with both Vercel rewrite routing and the server API handler.
   */
  const fetchDecryptedKey = async (lic: LicenseRecord): Promise<string | null> => {
    // 1. Return from in-memory cache if already available
    const existing = getFullKeyForLicense(lic);
    if (existing) {
      return existing;
    }

    setLoadingKeyIds((prev) => ({ ...prev, [lic.id]: true }));
    try {
      const res = await fetch(`/api/admin/licenses/${encodeURIComponent(lic.id)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'reveal' }),
      });

      if (res.status === 401) {
        onUnauthorized?.();
        return null;
      }

      const rawText = await res.text();
      let data: any = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        setActionFeedback({
          type: 'error',
          text: `Unable to decrypt license key: server returned an unexpected response (HTTP ${res.status}).`,
        });
        return null;
      }

      if (res.ok && data?.success && isValidCompleteLicenseKey(data.licenseKey)) {
        const decrypted = data.licenseKey.trim().toUpperCase();
        setDecryptedKeys((prev) => ({ ...prev, [lic.id]: decrypted }));
        return decrypted;
      }

      if (data?.code === 'KEY_NOT_RECOVERABLE') {
        setActionFeedback({
          type: 'error',
          text: 'Legacy license: generated prior to reversible encryption. The original key cannot be recovered.',
        });
      } else if (data?.error && typeof data.error === 'string') {
        setActionFeedback({
          type: 'error',
          text: data.error,
        });
      } else {
        setActionFeedback({
          type: 'error',
          text: `Failed to decrypt license key (HTTP ${res.status}).`,
        });
      }
    } catch (err: unknown) {
      setActionFeedback({
        type: 'error',
        text:
          err instanceof Error && err.message
            ? `Network error while requesting license key: ${err.message}`
            : 'Unable to reach the server to decrypt license key. Please check your network connection.',
      });
    } finally {
      setLoadingKeyIds((prev) => ({ ...prev, [lic.id]: false }));
    }
    return null;
  };

  /**
   * Writes text to the system clipboard and returns true only if the write succeeded.
   */
  const writeTextToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall through to textarea execCommand fallback
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return Boolean(copied);
    } catch {
      return false;
    }
  };

  /**
   * Toggles the revealed/masked state for a specific license key row.
   * Decrypts on demand if not already loaded in memory.
   */
  const handleToggleReveal = async (e: React.MouseEvent, lic: LicenseRecord) => {
    e.stopPropagation();
    setSelectedLicenseId(lic.id);
    setActionFeedback(null);

    const isCurrentlyRevealed = Boolean(revealedKeyIds[lic.id]);
    if (isCurrentlyRevealed) {
      setRevealedKeyIds((prev) => ({
        ...prev,
        [lic.id]: false,
      }));
      return;
    }

    let fullKey = getFullKeyForLicense(lic);
    if (!fullKey) {
      fullKey = await fetchDecryptedKey(lic);
    }

    if (fullKey && isValidCompleteLicenseKey(fullKey)) {
      setRevealedKeyIds((prev) => ({
        ...prev,
        [lic.id]: true,
      }));
    }
  };

  /**
   * Copies the complete original license key to clipboard.
   * - If the key has not yet been revealed, securely fetches it from the authenticated admin reveal endpoint.
   * - Copies ONLY after the server returns the valid decrypted full key (never copies "ZOYA-XXXX-XXXX-XXXX").
   * - Shows "Copied" confirmation ONLY after the clipboard contains the actual full key.
   */
  const handleCopyRowKey = async (e: React.MouseEvent, lic: LicenseRecord) => {
    e.stopPropagation();
    setSelectedLicenseId(lic.id);
    setActionFeedback(null);

    let fullKey = getFullKeyForLicense(lic);
    if (!fullKey) {
      fullKey = await fetchDecryptedKey(lic);
    }

    if (!fullKey || !isValidCompleteLicenseKey(fullKey)) {
      // Never copy the masked placeholder ("ZOYA-XXXX-XXXX-XXXX")
      return;
    }

    const copiedOk = await writeTextToClipboard(fullKey);
    if (!copiedOk) {
      setActionFeedback({
        type: 'error',
        text: 'Failed to copy license key to clipboard. Please reveal the key and copy it manually.',
      });
      return;
    }

    setCopiedRowId(lic.id);
    setTimeout(() => {
      setCopiedRowId((prev) => (prev === lic.id ? null : prev));
    }, 2500);
  };

  // Open rebind panel
  const openRebindPanel = (lic: LicenseRecord) => {
    setActionFeedback(null);
    setRevokingLicenseId(null);
    setRebindLicenseId(lic.id);
    setRebindReason('');
  };

  // Admin Rebind Device Submission
  const handleConfirmRebind = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rebindLicenseId || submittingRebind) return;

    const trimmedReason = rebindReason.trim();
    if (trimmedReason.length < 5) {
      setActionFeedback({
        type: 'error',
        text: 'Please provide a clear reason for rebinding (at least 5 characters).',
      });
      return;
    }

    setSubmittingRebind(true);
    setActionFeedback(null);

    try {
      const res = await fetch(`/api/admin/licenses/${encodeURIComponent(rebindLicenseId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'rebind',
          reason: trimmedReason,
        }),
      });

      const rawText = await res.text();
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(`Unexpected response from server (HTTP ${res.status}).`);
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Failed to rebind device (${res.status}).`);
      }

      setRebindLicenseId(null);
      setActionFeedback({
        type: 'success',
        text: data.message || 'Device binding cleared. License is now unactivated and ready for a new phone.',
      });
      await fetchLicenses();
    } catch (err: unknown) {
      setActionFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to rebind device.',
      });
    } finally {
      setSubmittingRebind(false);
    }
  };

  // Open revoke panel
  const openRevokePanel = (lic: LicenseRecord) => {
    setActionFeedback(null);
    setRebindLicenseId(null);
    setRevokingLicenseId(lic.id);
    setRevokeReason('');
  };

  // Confirm Revocation
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
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
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
    if (status === 'unactivated') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[11px] font-semibold">
          <Clock className="w-3 h-3" />
          <span>Unactivated</span>
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
      {/* ERROR BANNER: FIRESTORE OUTAGE / UNAVAILABLE */}
      {fetchError && (
        <div
          role="alert"
          className="p-4 sm:p-5 rounded-2xl bg-red-950/60 border-2 border-red-500/50 text-red-200 space-y-2"
        >
          <div className="flex items-center gap-2 font-bold text-sm sm:text-base text-red-300">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <span>Persistent License Storage (Cloud Firestore) Notice</span>
          </div>
          <p className="text-xs leading-relaxed text-red-200">
            {fetchError}
          </p>
          <p className="text-[11px] text-red-300/80">
            Note: License records and activation stats are maintained exclusively in Cloud Firestore (zoya-updates, Delhi).
            When storage is unavailable, operations fail safely without fabricating empty records.
          </p>
        </div>
      )}

      {/* A. LICENSE OVERVIEW METRICS (Shown only when stats are available) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-xl bg-[#071319] border border-slate-800">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>Total Licenses</span>
            <Key className="w-4 h-4 text-teal-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-white font-mono tabular-nums">
            {stats ? stats.total : '—'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Lifetime keys issued
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#071319] border border-emerald-500/30">
          <div className="flex items-center justify-between text-xs text-emerald-300 mb-1">
            <span>Activated</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-emerald-300 font-mono tabular-nums">
            {stats ? stats.activated : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Bound to customer phones
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#071319] border border-amber-500/30">
          <div className="flex items-center justify-between text-xs text-amber-300 mb-1">
            <span>Unactivated</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-amber-300 font-mono tabular-nums">
            {stats ? stats.unactivated : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Ready for phone activation
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#071319] border border-red-500/30">
          <div className="flex items-center justify-between text-xs text-red-300 mb-1">
            <span>Revoked</span>
            <Ban className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-red-300 font-mono tabular-nums">
            {stats ? stats.revoked : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Permanently deactivated
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
                  One-Time License Key Display — Copy &amp; Share With Customer
                </h4>
                <p className="text-xs text-teal-200/90">
                  Issued for <strong>{newlyGeneratedKey.customerName}</strong> ({newlyGeneratedKey.customerEmail}) · Initial Status: <strong>Unactivated</strong>
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
              <strong>One-Phone Lifetime Activation:</strong> This key is currently <strong>Unactivated</strong>.
              Upon first entry in the Zoya Android app, it will permanently bind to that customer&apos;s phone.
              Subsequent validation from any other phone will be rejected automatically.
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
                Creates a unique <code className="text-teal-300 font-mono">ZOYA-XXXX-XXXX-XXXX</code> lifetime key ready for phone activation
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-teal-300">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
            <span>Tier: Lifetime (1 Phone)</span>
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

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-slate-400">
              Keys are generated unactivated. Device binding happens automatically upon first activation.
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
                  placeholder="Search by customer name, email, key, or device..."
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
                  { id: 'all', label: `All (${stats ? stats.total : licenses.length})` },
                  { id: 'active', label: `Active (${stats ? stats.activated : licenses.filter(l => l.status === 'active').length})` },
                  { id: 'unactivated', label: `Unactivated (${stats ? stats.unactivated : licenses.filter(l => l.status === 'unactivated').length})` },
                  { id: 'revoked', label: `Revoked (${stats ? stats.revoked : licenses.filter(l => l.status === 'revoked').length})` },
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
                      setRebindLicenseId(null);
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
                        {(() => {
                          const fullKey = getFullKeyForLicense(lic);
                          const isRevealed = Boolean(revealedKeyIds[lic.id]);
                          const displayedKey = isRevealed && fullKey ? fullKey : 'ZOYA-XXXX-XXXX-XXXX';
                          return (
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex items-center gap-1.5">
                                <code className="font-mono text-xs sm:text-sm font-bold text-teal-300 tracking-wider">
                                  {displayedKey}
                                </code>

                                {/* Eye Icon: reveals complete existing license key or hides it */}
                                <button
                                  type="button"
                                  onClick={(e) => handleToggleReveal(e, lic)}
                                  disabled={Boolean(loadingKeyIds[lic.id])}
                                  aria-label={isRevealed ? 'Hide license key' : 'Reveal license key'}
                                  title={
                                    loadingKeyIds[lic.id]
                                      ? 'Decrypting license key...'
                                      : isRevealed
                                        ? 'Hide license key'
                                        : 'Reveal complete license key'
                                  }
                                  className={`p-1 rounded-md transition-colors cursor-pointer shrink-0 disabled:opacity-60 ${
                                    isRevealed
                                      ? 'text-teal-300 bg-teal-500/20 hover:bg-teal-500/30'
                                      : 'text-slate-400 hover:text-teal-300 hover:bg-slate-800/60'
                                  }`}
                                >
                                  {loadingKeyIds[lic.id] ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-300" />
                                  ) : isRevealed ? (
                                    <EyeOff className="w-3.5 h-3.5" />
                                  ) : (
                                    <Eye className="w-3.5 h-3.5" />
                                  )}
                                </button>

                                {/* Copy Icon: copies complete existing license key with Copied confirmation */}
                                <button
                                  type="button"
                                  onClick={(e) => handleCopyRowKey(e, lic)}
                                  disabled={Boolean(loadingKeyIds[lic.id])}
                                  aria-label="Copy license key"
                                  title={
                                    loadingKeyIds[lic.id]
                                      ? 'Decrypting and copying...'
                                      : 'Copy license key to clipboard'
                                  }
                                  className="p-1 rounded-md text-slate-400 hover:text-teal-300 hover:bg-slate-800/60 transition-colors cursor-pointer shrink-0 disabled:opacity-60"
                                >
                                  {copiedRowId === lic.id ? (
                                    <Check className="w-3.5 h-3.5 text-teal-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>

                                {copiedRowId === lic.id && (
                                  <span className="text-[10px] font-semibold text-teal-300 animate-fade-in shrink-0">
                                    Copied
                                  </span>
                                )}
                              </div>
                              {renderStatusBadge(lic.status)}
                            </div>
                          );
                        })()}
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
                        <span>Tier: {lic.licenseType}</span>
                        <span>·</span>
                        <span>
                          {lic.linkedDevice ? (
                            <span className="text-emerald-300/90 font-mono">
                              Bound: {lic.linkedDevice.deviceModel}
                            </span>
                          ) : (
                            <span className="text-amber-300/80">
                              Not yet activated
                            </span>
                          )}
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

        {/* Right Column: Selected License Details, Device Binding, Activation & Revocation */}
        <div className="lg:col-span-5">
          {selectedLicense ? (
            <div className="p-4 sm:p-5 rounded-2xl bg-[#071319] border border-teal-500/30 space-y-4 sticky top-4">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block mb-1">
                    License Record Details
                  </span>
                  {(() => {
                    const fullKey = getFullKeyForLicense(selectedLicense);
                    const isRevealed = Boolean(revealedKeyIds[selectedLicense.id]);
                    const displayedKey = isRevealed && fullKey ? fullKey : 'ZOYA-XXXX-XXXX-XXXX';
                    return (
                      <div className="flex items-center gap-1.5">
                        <code className="font-mono text-base font-bold text-teal-300 tracking-wider">
                          {displayedKey}
                        </code>

                        {/* Eye Icon */}
                        <button
                          type="button"
                          onClick={(e) => handleToggleReveal(e, selectedLicense)}
                          disabled={Boolean(loadingKeyIds[selectedLicense.id])}
                          aria-label={isRevealed ? 'Hide license key' : 'Reveal license key'}
                          title={
                            loadingKeyIds[selectedLicense.id]
                              ? 'Decrypting license key...'
                              : isRevealed
                                ? 'Hide license key'
                                : 'Reveal complete license key'
                          }
                          className={`p-1 rounded-md transition-colors cursor-pointer shrink-0 disabled:opacity-60 ${
                            isRevealed
                              ? 'text-teal-300 bg-teal-500/20 hover:bg-teal-500/30'
                              : 'text-slate-400 hover:text-teal-300 hover:bg-slate-800/60'
                          }`}
                        >
                          {loadingKeyIds[selectedLicense.id] ? (
                            <Loader2 className="w-4 h-4 animate-spin text-teal-300" />
                          ) : isRevealed ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>

                        {/* Copy Icon */}
                        <button
                          type="button"
                          onClick={(e) => handleCopyRowKey(e, selectedLicense)}
                          disabled={Boolean(loadingKeyIds[selectedLicense.id])}
                          aria-label="Copy license key"
                          title={
                            loadingKeyIds[selectedLicense.id]
                              ? 'Decrypting and copying...'
                              : 'Copy license key to clipboard'
                          }
                          className="p-1 rounded-md text-slate-400 hover:text-teal-300 hover:bg-slate-800/60 transition-colors cursor-pointer shrink-0 disabled:opacity-60"
                        >
                          {copiedRowId === selectedLicense.id ? (
                            <Check className="w-4 h-4 text-teal-400" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>

                        {copiedRowId === selectedLicense.id && (
                          <span className="text-[11px] font-semibold text-teal-300 animate-fade-in shrink-0">
                            Copied
                          </span>
                        )}
                      </div>
                    );
                  })()}
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
                    License Tier
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
                    Last Seen Active
                  </span>
                  <strong className="text-slate-200 font-mono text-[11px] tabular-nums">
                    {formatTimestamp(selectedLicense.lastSeenAt, 'Not available')}
                  </strong>
                </div>
              </div>

              {/* Bound Android Phone Status Card */}
              <div className="p-3.5 rounded-xl bg-[#050d12] border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                    <Smartphone className="w-3.5 h-3.5 text-teal-400" />
                    <span>Bound Android Phone (1-Phone Lifetime)</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    Validations: {selectedLicense.validationCount || 0}
                  </span>
                </div>

                {selectedLicense.linkedDevice ? (
                  <div className="space-y-1.5 text-slate-300 text-[11px] font-mono">
                    <div className="flex justify-between border-b border-slate-800/60 pb-1">
                      <span className="text-slate-400">Phone Model:</span>
                      <strong className="text-white">{selectedLicense.linkedDevice.deviceModel}</strong>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/60 pb-1">
                      <span className="text-slate-400">Device ID:</span>
                      <span className="text-teal-300 truncate max-w-[200px]" title={selectedLicense.linkedDevice.deviceId}>
                        {selectedLicense.linkedDevice.deviceId}
                      </span>
                    </div>
                    {selectedLicense.linkedDevice.androidVersion && (
                      <div className="flex justify-between border-b border-slate-800/60 pb-1">
                        <span className="text-slate-400">Android:</span>
                        <span className="text-slate-200">{selectedLicense.linkedDevice.androidVersion}</span>
                      </div>
                    )}
                    {selectedLicense.linkedDevice.appVersion && (
                      <div className="flex justify-between border-b border-slate-800/60 pb-1">
                        <span className="text-slate-400">App Version:</span>
                        <span className="text-slate-200">{selectedLicense.linkedDevice.appVersion}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-400 text-[10px] pt-0.5">
                      <span>Bound At:</span>
                      <span>{formatTimestamp(selectedLicense.linkedDevice.linkedAt)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 rounded-lg bg-amber-950/20 border border-amber-500/20 text-amber-200/90 text-xs">
                    <strong>No Phone Bound:</strong> This license key has not been activated on any phone yet.
                    It will bind automatically to the first phone that activates it.
                  </div>
                )}

                {selectedLicense.status === 'revoked' && (
                  <div className="pt-2 border-t border-red-900/50 text-red-300 text-[11px]">
                    <strong>Revoked:</strong> {selectedLicense.revokeReason || 'Revoked by admin'} (
                    {formatTimestamp(selectedLicense.revokedAt)})
                  </div>
                )}
              </div>

              {/* Administrative Action Controls */}
              <div className="space-y-2.5 pt-1">
                {/* 1. REBIND ACTION (Only if active and has bound phone) */}
                {selectedLicense.status === 'active' && selectedLicense.linkedDevice && rebindLicenseId !== selectedLicense.id && (
                  <button
                    type="button"
                    onClick={() => openRebindPanel(selectedLicense)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[38px] rounded-xl font-semibold text-xs text-amber-300 bg-amber-950/30 hover:bg-amber-900/40 border border-amber-500/30 transition-colors cursor-pointer"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Rebind Device (Admin Authorized)</span>
                  </button>
                )}

                {/* Inline Rebind Confirmation Form */}
                {rebindLicenseId === selectedLicense.id && (
                  <form
                    onSubmit={handleConfirmRebind}
                    className="p-3.5 rounded-xl bg-slate-900 border border-amber-500/40 space-y-3 text-xs"
                  >
                    <div className="font-bold text-amber-300 uppercase tracking-wider text-[11px] flex items-center justify-between">
                      <span>Authorize Device Rebind</span>
                      <button
                        type="button"
                        onClick={() => setRebindLicenseId(null)}
                        className="text-slate-400 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-[11px] text-amber-200/80 leading-relaxed">
                      This clears the current phone binding ({selectedLicense.linkedDevice?.deviceModel}).
                      The license returns to <strong>Unactivated</strong> status so the customer can activate their replacement phone.
                    </p>
                    <div>
                      <label className="block text-[11px] text-slate-300 mb-1">
                        Reason for Rebinding <span className="text-amber-400">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={rebindReason}
                        onChange={(e) => setRebindReason(e.target.value)}
                        placeholder="e.g., Customer replaced phone / Factory reset device"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="submit"
                        disabled={submittingRebind}
                        className="flex-1 py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer disabled:opacity-50"
                      >
                        {submittingRebind ? 'Rebinding...' : 'Confirm Rebind'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRebindLicenseId(null)}
                        className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {/* 3. REVOKE ACTION (If not revoked) */}
                {selectedLicense.status !== 'revoked' && revokingLicenseId !== selectedLicense.id && (
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
                    <div className="font-bold text-red-300 uppercase tracking-wider text-[11px] flex items-center justify-between">
                      <span>Confirm License Revocation</span>
                      <button
                        type="button"
                        onClick={() => setRevokingLicenseId(null)}
                        className="text-slate-400 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
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
                        placeholder="e.g., Customer requested cancellation / Compromised key"
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
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
              Select a license from the list to inspect its bound phone, activation status, and audit history.
            </div>
          )}
        </div>
      </div>

      {/* ANDROID VALIDATION API SPECIFICATION FOOTER */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#071319] border border-slate-800 space-y-2 text-xs text-slate-300">
        <div className="flex items-center gap-2 font-bold text-white">
          <FileText className="w-4 h-4 text-teal-400" />
          <span>Zoya Android App Integration — One-Phone Lifetime License API</span>
        </div>
        <p className="text-slate-400 leading-relaxed">
          The Zoya Android client activates and validates lifetime keys via <code className="text-teal-300 font-mono">POST /api/licenses/validate</code> or <code className="text-teal-300 font-mono">POST /api/licenses/activate</code> with JSON payload{' '}
          <code className="text-slate-200 font-mono">{`{ "licenseKey": "ZOYA-XXXX-XXXX-XXXX", "deviceInfo": { "deviceId", "deviceModel", "androidVersion", "appVersion" } }`}</code>.
          On first activation, the key binds permanently to the phone&apos;s device ID. Any other phone receives <code className="text-red-300 font-mono">403 DEVICE_MISMATCH</code>. The authenticated phone receives a cryptographically signed entitlement token containing its bound device ID with 30-day offline grace during cloud outages.
        </p>
      </div>
    </div>
  );
};
