import React from 'react';
import { ArrowDown, Sparkles } from 'lucide-react';
import { ZoyaLogo } from './ZoyaLogo';
import { ReleaseMetadata } from '../../server/storage';

interface HeroProps {
  latestRelease: ReleaseMetadata | null;
  onExploreDownloads?: () => void;
  onExploreFeatures?: () => void;
  onDownloadClick?: () => void;
}

export const Hero: React.FC<HeroProps> = ({
  latestRelease,
  onExploreDownloads,
  onExploreFeatures,
  onDownloadClick,
}) => {
  const isAvailable = Boolean(
    latestRelease &&
    latestRelease.isPublished &&
    latestRelease.downloadUrl &&
    latestRelease.binaryVerified !== false
  );

  const handleScrollToDownloads = () => {
    if (onExploreDownloads) {
      onExploreDownloads();
    } else if (onDownloadClick) {
      onDownloadClick();
    } else {
      const el = document.getElementById('download') || document.querySelector('#download');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  const handleScrollToFeatures = () => {
    if (onExploreFeatures) {
      onExploreFeatures();
    } else {
      const el = document.getElementById('features') || document.querySelector('#features');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  return (
    <section
      id="hero"
      aria-label="Zoya AI Assistant Overview"
      className="relative pt-20 pb-10 sm:pt-32 sm:pb-16 lg:pt-36 lg:pb-20"
    >
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="glass-panel rounded-2xl sm:rounded-3xl px-4 py-8 sm:px-10 sm:py-14 md:py-18 text-center flex flex-col items-center">
          {/* Original single Zoya Emblem */}
          <div className="flex flex-col items-center gap-2.5 sm:gap-3 mb-4 sm:mb-6">
            <ZoyaLogo size="lg" showText={false} />
            <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-semibold tracking-wide text-zinc-500 tabular-nums">
              <span className="text-pink-600">Zoya AI Assistant</span>
              <span aria-hidden="true" className="text-pink-300">·</span>
              <span className="text-zinc-600">Android Edition</span>
            </div>
          </div>

          {/* Exact Headline */}
          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-zinc-900 leading-tight sm:leading-tight max-w-2xl text-balance">
            Meet Zoya — Your AI Voice Assistant
          </h1>

          {/* Exact Description */}
          <p className="mt-3.5 sm:mt-5 text-sm sm:text-base lg:text-lg text-zinc-600 max-w-xl leading-relaxed text-balance">
            Talk to Zoya naturally using your voice. Get answers to your questions, enjoy hands-free conversations, and personalize your assistant to suit your needs—all in one lightweight Android app.
          </p>

          {/* Action Navigation Buttons */}
          <div className="mt-6 sm:mt-8 w-full max-w-lg flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={handleScrollToDownloads}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[48px] rounded-xl font-semibold text-white bg-pink-600 hover:bg-pink-700 active:bg-pink-800 transition-colors duration-150 shadow-sm cursor-pointer text-sm sm:text-base whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600"
            >
              <ArrowDown className="w-4 h-4 text-white shrink-0" aria-hidden="true" />
              <span>Explore Downloads</span>
            </button>

            <button
              type="button"
              onClick={handleScrollToFeatures}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[48px] rounded-xl font-semibold text-pink-700 bg-pink-50 hover:bg-pink-100/90 active:bg-pink-200/80 border border-pink-200/80 transition-colors duration-150 shadow-xs cursor-pointer text-sm sm:text-base whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600"
            >
              <Sparkles className="w-4 h-4 text-pink-600 shrink-0" aria-hidden="true" />
              <span>Explore Features</span>
            </button>
          </div>

          {/* Quiet Release Compatibility Metadata */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-zinc-500 tabular-nums">
            <span className="font-medium text-zinc-700">{latestRelease?.minAndroidVersion || 'Android 8.0+'}</span>
            <span aria-hidden="true" className="text-pink-300">·</span>
            <span>
              {isAvailable && latestRelease?.versionName
                ? `v${latestRelease.versionName} Available`
                : 'Standalone Android APK'}
            </span>
            <span aria-hidden="true" className="text-pink-300">·</span>
            <span>Direct Installation</span>
          </div>
        </div>
      </div>
    </section>
  );
};
