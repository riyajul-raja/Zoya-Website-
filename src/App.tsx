/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { Features } from './components/Features';
import { About } from './components/About';
import { ApkDownload } from './components/ApkDownload';
import { InstallationGuide } from './components/InstallationGuide';
import { Faq } from './components/Faq';
import { Footer } from './components/Footer';
import { PrivacyModal } from './components/PrivacyModal';
import { ContactModal } from './components/ContactModal';
import { AdminPortalModal } from './components/admin/AdminPortalModal';
import { ReleaseMetadata } from '../server/storage';
import { DEFAULT_APK_CONFIG } from './config/apkConfig';

export default function App() {
  const [latestRelease, setLatestRelease] = useState<ReleaseMetadata | null>(null);
  const [loadingRelease, setLoadingRelease] = useState(true);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  // Fetch real latest published release from backend
  const fetchLatestRelease = useCallback(async () => {
    setLoadingRelease(true);
    try {
      const res = await fetch('/api/releases/latest');
      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        // Fallback
      }
      if (res.ok && data.published && data.release) {
        setLatestRelease(data.release);
      } else {
        setLatestRelease(null);
      }
    } catch (err) {
      console.warn('Could not query releases backend:', err);
      setLatestRelease(null);
    } finally {
      setLoadingRelease(false);
    }
  }, []);

  useEffect(() => {
    fetchLatestRelease();

    // Check if user navigated with #admin hash
    if (window.location.hash === '#admin') {
      setAdminOpen(true);
    }

    const handleHashChange = () => {
      if (window.location.hash === '#admin') {
        setAdminOpen(true);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [fetchLatestRelease]);

  const scrollToDownload = () => {
    const el = document.querySelector('#download');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const scrollToFeatures = () => {
    const el = document.querySelector('#features');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-pink-ambient text-zinc-900 flex flex-col font-sans selection:bg-pink-500/15 selection:text-pink-700 relative">
      {/* Top Navigation */}
      <Navbar onOpenAdmin={() => setAdminOpen(true)} />

      {/* Main Content Sections */}
      <main className="flex-1">
        {/* Hero Section */}
        <Hero
          latestRelease={latestRelease}
          onExploreDownloads={scrollToDownload}
          onExploreFeatures={scrollToFeatures}
          onDownloadClick={scrollToDownload}
        />

        {/* Section 1 — Core Capabilities */}
        <Features />

        {/* Section 2 — Simple Setup */}
        <InstallationGuide />

        {/* About Zoya Section */}
        <About />

        {/* Official Android Release / APK Download Area */}
        <ApkDownload
          latestRelease={latestRelease}
          loading={loadingRelease}
          onOpenAdmin={() => setAdminOpen(true)}
        />

        {/* Frequently Asked Questions */}
        <Faq apkConfig={DEFAULT_APK_CONFIG} />
      </main>

      {/* Footer with Creator Credit and Admin Link */}
      <Footer
        latestRelease={latestRelease}
        onOpenPrivacy={() => setPrivacyOpen(true)}
        onOpenContact={() => setContactOpen(true)}
        onOpenAdmin={() => setAdminOpen(true)}
      />

      {/* Modals for Privacy Policy & Direct Creator Contact */}
      <PrivacyModal isOpen={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      <ContactModal isOpen={contactOpen} onClose={() => setContactOpen(false)} />

      {/* Secure Admin APK Release Management Portal */}
      <AdminPortalModal
        isOpen={adminOpen}
        onClose={() => {
          setAdminOpen(false);
          if (window.location.hash === '#admin') {
            history.pushState('', document.title, window.location.pathname + window.location.search);
          }
        }}
        onReleaseChanged={() => {
          fetchLatestRelease();
        }}
      />
    </div>
  );
}
