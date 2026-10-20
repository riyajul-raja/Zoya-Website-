import React from 'react';
import { AiOrb } from './AiOrb';
import { Download, Compass, Smartphone, ShieldCheck } from 'lucide-react';
import { ReleaseMetadata } from '../../server/storage';

interface HeroProps {
  latestRelease: ReleaseMetadata | null;
  onDownloadClick: () => void;
  onExploreFeaturesClick: () => void;
}

export const Hero: React.FC<HeroProps> = ({
  latestRelease,
  onDownloadClick,
  onExploreFeaturesClick,
}) => {
  const isAvailable = Boolean(latestRelease && latestRelease.isPublished && latestRelease.downloadUrl);

  return (
    <section id="hero" className="relative pt-20 pb-14 sm:pt-28 md:pt-36 md:pb-24 overflow-hidden">
      {/* Background ambient lighting */}
      <div 
        aria-hidden="true"
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-full max-w-5xl h-96 bg-radial-glow pointer-events-none -z-10" 
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left Column: Value proposition and CTAs (col-span-7) */}
          <div className="lg:col-span-7 flex flex-col items-start text-left">
            {/* Technical Scope & Status Metadata */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 text-xs sm:text-sm font-medium mb-3 sm:mb-4 tracking-wide">
              <span className="text-teal-400">Android Application</span>
              <span aria-hidden="true" className="text-slate-600 select-none">·</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-500/10 border border-teal-500/30 text-teal-300 shadow-[0_0_12px_rgba(20,184,166,0.12)]">
                <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-teal-400" />
                </span>
                <span>Actively Evolving</span>
              </span>
            </div>

            {/* Main Headline */}
            <h1 className="text-2xl xs:text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-white text-balance leading-[1.18] sm:leading-[1.15]">
              Meet Zoya —{' '}
              <span className="bg-gradient-to-r from-teal-300 via-teal-400 to-cyan-300 bg-clip-text text-transparent">
                Your AI Voice Assistant
              </span>
            </h1>

            {/* Supporting Text */}
            <p className="mt-3.5 sm:mt-5 text-sm sm:text-base lg:text-lg text-slate-300 max-w-2xl leading-relaxed text-pretty">
              A smarter way to interact with AI through voice and conversation.
            </p>

            {/* Action buttons with minimum 44px touch targets */}
            <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={onDownloadClick}
                className="inline-flex items-center justify-center gap-2.5 px-5 sm:px-6 py-3.5 min-h-[48px] rounded-xl font-semibold text-slate-950 bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 transition-all shadow-[0_0_20px_rgba(45,212,191,0.25)] hover:shadow-[0_0_30px_rgba(45,212,191,0.45)] active:scale-98 cursor-pointer text-sm sm:text-base focus-visible:outline-teal-400"
              >
                <Download className="w-5 h-5 text-slate-950 shrink-0" aria-hidden="true" />
                <span>Download for Android</span>
              </button>

              <button
                type="button"
                onClick={onExploreFeaturesClick}
                className="inline-flex items-center justify-center gap-2 px-5 sm:px-6 py-3.5 min-h-[48px] rounded-xl font-semibold text-slate-200 bg-slate-900/80 hover:bg-slate-800/90 border border-slate-700/60 hover:border-teal-500/40 transition-all active:scale-98 cursor-pointer text-sm sm:text-base focus-visible:outline-teal-400"
              >
                <Compass className="w-5 h-5 text-teal-400 shrink-0" aria-hidden="true" />
                <span>Explore Features</span>
              </button>
            </div>

            {/* Verified device specifications strip */}
            <div className="mt-7 sm:mt-10 pt-4 sm:pt-6 border-t border-slate-800/70 w-full flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-y-2 gap-x-6 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-teal-400 shrink-0" aria-hidden="true" />
                <span>
                  Format: Standalone Android APK {isAvailable && latestRelease?.fileSizeFormatted ? `(${latestRelease.fileSizeFormatted})` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
                <span>Direct installation · No Play Store account required</span>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive AI Orb Visual (col-span-5) */}
          <div className="lg:col-span-5 flex justify-center items-center mt-4 lg:mt-0">
            <div className="relative w-full max-w-sm sm:max-w-md flex flex-col items-center">
              <AiOrb />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
