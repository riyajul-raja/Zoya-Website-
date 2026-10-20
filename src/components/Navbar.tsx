import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ZoyaBrandLink } from './ZoyaBrandLink';
import { Menu, X, Download, Clock, ChevronRight } from 'lucide-react';
import { ReleaseMetadata } from '../../server/storage';

interface NavbarProps {
  latestRelease: ReleaseMetadata | null;
  onDownloadClick: () => void;
  onOpenAdmin: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  latestRelease,
  onDownloadClick,
  onOpenAdmin,
}) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isAvailable = Boolean(latestRelease && latestRelease.isPublished && latestRelease.downloadUrl);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 16);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };

    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileMenuOpen]);

  const navLinks = [
    { label: 'Home', href: '#hero' },
    { label: 'Features', href: '#features' },
    { label: 'About', href: '#about' },
    { label: 'Download', href: '#download' },
    { label: 'Installation', href: '#installation' },
    { label: 'FAQ', href: '#faq' },
  ];

  const handleLinkClick = (href: string) => {
    setMobileMenuOpen(false);
    setTimeout(() => {
      const element = document.querySelector(href);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }, 60);
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? 'bg-[#050a0e]/95 backdrop-blur-md border-b border-teal-950/70 shadow-lg shadow-black/50'
          : 'bg-[#050a0e]/60 backdrop-blur-xs border-b border-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3 sm:gap-8 h-16 sm:h-18">
          {/* Zone 1: Brand Wordmark with hidden 2-second press-and-hold admin entry point */}
          <ZoyaBrandLink
            size="md"
            href="#hero"
            onAdminTrigger={onOpenAdmin}
            onNormalClick={() => handleLinkClick('#hero')}
          />

          {/* Zone 2: Desktop / Laptop Navigation links */}
          <nav 
            className="hidden lg:flex items-center gap-6 xl:gap-8 text-sm font-medium text-slate-300"
            aria-label="Main Navigation"
          >
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={(e) => {
                  e.preventDefault();
                  handleLinkClick(link.href);
                }}
                className="hover:text-teal-300 transition-colors whitespace-nowrap shrink-0 py-2 focus-visible:outline-teal-400 rounded-sm"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Zone 3: Primary action button + Mobile menu toggle (Zero admin buttons visible) */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {isAvailable && latestRelease ? (
              <a
                href={latestRelease.downloadUrl}
                download={`zoya-assistant-${latestRelease.versionName || 'latest'}.apk`}
                className="inline-flex items-center justify-center gap-2 px-3.5 sm:px-4 py-2 min-h-[44px] text-xs sm:text-sm font-semibold text-slate-950 bg-gradient-to-r from-teal-400 to-cyan-400 rounded-xl hover:from-teal-300 hover:to-cyan-300 transition-all shadow-[0_0_15px_rgba(45,212,191,0.25)] hover:shadow-[0_0_20px_rgba(45,212,191,0.4)] active:scale-95 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-teal-400"
              >
                <Download className="w-4 h-4 text-slate-950 shrink-0" aria-hidden="true" />
                <span className="hidden xs:inline">Download APK</span>
                <span className="xs:hidden">Download</span>
              </a>
            ) : (
              <button
                type="button"
                onClick={onDownloadClick}
                className="inline-flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 min-h-[44px] text-xs sm:text-sm font-semibold text-teal-300 bg-slate-900/90 border border-teal-500/30 rounded-xl hover:bg-slate-800/90 transition-all active:scale-95 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-teal-400"
                title="APK release is in active development. Tap to view release status."
              >
                <Clock className="w-3.5 h-3.5 text-teal-400 shrink-0" aria-hidden="true" />
                <span className="hidden xs:inline">Coming Soon</span>
                <span className="xs:hidden">Status</span>
              </button>
            )}

            {/* Mobile menu hamburger button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/80 border border-slate-800 focus-visible:outline-teal-400 transition-colors"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav-drawer"
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5 text-white" aria-hidden="true" />
              ) : (
                <Menu className="w-5 h-5 text-slate-200" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Menu - Rendered via Portal at document.body to prevent containing-block clipping */}
      {mounted && mobileMenuOpen && createPortal(
        <div 
          id="mobile-nav-drawer"
          className="lg:hidden fixed inset-0 z-[100] flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Navigation Menu"
        >
          {/* Backdrop Overlay: Tap outside to close */}
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm animate-overlay-fade transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Panel: Positioned cleanly, no clipping, high z-index */}
          <div 
            ref={menuRef}
            className="relative z-10 w-full max-w-[300px] sm:max-w-xs h-full bg-[#050e14] border-l border-teal-500/30 shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col justify-between overflow-y-auto animate-drawer-slide"
          >
            {/* Header row inside drawer with Logo and visible close button */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-teal-950/80 bg-[#04090d]">
              <ZoyaBrandLink
                size="sm"
                href="#hero"
                onAdminTrigger={() => {
                  setMobileMenuOpen(false);
                  onOpenAdmin();
                }}
                onNormalClick={() => handleLinkClick('#hero')}
              />

              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-slate-800/80 border border-slate-800 focus-visible:outline-teal-400 transition-colors"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5 text-slate-200" aria-hidden="true" />
              </button>
            </div>

            {/* Navigation links */}
            <nav className="flex-1 px-4 py-5 space-y-1.5 overflow-y-auto">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={(e) => {
                    e.preventDefault();
                    handleLinkClick(link.href);
                  }}
                  className="flex items-center justify-between px-4 py-3.5 min-h-[48px] rounded-xl text-base font-medium text-slate-200 hover:bg-teal-950/50 hover:text-teal-300 active:bg-teal-900/40 transition-colors border border-transparent hover:border-teal-500/20"
                >
                  <span>{link.label}</span>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-teal-400" aria-hidden="true" />
                </a>
              ))}
            </nav>

            {/* Drawer Footer with APK download/status button */}
            <div className="p-4 sm:p-5 border-t border-teal-950/80 bg-[#03070a] space-y-3">
              {isAvailable && latestRelease ? (
                <a
                  href={latestRelease.downloadUrl}
                  download={`zoya-assistant-${latestRelease.versionName || 'latest'}.apk`}
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full flex items-center justify-center gap-2 py-3.5 px-4 min-h-[48px] rounded-xl text-sm sm:text-base font-bold text-slate-950 bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 shadow-[0_0_20px_rgba(45,212,191,0.25)] text-center transition-all cursor-pointer"
                >
                  <Download className="w-5 h-5 text-slate-950" aria-hidden="true" />
                  <span>Download APK {latestRelease.versionName ? `(${latestRelease.versionName})` : ''}</span>
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onDownloadClick();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 min-h-[48px] rounded-xl text-xs sm:text-sm font-semibold text-teal-300 bg-slate-900/90 border border-teal-500/30 hover:bg-slate-800 transition-all text-center cursor-pointer"
                >
                  <Clock className="w-4 h-4 text-teal-400" aria-hidden="true" />
                  <span>APK Release Status — Coming Soon</span>
                </button>
              )}

              <p className="text-[11px] text-slate-500 text-center">
                Official release channel · Android {latestRelease?.minAndroidVersion || '8.0+'}
              </p>
            </div>
          </div>
        </div>,
        document.body
      )}
    </header>
  );
};
