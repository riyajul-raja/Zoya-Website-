import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, useScroll, useSpring, useReducedMotion } from 'motion/react';
import { ZoyaBrandLink } from './ZoyaBrandLink';
import { MagneticWrapper } from './LivingBackground';
import { Menu, X, ChevronRight } from 'lucide-react';

interface NavbarProps {
  onOpenAdmin: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenAdmin }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('#hero');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 30,
    restDelta: 0.001,
  });

  const navLinks = [
    { label: 'Installation', href: '#installation' },
    { label: 'Download', href: '#download' },
    { label: 'FAQ', href: '#faq' },
  ];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let rafId: number | null = null;

    const updateScrollState = () => {
      const scrollY = window.scrollY;
      setIsScrolled(scrollY > 12);

      const viewportOffset = scrollY + 160;
      const sections = ['#hero', '#installation', '#download', '#faq'];
      let current = '#hero';

      for (const selector of sections) {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (el && viewportOffset >= el.offsetTop) {
          current = selector;
        }
      }

      setActiveSection((prev) => (prev === current ? prev : current));
      rafId = null;
    };

    const handleScroll = () => {
      if (rafId === null) {
        rafId = window.requestAnimationFrame(updateScrollState);
      }
    };

    updateScrollState();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
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

  const handleLinkClick = (href: string) => {
    setActiveSection(href);
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
          ? 'bg-white/78 backdrop-blur-xl border-b border-pink-200/75 shadow-[0_8px_30px_rgba(219,39,119,0.06)]'
          : 'bg-white/55 backdrop-blur-md border-b border-pink-100/80'
      }`}
    >
      {/* Subtle Top Scroll Progress Indicator */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 right-0 h-[2.5px] bg-pink-100/40 overflow-hidden"
      >
        <motion.div
          className="h-full w-full origin-left bg-gradient-to-r from-pink-500 via-rose-500 to-pink-600"
          style={{
            scaleX: shouldReduceMotion ? scrollYProgress : smoothProgress,
          }}
        />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-6 h-16">
          {/* Brand Wordmark with hidden 2-second press-and-hold admin entry point */}
          <ZoyaBrandLink
            size="md"
            href="#hero"
            onAdminTrigger={onOpenAdmin}
            onNormalClick={() => handleLinkClick('#hero')}
          />

          {/* Desktop Navigation links */}
          <nav
            className="hidden md:flex items-center gap-2 text-sm font-medium text-zinc-600"
            aria-label="Main Navigation"
          >
            {navLinks.map((link) => {
              const isActive = activeSection === link.href;
              return (
                <MagneticWrapper key={link.label} strength={0.18}>
                  <a
                    href={link.href}
                    aria-current={isActive ? 'location' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      handleLinkClick(link.href);
                    }}
                    className={`relative inline-flex items-center px-3.5 py-2 rounded-xl transition-colors duration-200 whitespace-nowrap shrink-0 focus-visible:outline-pink-600 ${
                      isActive
                        ? 'text-pink-600 font-semibold bg-pink-50/70'
                        : 'text-zinc-600 hover:text-pink-600 hover:bg-pink-50/40'
                    }`}
                  >
                    <span>{link.label}</span>
                    {isActive && (
                      <motion.span
                        layoutId={shouldReduceMotion ? undefined : 'navbar-active-indicator'}
                        className="pointer-events-none absolute bottom-1 left-3.5 right-3.5 h-0.5 rounded-full bg-gradient-to-r from-pink-500 to-rose-500"
                        transition={{
                          type: 'spring',
                          stiffness: 380,
                          damping: 32,
                        }}
                      />
                    )}
                  </a>
                </MagneticWrapper>
              );
            })}
          </nav>

          {/* Mobile Hamburger Menu Button (no duplicate Download button on the left) */}
          <div className="flex md:hidden items-center shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-700 hover:text-pink-600 bg-white/80 hover:bg-pink-50/80 border border-pink-200/80 focus-visible:outline-pink-600 transition-colors duration-150 cursor-pointer"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav-drawer"
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5 text-zinc-800" aria-hidden="true" />
              ) : (
                <Menu className="w-5 h-5 text-zinc-800" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mounted &&
        mobileMenuOpen &&
        createPortal(
          <div
            id="mobile-nav-drawer"
            className="md:hidden fixed inset-0 z-[100] flex justify-end"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile Navigation Menu"
          >
            {/* Soft Frosted Backdrop Overlay */}
            <div
              className="fixed inset-0 bg-zinc-900/25 backdrop-blur-xs animate-overlay-fade"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />

            {/* Frosted Pink-Glass Drawer Panel */}
            <div
              ref={menuRef}
              className="relative z-10 w-full max-w-[290px] h-full bg-white/95 backdrop-blur-xl border-l border-pink-200/80 shadow-2xl flex flex-col justify-between overflow-y-auto animate-drawer-slide"
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-pink-100">
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
                  className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-zinc-600 hover:text-pink-600 hover:bg-pink-50 border border-pink-200/70 focus-visible:outline-pink-600 transition-colors cursor-pointer"
                  aria-label="Close navigation menu"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>

              {/* Drawer Navigation Links */}
              <nav className="flex-1 px-4 py-5 space-y-1 overflow-y-auto">
                <a
                  href="#hero"
                  aria-current={activeSection === '#hero' ? 'location' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    handleLinkClick('#hero');
                  }}
                  className={`flex items-center justify-between px-4 py-3.5 min-h-[48px] rounded-xl text-base font-medium transition-colors ${
                    activeSection === '#hero'
                      ? 'bg-pink-50/90 text-pink-600 font-semibold'
                      : 'text-zinc-800 hover:bg-pink-50/90 hover:text-pink-600'
                  }`}
                >
                  <span>Home</span>
                  <ChevronRight className="w-4 h-4 text-pink-400" aria-hidden="true" />
                </a>
                {navLinks.map((link) => {
                  const isActive = activeSection === link.href;
                  return (
                    <a
                      key={link.label}
                      href={link.href}
                      aria-current={isActive ? 'location' : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        handleLinkClick(link.href);
                      }}
                      className={`flex items-center justify-between px-4 py-3.5 min-h-[48px] rounded-xl text-base font-medium transition-colors ${
                        isActive
                          ? 'bg-pink-50/90 text-pink-600 font-semibold'
                          : 'text-zinc-800 hover:bg-pink-50/90 hover:text-pink-600'
                      }`}
                    >
                      <span>{link.label}</span>
                      <ChevronRight className="w-4 h-4 text-pink-400" aria-hidden="true" />
                    </a>
                  );
                })}
              </nav>

              {/* Quiet Drawer Footer */}
              <div className="p-5 border-t border-pink-100 bg-pink-50/40">
                <p className="text-xs text-zinc-500 text-center">
                  Zoya AI Assistant · Official Android Portal
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}
    </header>
  );
};
