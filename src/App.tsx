/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { ApkDownload } from './components/ApkDownload';
import { FeatureGrid } from './components/FeatureGrid';
import { InstallationGuide } from './components/InstallationGuide';
import { Faq } from './components/Faq';
import { Footer } from './components/Footer';
import { LivingBackground } from './components/LivingBackground';
import { PrivacyModal } from './components/PrivacyModal';
import { TermsModal } from './components/TermsModal';
import { ContactModal } from './components/ContactModal';
import { LoginModal, mapAuthErrorCode } from './components/LoginModal';
import { AccountDashboard } from './components/AccountDashboard';
import { AdminPortalModal } from './components/admin/AdminPortalModal';
import { ReleaseMetadata } from '../server/storage';
import { DEFAULT_APK_CONFIG } from './config/apkConfig';
import type { AuthenticatedUser } from './types/account';

function isAccountPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return clean === '/account' || clean === '/dashboard';
}

export default function App() {
  const [latestRelease, setLatestRelease] = useState<ReleaseMetadata | null>(null);
  const [loadingRelease, setLoadingRelease] = useState(true);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  // Stage 1 & 2 User Authentication & Account Dashboard State (strictly server-verified, never localStorage)
  const [authUser, setAuthUser] = useState<AuthenticatedUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'home' | 'account'>(() =>
    typeof window !== 'undefined' && isAccountPath(window.location.pathname) ? 'account' : 'home'
  );

  // Fetch real latest published release from backend
  const fetchLatestRelease = useCallback(async () => {
    setLoadingRelease(true);
    try {
      const res = await fetch('/api/releases/latest');
      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        // Fallback
      }
      if (res.ok && data.published && data.release) {
        setLatestRelease(data.release);
      } else {
        setLatestRelease(null);
      }
    } catch (err) {
      console.warn('Could not query releases backend:', err);
      setLatestRelease(null);
    } finally {
      setLoadingRelease(false);
    }
  }, []);

  const verifySessionPromiseRef = React.useRef<Promise<AuthenticatedUser | null> | null>(null);

  // Verify user session strictly from server HttpOnly cookie (deduplicates concurrent in-flight checks)
  const verifyUserSession = useCallback(async (): Promise<AuthenticatedUser | null> => {
    if (verifySessionPromiseRef.current) {
      return verifySessionPromiseRef.current;
    }

    setAuthLoading(true);
    const requestPromise = (async (): Promise<AuthenticatedUser | null> => {
      try {
        const res = await fetch('/api/auth/session', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        const data = (await res.json().catch(() => ({}))) as {
          authenticated?: boolean;
          user?: AuthenticatedUser | null;
        };

        if (res.ok && data.authenticated && data.user) {
          setAuthUser(data.user);
          return data.user;
        }

        setAuthUser(null);
        return null;
      } catch {
        setAuthUser(null);
        return null;
      } finally {
        verifySessionPromiseRef.current = null;
        setAuthLoading(false);
      }
    })();

    verifySessionPromiseRef.current = requestPromise;
    return requestPromise;
  }, []);

  const navigateToHome = useCallback((replaceHistory = false) => {
    setActiveView('home');
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      if (replaceHistory) {
        window.history.replaceState({ view: 'home' }, '', '/');
      } else {
        window.history.pushState({ view: 'home' }, '', '/');
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const navigateToAccount = useCallback((replaceHistory = false) => {
    setActiveView('account');
    setLoginOpen(false);
    setLoginError(null);
    if (typeof window !== 'undefined' && !isAccountPath(window.location.pathname)) {
      if (replaceHistory) {
        window.history.replaceState({ view: 'account' }, '', '/account');
      } else {
        window.history.pushState({ view: 'account' }, '', '/account');
      }
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  // Initial load: fetch releases, verify server session, handle OAuth callback error params & route protection
  useEffect(() => {
    let isCancelled = false;
    fetchLatestRelease();

    const stripAuthErrorParam = () => {
      const currentParams = new URLSearchParams(window.location.search);
      if (!currentParams.has('auth_error')) return;
      currentParams.delete('auth_error');
      const remainingQuery = currentParams.toString();
      const cleanUrl = `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', cleanUrl);
    };

    const params = new URLSearchParams(window.location.search);
    const authErrorParam = params.get('auth_error');
    const normalizedAuthError = authErrorParam ? authErrorParam.trim().toLowerCase() : null;
    const isInvalidStateError = normalizedAuthError === 'invalid_state';

    if (authErrorParam && !isInvalidStateError) {
      const mapped = mapAuthErrorCode(authErrorParam);
      setLoginError(mapped);
      setLoginOpen(true);
      stripAuthErrorParam();
    }

    const requestedAccountRoute = isAccountPath(window.location.pathname);

    verifyUserSession().then((verifiedUser) => {
      if (isCancelled) return;

      if (isInvalidStateError) {
        stripAuthErrorParam();
        if (verifiedUser) {
          setAuthUser(verifiedUser);
          setLoginError(null);
          setLoginOpen(false);
          navigateToAccount(true);
          return;
        }

        if (requestedAccountRoute) {
          setActiveView('home');
          window.history.replaceState({ view: 'home' }, '', '/');
        }
        setLoginError(mapAuthErrorCode(authErrorParam));
        setLoginOpen(true);
        return;
      }

      if (requestedAccountRoute) {
        if (verifiedUser) {
          setActiveView('account');
        } else {
          // Direct unauthenticated access to /account redirects to homepage and opens Login Card
          setActiveView('home');
          window.history.replaceState({ view: 'home' }, '', '/');
          if (!authErrorParam) {
            setLoginError('Please sign in with Google to access your Zoyalive account dashboard.');
          }
          setLoginOpen(true);
        }
      }
    });

    // Check if user navigated with #admin hash
    if (window.location.hash === '#admin') {
      setAdminOpen(true);
    }

    const handleHashChange = () => {
      if (window.location.hash === '#admin') {
        setAdminOpen(true);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      isCancelled = true;
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [fetchLatestRelease, verifyUserSession, navigateToAccount]);

  // Protect browser back/forward navigation so protected account view is never exposed after logout
  useEffect(() => {
    const handlePopState = async () => {
      if (isAccountPath(window.location.pathname)) {
        const verified = await verifyUserSession();
        if (verified) {
          setActiveView('account');
        } else {
          setActiveView('home');
          window.history.replaceState({ view: 'home' }, '', '/');
          setLoginError('Please sign in with Google to access your Zoyalive account dashboard.');
          setLoginOpen(true);
        }
      } else {
        setActiveView('home');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [verifyUserSession]);

  // Re-verify session if browser restores page from bfcache after logout
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted && isAccountPath(window.location.pathname)) {
        verifyUserSession().then((verified) => {
          if (!verified) {
            setActiveView('home');
            window.history.replaceState({ view: 'home' }, '', '/');
          }
        });
      }
    };

    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [verifyUserSession]);

  const handleAuthSuccess = useCallback(async () => {
    const verified = await verifyUserSession();
    if (verified) {
      navigateToAccount(false);
    }
  }, [verifyUserSession, navigateToAccount]);

  const handleSignOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
    } catch {
      // Clear local state even if network hiccups
    } finally {
      setAuthUser(null);
      setLoginError(null);
      navigateToHome(true);
    }
  }, [navigateToHome]);

  const handleSessionExpired = useCallback(() => {
    setAuthUser(null);
    setActiveView('home');
    window.history.replaceState({ view: 'home' }, '', '/');
    setLoginError('Your sign-in session has expired. Please sign in with Google again.');
    setLoginOpen(true);
  }, []);

  const scrollToDownload = () => {
    const el = document.querySelector('#download');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const scrollToFeatures = () => {
    const el = document.querySelector('#features');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-pink-ambient text-zinc-900 flex flex-col font-sans selection:bg-pink-500/15 selection:text-pink-700 relative">
      {/* Lightweight Living Particle & Flowing-Light Background */}
      <LivingBackground />

      {activeView === 'account' ? (
        authLoading && !authUser ? (
          <div className="relative z-10 flex-1 min-h-screen flex flex-col items-center justify-center p-6 text-center gap-3">
            <Loader2 className="w-8 h-8 text-pink-600 animate-spin" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-600">
              Verifying your Zoyalive session...
            </p>
          </div>
        ) : authUser ? (
          <AccountDashboard
            user={authUser}
            onBackHome={() => navigateToHome(false)}
            onSignOut={handleSignOut}
            onSessionExpired={handleSessionExpired}
            onUserUpdated={setAuthUser}
          />
        ) : null
      ) : (
        <>
          {/* Top Navigation */}
          <Navbar
            onOpenAdmin={() => setAdminOpen(true)}
            onOpenLogin={() => {
              setLoginError(null);
              setLoginOpen(true);
            }}
            onOpenAccount={() => navigateToAccount(false)}
            authUser={authUser}
            authLoading={authLoading}
          />

          {/* Main Content Sections */}
          <main className="relative z-10 flex-1">
            {/* Hero Section */}
            <Hero
              latestRelease={latestRelease}
              onExploreDownloads={scrollToDownload}
              onExploreFeatures={scrollToFeatures}
              onDownloadClick={scrollToDownload}
            />

            {/* Section 1 — Simple Setup */}
            <InstallationGuide />

            {/* Official Android Release / APK Download Area */}
            <ApkDownload
              latestRelease={latestRelease}
              loading={loadingRelease}
              onOpenAdmin={() => setAdminOpen(true)}
            />

            {/* 8 Feature Cards directly below Download section */}
            <FeatureGrid />

            {/* Frequently Asked Questions */}
            <Faq apkConfig={DEFAULT_APK_CONFIG} />
          </main>

          {/* Footer with Creator Credit and Admin Link */}
          <div className="relative z-10">
            <Footer
              latestRelease={latestRelease}
              onOpenPrivacy={() => setPrivacyOpen(true)}
              onOpenContact={() => setContactOpen(true)}
              onOpenAdmin={() => setAdminOpen(true)}
            />
          </div>
        </>
      )}

      {/* Stage 1 Dark Premium Glassmorphism Login Card */}
      <LoginModal
        isOpen={loginOpen}
        onClose={() => {
          setLoginOpen(false);
          setLoginError(null);
        }}
        onAuthSuccess={handleAuthSuccess}
        onOpenPrivacy={() => setPrivacyOpen(true)}
        onOpenTerms={() => setTermsOpen(true)}
        initialError={loginError}
      />

      {/* Modals for Privacy Policy, Terms of Service & Direct Creator Contact */}
      <PrivacyModal isOpen={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      <TermsModal isOpen={termsOpen} onClose={() => setTermsOpen(false)} />
      <ContactModal isOpen={contactOpen} onClose={() => setContactOpen(false)} />

      {/* Secure Admin APK Release Management Portal */}
      <AdminPortalModal
        isOpen={adminOpen}
        onClose={() => {
          setAdminOpen(false);
          if (window.location.hash === '#admin') {
            history.pushState('', document.title, window.location.pathname + window.location.search);
          }
        }}
        onReleaseChanged={() => {
          fetchLatestRelease();
        }}
      />
    </div>
  );
}
