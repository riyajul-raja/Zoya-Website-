import React from 'react';
import { ZoyaBrandLink } from './ZoyaBrandLink';
import { ReleaseMetadata } from '../../server/storage';

interface FooterProps {
  latestRelease: ReleaseMetadata | null;
  onOpenPrivacy: () => void;
  onOpenContact: () => void;
  onOpenAdmin: () => void;
}

export const Footer: React.FC<FooterProps> = ({
  latestRelease,
  onOpenPrivacy,
  onOpenContact,
  onOpenAdmin,
}) => {
  const handleScrollTo = (id: string) => {
    const el = document.querySelector(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const isAvailable = Boolean(latestRelease && latestRelease.isPublished && latestRelease.downloadUrl);

  return (
    <footer aria-label="Website Footer" className="border-t border-teal-950/60 bg-[#03060a] py-12 sm:py-16 text-slate-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 sm:gap-10 pb-8 sm:pb-10 border-b border-slate-900">
          {/* Brand & Mission column (col-span-5) */}
          <div className="md:col-span-5 flex flex-col items-start text-left">
            <ZoyaBrandLink
              size="md"
              href="#hero"
              onAdminTrigger={onOpenAdmin}
              onNormalClick={() => handleScrollTo('#hero')}
            />
            <p className="mt-4 text-xs sm:text-sm text-slate-400 max-w-sm leading-relaxed">
              Zoya is an independent conversational AI voice assistant engineered for Android smartphones and tablets, focused on direct voice interaction and user privacy.
            </p>
            <div className="mt-4 text-xs text-teal-400/90 font-mono">
              {isAvailable ? `Release ${latestRelease?.versionName} (${latestRelease?.fileSizeFormatted})` : 'Actively Evolving'} · Standalone Android APK
            </div>
          </div>

          {/* Quick Navigation Links (col-span-4) */}
          <div className="md:col-span-4 text-left">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">
              Navigation
            </h4>
            <ul className="space-y-1 text-xs sm:text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => handleScrollTo('#hero')}
                  className="hover:text-teal-300 transition-colors cursor-pointer text-left py-2 min-h-[44px] flex items-center focus-visible:outline-teal-400 rounded-sm"
                >
                  Home
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleScrollTo('#features')}
                  className="hover:text-teal-300 transition-colors cursor-pointer text-left py-2 min-h-[44px] flex items-center focus-visible:outline-teal-400 rounded-sm"
                >
                  Features
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleScrollTo('#about')}
                  className="hover:text-teal-300 transition-colors cursor-pointer text-left py-2 min-h-[44px] flex items-center focus-visible:outline-teal-400 rounded-sm"
                >
                  About Zoya
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleScrollTo('#download')}
                  className="hover:text-teal-300 transition-colors cursor-pointer text-left py-2 min-h-[44px] flex items-center focus-visible:outline-teal-400 rounded-sm"
                >
                  Download APK
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleScrollTo('#installation')}
                  className="hover:text-teal-300 transition-colors cursor-pointer text-left py-2 min-h-[44px] flex items-center focus-visible:outline-teal-400 rounded-sm"
                >
                  Installation Guide
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleScrollTo('#faq')}
                  className="hover:text-teal-300 transition-colors cursor-pointer text-left py-2 min-h-[44px] flex items-center focus-visible:outline-teal-400 rounded-sm"
                >
                  FAQ
                </button>
              </li>
            </ul>
          </div>

          {/* Legal & Inquiries (col-span-3) */}
          <div className="md:col-span-3 text-left">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">
              Information &amp; Support
            </h4>
            <ul className="space-y-1 text-xs sm:text-sm">
              <li>
                <button
                  type="button"
                  onClick={onOpenPrivacy}
                  className="hover:text-teal-300 transition-colors cursor-pointer text-left py-2 min-h-[44px] flex items-center focus-visible:outline-teal-400 rounded-sm"
                >
                  Privacy Policy
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={onOpenContact}
                  className="hover:text-teal-300 transition-colors cursor-pointer text-left py-2 min-h-[44px] flex items-center focus-visible:outline-teal-400 rounded-sm"
                >
                  Contact Creator
                </button>
              </li>
              <li>
                <a
                  href="mailto:riyajulansari113b@gmail.com?subject=Zoya%20Feedback"
                  className="hover:text-teal-300 transition-colors py-2 min-h-[44px] flex items-center focus-visible:outline-teal-400 rounded-sm"
                >
                  Report an Issue
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Credits & Copyright */}
        <div className="pt-6 sm:pt-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5 text-center sm:text-left">
            <span>Official Zoya AI Assistant Website</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span>Created by <strong className="text-slate-300 font-semibold">Riyajul</strong></span>
          </div>

          <div className="flex items-center gap-1 text-slate-500 text-center">
            <span>&copy; {new Date().getFullYear()} Zoya AI Assistant. All rights reserved.</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
