import React from 'react';
import { Download } from 'lucide-react';
import { ZoyaLogo } from './ZoyaLogo';
import { ReleaseMetadata } from '../../server/storage';

interface HeroProps {
  latestRelease: ReleaseMetadata | null;
  onDownloadClick: () => void;
}

export const Hero: React.FC<HeroProps> = ({
  latestRelease,
  onDownloadClick,
}) => {
  const isAvailable = Boolean(
    latestRelease &&
    latestRelease.isPublished &&
    latestRelease.downloadUrl &&
    latestRelease.binaryVerified !== false
  );

  return (
    <section
      id="hero"
      className="relative pt-24 pb-12 sm:pt-32 sm:pb-16 lg:pt-36 lg:pb-20"
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="glass-panel rounded-3xl px-6 py-12 sm:px-12 sm:py-16 md:py-20 text-center flex flex-col items-center">
          {/* Zoya Branding & Unboxed Kicker */}
          <div className="flex flex-col items-center gap-3 mb-6">
            <ZoyaLogo size="lg" showText={false} />
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs sm:text-sm font-medium text-zinc-500 tabular-nums">
              <span className="text-pink-600 font-semibold">Zoya AI Assistant</span>
              <span aria-hidden="true" className="text-pink-300">·</span>
              <span>Voice &amp; Conversational AI for Android</span>
            </div>
          </div>

          {/* Clear, Confident Headline */}
          <h1 className="text-3xl sm:text-5xl lg:text-[3.5rem] font-extrabold tracking-tight text-zinc-900 text-balance max-w-3xl leading-[1.14]">
            Natural voice assistance, crafted for your{' '}
            <span className="text-pink-600">Android</span> experience.
          </h1>

          {/* Concise Supporting Description */}
          <p className="mt-4 sm:mt-5 text-base sm:text-lg text-zinc-600 max-w-2xl leading-relaxed">
            Speak naturally, retain context across multi-turn conversations, and customize your assistant preferences in a clean, lightweight Android application.
          </p>

          {/* Single Prominent Download APK Button */}
          <div className="mt-8 sm:mt-10 w-full sm:w-auto flex flex-col items-center">
            {isAvailable && latestRelease ? (
              <a
                href={latestRelease.downloadUrl}
                download={`zoya-assistant-${latestRelease.versionName || 'latest'}.apk`}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-4 min-h-[52px] rounded-2xl font-semibold text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-500 hover:to-rose-500 transition-all duration-150 shadow-[0_8px_24px_rgba(219,39,119,0.24)] cursor-pointer text-base whitespace-nowrap shrink-0 focus-visible:outline-pink-600 tabular-nums"
              >
                <Download className="w-5 h-5 text-white shrink-0" aria-hidden="true" />
                <span>
                  Download APK {latestRelease.versionName ? `(${latestRelease.versionName})` : ''}
                </span>
              </a>
            ) : (
              <button
                type="button"
                onClick={onDownloadClick}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-4 min-h-[52px] rounded-2xl font-semibold text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-500 hover:to-rose-500 transition-all duration-150 shadow-[0_8px_24px_rgba(219,39,119,0.24)] cursor-pointer text-base whitespace-nowrap shrink-0 focus-visible:outline-pink-600"
              >
                <Download className="w-5 h-5 text-white shrink-0" aria-hidden="true" />
                <span>Download APK</span>
              </button>
            )}

            {/* Quiet Unboxed Release Metadata */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-xs sm:text-sm text-zinc-500 tabular-nums">
              <span>{latestRelease?.minAndroidVersion || 'Android 8.0+'}</span>
              <span aria-hidden="true" className="text-pink-300">·</span>
              <span>
                {isAvailable && latestRelease?.fileSizeFormatted
                  ? `${latestRelease.fileSizeFormatted} Standalone APK`
                  : 'Standalone Android APK'}
              </span>
              <span aria-hidden="true" className="text-pink-300">·</span>
              <span>Direct Installation</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
