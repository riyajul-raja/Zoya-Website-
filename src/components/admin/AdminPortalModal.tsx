import React, { useState, useEffect } from 'react';
import { X, Shield, LogOut, CheckCircle } from 'lucide-react';
import { AdminLoginForm } from './AdminLoginForm';
import { ReleaseManager } from './ReleaseManager';

interface AdminPortalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReleaseChanged: () => void;
}

export const AdminPortalModal: React.FC<AdminPortalModalProps> = ({
  isOpen,
  onClose,
  onReleaseChanged,
}) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // Check existing session
  useEffect(() => {
    if (!isOpen) return;

    const storedToken = sessionStorage.getItem('zoya_admin_token');
    if (!storedToken) {
      setToken(null);
      setUser(null);
      setCheckingSession(false);
      return;
    }

    setCheckingSession(true);
    fetch('/api/admin/session', {
      headers: {
        Authorization: `Bearer ${storedToken}`,
      },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setToken(storedToken);
          setUser(data.user);
        } else {
          sessionStorage.removeItem('zoya_admin_token');
          setToken(null);
          setUser(null);
        }
      })
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        setCheckingSession(false);
      });
  }, [isOpen]);

  // Handle Escape key and body scroll lock
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleLogout = async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } catch (e) {
      // Ignore
    }
    sessionStorage.removeItem('zoya_admin_token');
    setToken(null);
    setUser(null);
  };

  const handleLoginSuccess = (newToken: string, loggedInUser: { email: string; name: string }) => {
    setToken(newToken);
    setUser(loggedInUser);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-2.5 sm:p-6 bg-black/85 backdrop-blur-md animate-overlay-fade overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-portal-title"
    >
      <div
        className="relative w-full max-w-4xl max-h-[94dvh] bg-[#050a0e] border border-teal-500/30 rounded-2xl sm:rounded-3xl p-4 sm:p-8 overflow-y-auto text-left shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-950 border border-teal-500/40 flex items-center justify-center text-teal-300 shrink-0">
              <Shield className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="admin-portal-title" className="text-base sm:text-xl font-bold text-white tracking-tight">
                Zoya Release Management &amp; Distribution
              </h2>
              <p className="text-xs text-slate-400">
                {user ? `Authenticated as ${user.name}` : 'Administrator Access Portal'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {user && (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors cursor-pointer"
                title="Sign out of Admin Portal"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-teal-400"
              aria-label="Close portal"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        {checkingSession ? (
          <div className="py-16 text-center text-xs text-slate-400">
            Checking authentication session...
          </div>
        ) : token && user ? (
          <ReleaseManager
            token={token}
            onReleasePublished={() => {
              onReleaseChanged();
            }}
          />
        ) : (
          <AdminLoginForm onSuccess={handleLoginSuccess} />
        )}
      </div>
    </div>
  );
};
