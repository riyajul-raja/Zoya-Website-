import React, { useState, useEffect, useCallback } from 'react';
import { X, LogOut, Shield, ArrowLeft } from 'lucide-react';
import { AdminLoginForm } from './AdminLoginForm';
import { ReleaseManager } from './ReleaseManager';

interface AdminPortalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReleaseChanged?: () => void;
  onReleasePublished?: () => void;
}

export const AdminPortalModal: React.FC<AdminPortalModalProps> = ({
  isOpen,
  onClose,
  onReleaseChanged,
  onReleasePublished,
}) => {
  const handleReleaseUpdate = () => {
    if (onReleaseChanged) onReleaseChanged();
    if (onReleasePublished) onReleasePublished();
  };

  // STRICT SECURITY REQUIREMENT:
  // Admin Portal requires PIN on EVERY open.
  // Never load or persist session tokens in localStorage or sessionStorage.
  // In-memory state starts as null every time the portal opens.
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);

  // Invalidate session on server and reset in-memory state
  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // Ignore
    }
    setToken(null);
    setUser(null);
    try {
      sessionStorage.removeItem('zoya_admin_token');
      localStorage.removeItem('zoya_admin_token');
      sessionStorage.removeItem('zoya_known_license_keys');
    } catch {
      // Ignore
    }
  }, []);

  const handleClose = useCallback(async () => {
    await handleLogout();
    onClose();
  }, [handleLogout, onClose]);

  // When modal opens or closes, ensure state starts clean and PIN is required
  useEffect(() => {
    if (isOpen) {
      // Reset authentication state so PIN entry screen is displayed first
      setToken(null);
      setUser(null);
      try {
        sessionStorage.removeItem('zoya_admin_token');
        localStorage.removeItem('zoya_admin_token');
        sessionStorage.removeItem('zoya_known_license_keys');
      } catch {
        // Ignore
      }
    } else {
      // When closed, trigger server session invalidation
      handleLogout();
    }
  }, [isOpen, handleLogout]);

  // Close on Escape key and lock background body scroll while full-page portal is active
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[110] w-screen h-dvh flex flex-col bg-[#040c10] text-slate-100 overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-portal-title"
    >
      {/* Full-Width Top Navigation Header */}
      <header className="w-full border-b border-slate-800/90 bg-[#071319]/95 backdrop-blur-md shrink-0">
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-teal-950 border border-teal-500/40 flex items-center justify-center text-teal-300 shrink-0">
              <Shield className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="admin-portal-title"
                className="text-sm sm:text-base font-bold text-white tracking-tight truncate"
              >
                Zoya Admin Portal
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                Release Management, Push Notifications &amp; Lifetime License Management
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {user && (
              <div className="flex items-center gap-2 sm:gap-3">
                <span className="hidden md:inline-block px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 font-mono">
                  {user.name} ({user.email})
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 hover:text-white transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5 text-teal-400" aria-hidden="true" />
                  <span>Sign Out</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleClose}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 hover:text-white transition-colors cursor-pointer"
              aria-label="Close Admin Portal and return to website"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-teal-400 hidden sm:inline" aria-hidden="true" />
              <span className="hidden sm:inline">Back to Website</span>
              <X className="w-4 h-4 sm:hidden" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* Full-Viewport Scrollable Workspace */}
      <main className="flex-1 w-full overflow-y-auto overscroll-contain">
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {token && user ? (
            <ReleaseManager
              token={token}
              onReleasePublished={handleReleaseUpdate}
              onUnauthorized={handleLogout}
            />
          ) : (
            <div className="min-h-[65vh] flex items-center justify-center py-6">
              <div className="w-full max-w-md">
                <AdminLoginForm
                  onSuccess={(newToken, loggedInUser) => {
                    setToken(newToken);
                    setUser(loggedInUser);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
