import React, { useState, useEffect } from 'react';
import { X, Mail, Copy, Check, MessageSquare } from 'lucide-react';

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ContactModal: React.FC<ContactModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  const email = 'riyajulansari113b@gmail.com';

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

  const handleCopy = () => {
    navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4 bg-zinc-900/35 backdrop-blur-xs animate-overlay-fade"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-modal-title"
    >
      <div
        className="relative w-full max-w-md max-h-[90dvh] bg-white/95 backdrop-blur-xl border border-pink-200 rounded-3xl p-5 sm:p-7 text-left shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-pink-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-pink-50 border border-pink-200 flex items-center justify-center text-pink-600 shrink-0">
              <Mail className="w-4 h-4" aria-hidden="true" />
            </div>
            <h3 id="contact-modal-title" className="text-base sm:text-lg font-bold text-zinc-900">
              Contact Creator
            </h3>
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
        <div className="mt-4 text-xs sm:text-sm text-zinc-600 leading-relaxed">
          <p>
            Have feedback, bug reports, or feature suggestions for Zoya AI Assistant? You can get in touch directly with the creator, <strong className="text-zinc-900">Riyajul</strong>.
          </p>

          <div className="mt-4 p-3.5 rounded-2xl bg-pink-50/50 border border-pink-200/80 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-zinc-500">
                Direct Email
              </div>
              <div className="text-xs sm:text-sm font-mono text-zinc-900 truncate">
                {email}
              </div>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white hover:bg-pink-50 border border-pink-200 text-zinc-700 hover:text-pink-600 transition-colors shrink-0 focus-visible:outline-pink-600 cursor-pointer"
              title="Copy Email Address"
              aria-label="Copy Email Address to Clipboard"
            >
              {copied ? (
                <Check className="w-4 h-4 text-pink-600" aria-hidden="true" />
              ) : (
                <Copy className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>

          <div className="mt-5 flex gap-2">
            <a
              href={`mailto:${email}?subject=Zoya%20AI%20Assistant%20Feedback`}
              className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-500 hover:to-rose-500 transition-all text-center focus-visible:outline-pink-600"
            >
              <MessageSquare className="w-4 h-4" aria-hidden="true" />
              <span>Send Direct Email</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
