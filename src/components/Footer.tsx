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

  const isAvailable = Boolean(
    latestRelease &&
    latestRelease.isPublished &&
    latestRelease.downloadUrl &&
    latestRelease.binaryVerified !== false
  );

  return (
    <footer
      aria-label="Website Footer"
      className="mt-12 border-t border-pink-200/75 bg-white/80 backdrop-blur-xl py-12 sm:py-16 text-zinc-600 shadow-[0_-8px_30px_rgba(219,39,119,0.03)]"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-8 sm:gap-10 pb-10 border-b border-pink-100/90">
          {/* Brand & Mission column */}
          <div className="sm:col-span-2 lg:col-span-6 flex flex-col items-start text-left">
            <ZoyaBrandLink
              size="md"
              href="#hero"
              onAdminTrigger={onOpenAdmin}
              onNormalClick={() => handleScrollTo('#hero')}
            />
            <p className="mt-4 text-xs sm:text-sm text-zinc-600 max-w-md leading-relaxed">
              Zoya is an independent conversational AI voice assistant engineered for Android smartphones and tablets, focused on direct voice interaction and user privacy.
            </p>
            <div className="mt-4 inline-flex flex-wrap items-center gap-2 text-xs text-pink-700 font-mono tabular-nums bg-pink-50/70 border border-pink-200/70 px-3 py-1.5 rounded-xl">
              <span className="w-1.5 h-1.5 rounded-full bg-pink-500 shrink-0" aria-hidden="true" />
              <span>
                {isAvailable
                  ? `Release ${latestRelease?.versionName} (${latestRelease?.fileSizeFormatted})`
                  : 'Active Development'}{' '}
                · Standalone Android APK
              </span>
            </div>
          </div>

          {/* Quick Navigation Links */}
          <div className="lg:col-span-3 text-left">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-900 mb-3.5">
              Navigation
            </h4>
            <ul className="space-y-1.5 text-xs sm:text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => handleScrollTo('#hero')}
                  className="text-zinc-600 hover:text-pink-600 transition-colors duration-150 cursor-pointer text-left py-1.5 min-h-[40px] flex items-center focus-visible:outline-pink-600 rounded-sm"
                >
                  Home
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleScrollTo('#installation')}
                  className="text-zinc-600 hover:text-pink-600 transition-colors duration-150 cursor-pointer text-left py-1.5 min-h-[40px] flex items-center focus-visible:outline-pink-600 rounded-sm"
                >
                  Installation Guide
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleScrollTo('#download')}
                  className="text-zinc-600 hover:text-pink-600 transition-colors duration-150 cursor-pointer text-left py-1.5 min-h-[40px] flex items-center focus-visible:outline-pink-600 rounded-sm"
                >
                  Download APK
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleScrollTo('#features')}
                  className="text-zinc-600 hover:text-pink-600 transition-colors duration-150 cursor-pointer text-left py-1.5 min-h-[40px] flex items-center focus-visible:outline-pink-600 rounded-sm"
                >
                  Features
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleScrollTo('#faq')}
                  className="text-zinc-600 hover:text-pink-600 transition-colors duration-150 cursor-pointer text-left py-1.5 min-h-[40px] flex items-center focus-visible:outline-pink-600 rounded-sm"
                >
                  FAQ
                </button>
              </li>
            </ul>
          </div>

          {/* Legal & Inquiries */}
          <div className="lg:col-span-3 text-left">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-900 mb-3.5">
              Information &amp; Support
            </h4>
            <ul className="space-y-1.5 text-xs sm:text-sm">
              <li>
                <button
                  type="button"
                  onClick={onOpenPrivacy}
                  className="text-zinc-600 hover:text-pink-600 transition-colors duration-150 cursor-pointer text-left py-1.5 min-h-[40px] flex items-center focus-visible:outline-pink-600 rounded-sm"
                >
                  Privacy Policy
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={onOpenContact}
                  className="text-zinc-600 hover:text-pink-600 transition-colors duration-150 cursor-pointer text-left py-1.5 min-h-[40px] flex items-center focus-visible:outline-pink-600 rounded-sm"
                >
                  Contact Creator
                </button>
              </li>
              <li>
                <a
                  href="mailto:riyajulansari113b@gmail.com?subject=Zoya%20Feedback"
                  className="text-zinc-600 hover:text-pink-600 transition-colors duration-150 py-1.5 min-h-[40px] flex items-center focus-visible:outline-pink-600 rounded-sm"
                >
                  Report an Issue
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Credits & Copyright */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5 text-center sm:text-left">
            <span className="font-medium text-zinc-600">Official Zoya AI Assistant Website</span>
            <span aria-hidden="true" className="text-pink-300">·</span>
            <span>
              Created by <strong className="text-zinc-800 font-semibold">Riyajul</strong>
            </span>
          </div>

          <div className="flex items-center gap-1 text-zinc-500 text-center tabular-nums">
            <span>&copy; {new Date().getFullYear()} Zoya AI Assistant. All rights reserved.</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
