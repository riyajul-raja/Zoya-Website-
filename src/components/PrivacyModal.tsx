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
      className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-overlay-fade"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-modal-title"
    >
      <div
        className="relative w-full max-w-2xl max-h-[90dvh] bg-[#071319] border border-teal-500/30 rounded-2xl p-4.5 sm:p-8 overflow-y-auto text-left shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-950 border border-teal-500/30 flex items-center justify-center text-teal-400 shrink-0">
              <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h3 id="privacy-modal-title" className="text-base sm:text-lg font-bold text-white">
                Zoya Privacy Policy
              </h3>
              <p className="text-xs text-slate-400">Effective Date: October 2026</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-teal-400"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-4 sm:mt-5 space-y-4 sm:space-y-5 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <div>
            <h4 className="font-bold text-white text-sm mb-1.5 flex items-center gap-2">
              <Lock className="w-4 h-4 text-teal-400 shrink-0" aria-hidden="true" />
              1. Voice and Microphone Data
            </h4>
            <p>
              Zoya requests Android microphone permission solely to capture your spoken voice commands when you activate the assistant. Audio captures are converted to text to fulfill your requests. Voice recordings are not sold to third-party brokers or used for targeted commercial profiling.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-white text-sm mb-1.5 flex items-center gap-2">
              <Server className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
              2. Local Memory and Preferences
            </h4>
            <p>
              Your assistant settings (such as voice speed, response preferences, and custom saved notes) are kept locally inside your Android device&apos;s isolated application storage. You can clear your session history and local memory at any time via Zoya&apos;s Assistant Settings.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-white text-sm mb-1.5 flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
              3. Device Permissions
            </h4>
            <p>
              Zoya operates with minimal permissions. The application does not request access to your contacts, SMS messages, call logs, camera, or personal photo galleries.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-white text-sm mb-1.5">
              4. Questions and Inquiries
            </h4>
            <p>
              If you have any questions regarding privacy practices or data handling, you may contact the creator directly at{' '}
              <a
                href="mailto:riyajulansari113b@gmail.com"
                className="text-teal-400 hover:underline font-medium"
              >
                riyajulansari113b@gmail.com
              </a>.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold text-slate-900 bg-teal-400 hover:bg-teal-300 transition-colors cursor-pointer focus-visible:outline-teal-400"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
};
