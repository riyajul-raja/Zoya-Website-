import React, { useState, useEffect } from 'react';
import { X, Shield, LogOut } from 'lucide-react';
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
      .then(async (res) => {
        const text = await res.text();
        try {
          return text ? JSON.parse(text) : {};
        } catch {
          return { authenticated: false };
        }
      })
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
      className="fixed inset-0 z-[110] flex items-center justify-center p-2.5 sm:p-6 bg-zinc-900/35 backdrop-blur-xs animate-overlay-fade overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-portal-title"
    >
      <div
        className="relative w-full max-w-4xl max-h-[94dvh] bg-white/95 backdrop-blur-xl border border-pink-200 rounded-3xl p-4 sm:p-8 overflow-y-auto text-left shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-pink-100 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-pink-50 border border-pink-200 flex items-center justify-center text-pink-600 shrink-0">
              <Shield className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="admin-portal-title" className="text-base sm:text-xl font-bold text-zinc-900 tracking-tight">
                Zoya Release Management &amp; Distribution
              </h2>
              <p className="text-xs text-zinc-500">
                {user ? `Authenticated as ${user.name}` : 'Administrator Access Portal'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {user && (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-700 hover:text-pink-600 bg-pink-50/70 hover:bg-pink-100/70 border border-pink-200 rounded-xl transition-colors cursor-pointer"
                title="Sign out of Admin Portal"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-zinc-500 hover:text-pink-600 hover:bg-pink-50 transition-colors focus-visible:outline-pink-600 cursor-pointer"
              aria-label="Close portal"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        {checkingSession ? (
          <div className="py-16 text-center text-xs text-zinc-500">
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
