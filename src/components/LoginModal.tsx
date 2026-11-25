import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { X, Loader2, ShieldCheck, AlertCircle } from 'lucide-react';
import { ZoyaLogo } from './ZoyaLogo';
import { GoogleIcon } from './GoogleIcon';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: () => Promise<void> | void;
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
  initialError?: string | null;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured:
    'Google sign-in is not yet configured on this server. Please check back once OAuth credentials are enabled.',
  access_denied: 'Google sign-in was cancelled. You can try again whenever you are ready.',
  invalid_state:
    'Your sign-in session expired or could not be verified. Please try signing in again.',
  verification_failed:
    'We could not verify your Google account token. Please try signing in again.',
  storage_unavailable:
    'The account service is temporarily unavailable. Please try again in a moment.',
  google_error: 'Google returned an authentication error. Please try again.',
  auth_failed: 'Unable to complete Google sign-in. Please try again.',
};

export function mapAuthErrorCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = code.trim().toLowerCase();
  return AUTH_ERROR_MESSAGES[normalized] || AUTH_ERROR_MESSAGES.auth_failed;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  onOpenPrivacy,
  onOpenTerms,
  initialError = null,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError);
  const [mounted, setMounted] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const popupCheckTimerRef = useRef<number | null>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(initialError || null);
      setIsSubmitting(false);
    }
  }, [isOpen, initialError]);

  const cleanupPopupWatcher = useCallback(() => {
    if (popupCheckTimerRef.current !== null) {
      window.clearInterval(popupCheckTimerRef.current);
      popupCheckTimerRef.current = null;
    }
    popupRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupPopupWatcher();
    };
  }, [cleanupPopupWatcher]);

  // Body scroll lock & Escape key handler
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isSubmitting, onClose]);

  // Listen for same-origin OAuth popup completion messages
  useEffect(() => {
    if (!isOpen) return;

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || data.type !== 'ZOYA_AUTH_COMPLETE') {
        return;
      }

      cleanupPopupWatcher();

      if (data.success) {
        setErrorMessage(null);
        try {
          await onAuthSuccess();
        } finally {
          setIsSubmitting(false);
        }
      } else {
        setIsSubmitting(false);
        setErrorMessage(mapAuthErrorCode(data.errorCode));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isOpen, onAuthSuccess, cleanupPopupWatcher]);

  const handleContinueWithGoogle = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    const isInsideIframe = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();

    const mode: 'popup' | 'redirect' = isInsideIframe ? 'popup' : 'redirect';

    if (mode === 'redirect') {
      window.location.assign('/api/auth/google/start?mode=redirect');
      return;
    }

    try {
      const response = await fetch('/api/auth/google/start?mode=popup&format=json', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      });

      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        authorizationUrl?: string;
        code?: string;
        error?: string;
      };

      if (!response.ok || !data.success || !data.authorizationUrl) {
        setIsSubmitting(false);
        if (data.code === 'OAUTH_NOT_CONFIGURED') {
          setErrorMessage(AUTH_ERROR_MESSAGES.oauth_not_configured);
        } else {
          setErrorMessage(data.error || 'Unable to start Google sign-in. Please try again.');
        }
        return;
      }

      // Popup mode for embedded preview environments where Google blocks iframe navigation
      const width = 520;
      const height = 640;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

      const popup = window.open(
        data.authorizationUrl,
        'zoyalive_google_oauth',
        `width=${width},height=${height},left=${left},top=${top},noopener=no`
      );

      if (!popup || popup.closed) {
        setIsSubmitting(false);
        setErrorMessage(
          'Your browser blocked the Google sign-in window. Please allow popups for Zoyalive and try again.'
        );
        return;
      }

      popupRef.current = popup;
      popup.focus();

      cleanupPopupWatcher();
      popupCheckTimerRef.current = window.setInterval(() => {
        if (popupRef.current && popupRef.current.closed) {
          cleanupPopupWatcher();
          setIsSubmitting(false);
        }
      }, 600);
    } catch {
      setIsSubmitting(false);
      setErrorMessage('Network error while connecting to Zoyalive sign-in. Please try again.');
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="zoyalive-login-backdrop"
          initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[115] flex items-center justify-center p-4 bg-[#07050c]/75 backdrop-blur-md"
          onClick={() => {
            if (!isSubmitting) onClose();
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="zoyalive-login-heading"
          aria-describedby="zoyalive-login-subtitle"
        >
          <motion.div
            key="zoyalive-login-card"
            initial={
              shouldReduceMotion
                ? { opacity: 1, scale: 1, y: 0 }
                : { opacity: 0, scale: 0.96, y: 12 }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.97, y: 8 }
            }
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[420px] rounded-[28px] overflow-hidden bg-[#110c1b]/94 backdrop-blur-2xl border border-pink-300/20 shadow-[0_28px_90px_-15px_rgba(219,39,119,0.34),0_0_0_1px_rgba(168,85,247,0.14)] text-zinc-100"
          >
            {/* Subtle Pink & Purple Ambient Glow */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-24 -left-20 w-64 h-64 rounded-full bg-pink-500/22 blur-3xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-24 -right-16 w-64 h-64 rounded-full bg-purple-600/22 blur-3xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-pink-400/55 to-transparent"
            />

            {/* Close Button */}
            <button
              type="button"
              onClick={() => {
                if (!isSubmitting) onClose();
              }}
              disabled={isSubmitting}
              className="absolute top-4 right-4 z-20 p-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-pink-400 cursor-pointer disabled:opacity-50"
              aria-label="Close sign-in dialog"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>

            {/* Card Body */}
            <div className="relative z-10 px-6 sm:px-8 pt-9 pb-7 flex flex-col items-center text-center">
              {/* 1. Official Zoya Logo */}
              <div className="relative mb-3">
                <div
                  aria-hidden="true"
                  className="absolute -inset-2 rounded-full bg-gradient-to-tr from-pink-500/30 via-fuchsia-500/20 to-purple-500/30 blur-xl"
                />
                <div className="relative rounded-2xl p-1.5 bg-white/[0.04] border border-white/10 shadow-inner">
                  <ZoyaLogo size="lg" showText={false} />
                </div>
              </div>

              {/* 2. Brand Name */}
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-pink-300/90 mb-2">
                Zoyalive
              </span>

              {/* 3. Heading */}
              <h2
                id="zoyalive-login-heading"
                className="text-2xl sm:text-[26px] font-bold tracking-tight text-white"
              >
                Welcome to Zoyalive
              </h2>

              {/* 4. Subtitle */}
              <p
                id="zoyalive-login-subtitle"
                className="mt-1.5 text-sm text-zinc-300/90 max-w-[280px]"
              >
                Your personal Zoya AI account.
              </p>

              {/* Error Banner */}
              {errorMessage && (
                <div
                  role="alert"
                  className="mt-5 w-full rounded-2xl bg-rose-500/12 border border-rose-400/30 px-4 py-3 text-left flex items-start gap-2.5 text-xs text-rose-200 leading-relaxed"
                >
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* 5. Main Google OAuth Button */}
              <div className="mt-7 w-full">
                <button
                  type="button"
                  onClick={handleContinueWithGoogle}
                  disabled={isSubmitting}
                  className="group relative w-full min-h-[50px] px-5 py-3 rounded-2xl bg-white hover:bg-zinc-50 active:scale-[0.99] text-zinc-900 font-semibold text-sm sm:text-[15px] shadow-[0_10px_30px_-8px_rgba(255,255,255,0.28)] hover:shadow-[0_14px_36px_-8px_rgba(244,114,182,0.35)] border border-white/80 flex items-center justify-center gap-3 transition-all duration-200 cursor-pointer disabled:opacity-75 disabled:cursor-wait focus-visible:outline-pink-400"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-5 h-5 text-pink-600 animate-spin" aria-hidden="true" />
                      <span>Connecting to Google...</span>
                    </>
                  ) : (
                    <>
                      <GoogleIcon className="w-5 h-5 shrink-0" />
                      <span>Continue with Google</span>
                    </>
                  )}
                </button>
              </div>

              {/* 6. Security Message */}
              <p className="mt-4 inline-flex items-center justify-center gap-1.5 text-xs text-zinc-400">
                <ShieldCheck className="w-3.5 h-3.5 text-pink-400 shrink-0" aria-hidden="true" />
                <span>Secure sign-in with your Google account.</span>
              </p>

              {/* 7. Footer Links */}
              <div className="mt-7 pt-5 w-full border-t border-white/10 flex items-center justify-center gap-3 text-xs text-zinc-400">
                <button
                  type="button"
                  onClick={onOpenPrivacy}
                  className="hover:text-pink-300 transition-colors cursor-pointer py-1"
                >
                  Privacy Policy
                </button>
                <span aria-hidden="true" className="text-zinc-600">
                  |
                </span>
                <button
                  type="button"
                  onClick={onOpenTerms}
                  className="hover:text-pink-300 transition-colors cursor-pointer py-1"
                >
                  Terms of Service
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
