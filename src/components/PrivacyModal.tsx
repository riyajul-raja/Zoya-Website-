import React, { useEffect } from 'react';
import { X, ShieldCheck, Lock, EyeOff, Server } from 'lucide-react';

interface PrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyModal: React.FC<PrivacyModalProps> = ({ isOpen, onClose }) => {
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
      className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4 bg-zinc-900/35 backdrop-blur-xs animate-overlay-fade"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-modal-title"
    >
      <div
        className="relative w-full max-w-2xl max-h-[90dvh] bg-white/95 backdrop-blur-xl border border-pink-200 rounded-3xl p-5 sm:p-8 overflow-y-auto text-left shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-pink-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-pink-50 border border-pink-200 flex items-center justify-center text-pink-600 shrink-0">
              <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 id="privacy-modal-title" className="text-base sm:text-lg font-bold text-zinc-900">
                Zoya Privacy Policy
              </h3>
              <p className="text-xs text-zinc-500">Effective Date: October 2026</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-500 hover:text-pink-600 hover:bg-pink-50 transition-colors focus-visible:outline-pink-600 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-5 space-y-5 text-xs sm:text-sm text-zinc-600 leading-relaxed">
          <div>
            <h4 className="font-bold text-zinc-900 text-sm mb-1.5 flex items-center gap-2">
              <Lock className="w-4 h-4 text-pink-600 shrink-0" aria-hidden="true" />
              <span>1. Voice and Microphone Data</span>
            </h4>
            <p>
              Zoya requests Android microphone permission solely to capture your spoken voice commands when you activate the assistant. Audio captures are converted to text to fulfill your requests. Voice recordings are not sold to third-party brokers or used for targeted commercial profiling.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-zinc-900 text-sm mb-1.5 flex items-center gap-2">
              <Server className="w-4 h-4 text-pink-600 shrink-0" aria-hidden="true" />
              <span>2. Local Memory and Preferences</span>
            </h4>
            <p>
              Your assistant settings (such as voice speed, response preferences, and custom saved notes) are kept locally inside your Android device&apos;s isolated application storage. You can clear your session history and local memory at any time via Zoya&apos;s Assistant Settings.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-zinc-900 text-sm mb-1.5 flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-pink-600 shrink-0" aria-hidden="true" />
              <span>3. Device Permissions</span>
            </h4>
            <p>
              Zoya operates with minimal permissions. The application does not request access to your contacts, SMS messages, call logs, camera, or personal photo galleries.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-zinc-900 text-sm mb-1.5">
              4. Questions and Inquiries
            </h4>
            <p>
              If you have any questions regarding privacy practices or data handling, you may contact the creator directly at{' '}
              <a
                href="mailto:riyajulansari113b@gmail.com"
                className="text-pink-600 hover:underline font-medium"
              >
                riyajulansari113b@gmail.com
              </a>.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-pink-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-500 hover:to-rose-500 transition-all cursor-pointer focus-visible:outline-pink-600"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
};
