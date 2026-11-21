import React, { useEffect } from 'react';
import { X, FileText, ShieldCheck, Smartphone } from 'lucide-react';
import { ZoyaLogo } from './ZoyaLogo';

interface TermsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TermsModal: React.FC<TermsModalProps> = ({ isOpen, onClose }) => {
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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-4 bg-zinc-900/45 backdrop-blur-xs animate-overlay-fade"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-modal-title"
    >
      <div
        className="relative w-full max-w-2xl max-h-[90dvh] bg-white/95 backdrop-blur-xl border border-pink-200 rounded-3xl p-5 sm:p-8 overflow-y-auto text-left shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-pink-100">
          <div className="flex items-center gap-3">
            <ZoyaLogo size="sm" showText={false} />
            <div>
              <h3 id="terms-modal-title" className="text-base sm:text-lg font-bold text-zinc-900">
                Zoyalive Terms of Service
              </h3>
              <p className="text-xs text-zinc-500">Official Website &amp; Account Portal</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-500 hover:text-pink-600 hover:bg-pink-50 transition-colors focus-visible:outline-pink-600 cursor-pointer"
            aria-label="Close terms of service"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 space-y-5 text-xs sm:text-sm text-zinc-600 leading-relaxed">
          <div>
            <h4 className="font-bold text-zinc-900 text-sm mb-1.5 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-pink-600 shrink-0" aria-hidden="true" />
              <span>1. Account Sign-In &amp; Identity</span>
            </h4>
            <p>
              Zoyalive uses official Google OAuth 2.0 authentication to verify your account identity. We store only your verified Google account identifier, display name, verified email address, and profile image to operate your Zoyalive Account Dashboard and display your authorized license status.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-zinc-900 text-sm mb-1.5 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-pink-600 shrink-0" aria-hidden="true" />
              <span>2. Official APK &amp; License Usage</span>
            </h4>
            <p>
              Official Zoya AI Android releases are distributed directly through Zoyalive. Lifetime licenses are intended for personal use under the one-device binding policy and must not be resold, redistributed, or tampered with.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-zinc-900 text-sm mb-1.5 flex items-center gap-2">
              <FileText className="w-4 h-4 text-pink-600 shrink-0" aria-hidden="true" />
              <span>3. Contact &amp; Support</span>
            </h4>
            <p>
              For account or license support, contact the Zoya AI creator at{' '}
              <a
                href="mailto:riyajulansari113b@gmail.com"
                className="text-pink-600 hover:underline font-medium"
              >
                riyajulansari113b@gmail.com
              </a>
              .
            </p>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-pink-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-500 hover:to-rose-500 transition-all cursor-pointer focus-visible:outline-pink-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
