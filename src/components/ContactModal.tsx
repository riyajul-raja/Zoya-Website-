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
      className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-overlay-fade"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-modal-title"
    >
      <div
        className="relative w-full max-w-md max-h-[90dvh] bg-[#071319] border border-teal-500/30 rounded-2xl p-4.5 sm:p-7 text-left shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-teal-950 border border-teal-500/30 flex items-center justify-center text-teal-400 shrink-0">
              <Mail className="w-4 h-4" aria-hidden="true" />
            </div>
            <h3 id="contact-modal-title" className="text-base sm:text-lg font-bold text-white">
              Contact Creator
            </h3>
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
        <div className="mt-4 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <p>
            Have feedback, bug reports, or feature suggestions for Zoya AI Assistant? You can get in touch directly with the creator, <strong className="text-white">Riyajul</strong>.
          </p>

          <div className="mt-4 p-3.5 rounded-xl bg-[#040b0f] border border-teal-950 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                Direct Email
              </div>
              <div className="text-xs sm:text-sm font-mono text-teal-300 truncate">
                {email}
              </div>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0 focus-visible:outline-teal-400"
              title="Copy Email Address"
              aria-label="Copy Email Address to Clipboard"
            >
              {copied ? (
                <Check className="w-4 h-4 text-teal-400" aria-hidden="true" />
              ) : (
                <Copy className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>

          <div className="mt-5 flex gap-2">
            <a
              href={`mailto:${email}?subject=Zoya%20AI%20Assistant%20Feedback`}
              className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold text-slate-950 bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 transition-all text-center focus-visible:outline-teal-400"
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
