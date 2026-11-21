import React, { useState, useEffect, useCallback } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  LogOut,
  ShieldCheck,
  KeyRound,
  Smartphone,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  User as UserIcon,
  Mail,
  Fingerprint,
  Loader2,
  XCircle,
} from 'lucide-react';
import { ZoyaLogo } from './ZoyaLogo';
import type {
  AuthenticatedUser,
  UserLicenseSummary,
  AccountDashboardPayload,
} from '../types/account';

interface AccountDashboardProps {
  user: AuthenticatedUser;
  onBackHome: () => void;
  onSignOut: () => Promise<void>;
  onSessionExpired: () => void;
  onUserUpdated: (user: AuthenticatedUser) => void;
}

function formatDateDisplay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(parsed));
}

export const AccountDashboard: React.FC<AccountDashboardProps> = ({
  user,
  onBackHome,
  onSignOut,
  onSessionExpired,
  onUserUpdated,
}) => {
  const [dashboardUser, setDashboardUser] = useState<AuthenticatedUser>(user);
  const [licenseSummary, setLicenseSummary] = useState<UserLicenseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealingKey, setRevealingKey] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    setDashboardUser(user);
    setAvatarFailed(false);
  }, [user]);

  const fetchDashboard = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const res = await fetch('/api/account/dashboard', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });

        if (res.status === 401) {
          onSessionExpired();
          return;
        }

        const data = (await res.json().catch(() => ({}))) as Partial<AccountDashboardPayload> & {
          error?: string;
        };

        if (!res.ok || !data.success || !data.user || !data.licenseSummary) {
          setError(data.error || 'Unable to load account details right now. Please try again.');
          return;
        }

        setDashboardUser(data.user);
        onUserUpdated(data.user);
        setLicenseSummary(data.licenseSummary);
        setRevealedKey(null);
        setRevealError(null);
      } catch {
        setError('Network error while loading your Zoyalive account. Please check your connection.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onSessionExpired, onUserUpdated]
  );

  useEffect(() => {
    fetchDashboard(false);
  }, [fetchDashboard]);

  const handleToggleRevealKey = async () => {
    const license = licenseSummary?.license;
    if (!license) return;

    if (revealedKey) {
      setRevealedKey(null);
      setRevealError(null);
      return;
    }

    if (revealingKey) return;
    setRevealingKey(true);
    setRevealError(null);

    try {
      const res = await fetch('/api/account/license/reveal', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ licenseId: license.id }),
      });

      if (res.status === 401) {
        onSessionExpired();
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        licenseKey?: string;
        error?: string;
      };

      if (!res.ok || !data.success || !data.licenseKey) {
        setRevealError(data.error || 'Unable to reveal license key.');
        return;
      }

      setRevealedKey(data.licenseKey);
    } catch {
      setRevealError('Network error while retrieving your license key.');
    } finally {
      setRevealingKey(false);
    }
  };

  const handleCopyKey = async (textToCopy: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedKey(true);
      window.setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  const handleSignOutClick = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  const userInitial = (dashboardUser.name || dashboardUser.email || 'Z').charAt(0).toUpperCase();
  const memberSince = formatDateDisplay(dashboardUser.createdAt);
  const lastSignIn = formatDateDisplay(dashboardUser.lastLoginAt);

  const renderStatusBadge = (status: UserLicenseSummary['status']) => {
    if (status === 'active') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/12 text-emerald-700 border border-emerald-500/25">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
          Active
        </span>
      );
    }
    if (status === 'unactivated') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/12 text-amber-700 border border-amber-500/25">
          <Clock className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
          Issued · Ready to Activate
        </span>
      );
    }
    if (status === 'revoked') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/12 text-rose-700 border border-rose-500/25">
          <XCircle className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
          Revoked
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-500/10 text-zinc-700 border border-zinc-400/25">
        <KeyRound className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
        Not Purchased
      </span>
    );
  };

  return (
    <div className="min-h-screen flex flex-col relative z-10">
      {/* Top Account Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-pink-200/75 shadow-[0_8px_30px_rgba(219,39,119,0.05)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBackHome}
              className="inline-flex items-center gap-2 px-3 py-2 min-h-[42px] rounded-xl text-sm font-medium text-zinc-700 hover:text-pink-600 hover:bg-pink-50/70 border border-pink-200/70 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Back to Website</span>
              <span className="sm:hidden">Home</span>
            </button>
            <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-pink-100">
              <ZoyaLogo size="xs" showText={false} />
              <span className="text-sm font-bold text-zinc-900 tracking-tight">
                Zoyalive Account
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => fetchDashboard(true)}
              disabled={refreshing || loading}
              className="inline-flex items-center justify-center p-2.5 min-h-[42px] min-w-[42px] rounded-xl text-zinc-600 hover:text-pink-600 hover:bg-pink-50/80 border border-pink-200/70 transition-colors cursor-pointer disabled:opacity-50"
              aria-label="Refresh account status"
              title="Refresh account status"
            >
              <RefreshCw
                className={`w-4 h-4 ${refreshing ? 'animate-spin text-pink-600' : ''}`}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              onClick={handleSignOutClick}
              disabled={signingOut}
              className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[42px] rounded-xl text-xs sm:text-sm font-semibold text-rose-700 bg-rose-50/80 hover:bg-rose-100/90 border border-rose-200/80 transition-colors cursor-pointer disabled:opacity-60"
            >
              {signingOut ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut className="w-4 h-4" aria-hidden="true" />
              )}
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Dashboard Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <motion.div
          initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-6 sm:space-y-8"
        >
          {/* Welcome Header */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pink-600 mb-1.5">
                Zoyalive Account Dashboard
              </p>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900">
                Welcome back, {dashboardUser.name}
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
                Manage your verified Google account details and inspect your Zoya AI license status.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white/80 border border-pink-200/75 text-xs font-medium text-zinc-700 self-start sm:self-auto">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>Verified Google Session</span>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-2xl bg-rose-50/95 border border-rose-200 p-4 flex items-start gap-3 text-sm text-rose-800"
            >
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1">
                <p className="font-semibold">Unable to refresh account data</p>
                <p className="text-xs text-rose-700 mt-0.5">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => fetchDashboard(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-rose-700 border border-rose-200 hover:bg-rose-100/60 transition-colors cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {/* Grid: Profile Card + License Management Card */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* 1. Account Profile Card */}
            <section
              aria-labelledby="account-profile-heading"
              className="lg:col-span-5 glass-panel rounded-3xl p-6 sm:p-7 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 pb-4 border-b border-pink-100">
                  <div className="flex items-center gap-2">
                    <UserIcon className="w-4 h-4 text-pink-600" aria-hidden="true" />
                    <h2
                      id="account-profile-heading"
                      className="text-sm font-bold uppercase tracking-wider text-zinc-700"
                    >
                      Account Details
                    </h2>
                  </div>
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-pink-50 text-pink-700 border border-pink-200/80">
                    Google OAuth
                  </span>
                </div>

                {/* Avatar & Primary Identity */}
                <div className="mt-6 flex items-center gap-4">
                  <div className="relative w-16 h-16 rounded-2xl overflow-hidden shrink-0 border-2 border-pink-200/90 bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center shadow-md">
                    {dashboardUser.picture && !avatarFailed ? (
                      <img
                        src={dashboardUser.picture}
                        alt={`${dashboardUser.name} profile picture`}
                        referrerPolicy="no-referrer"
                        onError={() => setAvatarFailed(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xl font-bold text-white">{userInitial}</span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold text-zinc-900 truncate">
                      {dashboardUser.name}
                    </h3>
                    <p className="text-sm text-zinc-600 truncate">{dashboardUser.email}</p>
                    {dashboardUser.emailVerified && (
                      <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                        Verified email address
                      </span>
                    )}
                  </div>
                </div>

                {/* Verified Metadata List */}
                <dl className="mt-6 space-y-3 text-xs sm:text-sm">
                  <div className="flex items-start justify-between gap-3 p-3 rounded-2xl bg-pink-50/45 border border-pink-100/80">
                    <dt className="flex items-center gap-2 text-zinc-500 shrink-0">
                      <Mail className="w-4 h-4 text-pink-500" aria-hidden="true" />
                      <span>Email</span>
                    </dt>
                    <dd className="font-medium text-zinc-900 text-right break-all">
                      {dashboardUser.email}
                    </dd>
                  </div>

                  <div className="flex items-start justify-between gap-3 p-3 rounded-2xl bg-pink-50/45 border border-pink-100/80">
                    <dt className="flex items-center gap-2 text-zinc-500 shrink-0">
                      <Fingerprint className="w-4 h-4 text-pink-500" aria-hidden="true" />
                      <span>Account ID</span>
                    </dt>
                    <dd className="font-mono text-xs text-zinc-800 text-right break-all">
                      {dashboardUser.id}
                    </dd>
                  </div>

                  {memberSince && (
                    <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-zinc-600">
                      <dt>Account Created</dt>
                      <dd className="font-medium text-zinc-800 text-right">{memberSince}</dd>
                    </div>
                  )}

                  {lastSignIn && (
                    <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-zinc-600">
                      <dt>Last Sign-In</dt>
                      <dd className="font-medium text-zinc-800 text-right">{lastSignIn}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Account Management Actions */}
              <div className="mt-6 pt-5 border-t border-pink-100 flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={handleSignOutClick}
                  disabled={signingOut}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold text-zinc-800 bg-white hover:bg-rose-50 hover:text-rose-700 border border-pink-200/80 hover:border-rose-200 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {signingOut ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <LogOut className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>Sign Out of Zoyalive</span>
                </button>
              </div>
            </section>

            {/* 2. License Management Card */}
            <section
              aria-labelledby="license-management-heading"
              className="lg:col-span-7 glass-panel rounded-3xl p-6 sm:p-7 flex flex-col justify-between"
            >
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-pink-100">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-pink-600" aria-hidden="true" />
                    <h2
                      id="license-management-heading"
                      className="text-sm font-bold uppercase tracking-wider text-zinc-700"
                    >
                      License Status
                    </h2>
                  </div>

                  {!loading && licenseSummary && renderStatusBadge(licenseSummary.status)}
                </div>

                {loading ? (
                  <div className="py-14 flex flex-col items-center justify-center text-center text-zinc-500 gap-3">
                    <Loader2 className="w-7 h-7 text-pink-500 animate-spin" aria-hidden="true" />
                    <p className="text-sm font-medium">Verifying your Zoya AI license status...</p>
                  </div>
                ) : licenseSummary && licenseSummary.license ? (
                  <div className="mt-6 space-y-5">
                    {/* License Overview */}
                    <div className="rounded-2xl bg-gradient-to-br from-[#140e21] via-[#1c132d] to-[#130d1f] text-white p-5 sm:p-6 border border-pink-400/20 shadow-lg relative overflow-hidden">
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute -top-12 -right-12 w-40 h-40 rounded-full bg-pink-500/20 blur-2xl"
                      />
                      <div className="relative z-10 flex flex-col gap-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-pink-300">
                            Zoya AI · {licenseSummary.license.licenseType} License
                          </span>
                          <span className="text-[11px] text-zinc-400">
                            Linked via{' '}
                            {licenseSummary.license.matchMethod === 'user_sub'
                              ? 'Google Account'
                              : 'Verified Email'}
                          </span>
                        </div>

                        {/* License Key Row */}
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-white/[0.06] border border-white/10 rounded-xl px-4 py-3">
                          <code className="font-mono text-sm sm:text-base tracking-wider text-white select-all">
                            {revealedKey || licenseSummary.license.maskedKey}
                          </code>

                          <div className="flex items-center gap-2">
                            {licenseSummary.license.canRevealKey && (
                              <button
                                type="button"
                                onClick={handleToggleRevealKey}
                                disabled={revealingKey}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer disabled:opacity-60"
                              >
                                {revealingKey ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                                ) : revealedKey ? (
                                  <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                                )}
                                <span>{revealedKey ? 'Hide' : 'Reveal'}</span>
                              </button>
                            )}

                            {revealedKey && (
                              <button
                                type="button"
                                onClick={() => handleCopyKey(revealedKey)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-pink-500/80 hover:bg-pink-500 text-white transition-colors cursor-pointer"
                              >
                                {copiedKey ? (
                                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                                )}
                                <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {revealError && (
                          <p className="text-xs text-rose-300 flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>{revealError}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Device Activation & Binding Info */}
                    <div className="rounded-2xl bg-pink-50/45 border border-pink-100 p-4 sm:p-5 space-y-3">
                      <div className="flex items-center gap-2 text-sm font-bold text-zinc-900">
                        <Smartphone className="w-4 h-4 text-pink-600" aria-hidden="true" />
                        <span>Device Activation</span>
                      </div>

                      {licenseSummary.license.linkedDevice ? (
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm">
                          <div className="p-3 rounded-xl bg-white/80 border border-pink-100">
                            <dt className="text-xs text-zinc-500">Bound Android Device</dt>
                            <dd className="mt-0.5 font-semibold text-zinc-900">
                              {licenseSummary.license.linkedDevice.deviceModel}
                            </dd>
                          </div>

                          <div className="p-3 rounded-xl bg-white/80 border border-pink-100">
                            <dt className="text-xs text-zinc-500">Activated On</dt>
                            <dd className="mt-0.5 font-semibold text-zinc-900">
                              {formatDateDisplay(
                                licenseSummary.license.activatedAt ||
                                  licenseSummary.license.linkedDevice.linkedAt
                              ) || 'Verified'}
                            </dd>
                          </div>

                          {licenseSummary.license.linkedDevice.androidVersion && (
                            <div className="p-3 rounded-xl bg-white/80 border border-pink-100">
                              <dt className="text-xs text-zinc-500">Android Version</dt>
                              <dd className="mt-0.5 font-medium text-zinc-800">
                                {licenseSummary.license.linkedDevice.androidVersion}
                              </dd>
                            </div>
                          )}

                          {licenseSummary.license.lastSeenAt && (
                            <div className="p-3 rounded-xl bg-white/80 border border-pink-100">
                              <dt className="text-xs text-zinc-500">Last Verified</dt>
                              <dd className="mt-0.5 font-medium text-zinc-800">
                                {formatDateDisplay(licenseSummary.license.lastSeenAt)}
                              </dd>
                            </div>
                          )}
                        </dl>
                      ) : (
                        <p className="text-xs sm:text-sm text-zinc-600 leading-relaxed">
                          {licenseSummary.license.status === 'revoked'
                            ? 'This license has been revoked and is no longer active on any device.'
                            : 'This license has not been activated on an Android device yet. Enter your license key inside the official Zoya AI Android app to activate it.'}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  /* No License Linked / Not Purchased */
                  <div className="mt-6 rounded-2xl bg-pink-50/45 border border-pink-100 p-6 sm:p-7 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-white border border-pink-200/80 shadow-xs mx-auto flex items-center justify-center mb-4">
                      <KeyRound className="w-6 h-6 text-pink-500" aria-hidden="true" />
                    </div>
                    <h3 className="text-base sm:text-lg font-bold text-zinc-900">
                      No Zoya AI License Linked Yet
                    </h3>
                    <p className="mt-2 text-xs sm:text-sm text-zinc-600 max-w-md mx-auto leading-relaxed">
                      We checked your verified Google account ({dashboardUser.email}) and did not
                      find an active Zoya AI Lifetime License linked to it yet.
                    </p>
                    <p className="mt-3 text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
                      If a lifetime license is issued to your verified email address, it will appear
                      here automatically with your activation and device status.
                    </p>
                  </div>
                )}
              </div>

              {/* Footer Security Note */}
              <div className="mt-6 pt-4 border-t border-pink-100 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-pink-500" aria-hidden="true" />
                  <span>License records are verified directly on the Zoyalive server.</span>
                </span>
                <button
                  type="button"
                  onClick={onBackHome}
                  className="font-semibold text-pink-600 hover:text-pink-700 hover:underline cursor-pointer"
                >
                  Download Zoya APK →
                </button>
              </div>
            </section>
          </div>
        </motion.div>
      </main>
    </div>
  );
};
