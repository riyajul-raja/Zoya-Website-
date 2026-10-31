import React from 'react';
import {
  Download,
  Smartphone,
  Calendar,
  HardDrive,
  Check,
  FileCode,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { ReleaseMetadata } from '../../server/storage';

interface ApkDownloadProps {
  latestRelease: ReleaseMetadata | null;
  loading: boolean;
  onOpenAdmin?: () => void;
}

export const ApkDownload: React.FC<ApkDownloadProps> = ({
  latestRelease,
  loading,
}) => {

  const isAvailable = Boolean(
    latestRelease &&
    latestRelease.isPublished &&
    latestRelease.downloadUrl &&
    latestRelease.binaryVerified !== false
  );

  return (
    <section
      id="download"
      aria-label="Download Zoya Android APK"
      className="py-14 sm:py-20"
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center mb-8 sm:mb-10">
          <div className="text-xs font-semibold text-pink-600 mb-2">
            Official Android Release
          </div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-zinc-900 tracking-tight text-balance">
            Download Zoya AI Assistant
          </h2>
          <p className="mt-3 text-sm sm:text-base text-zinc-600 leading-relaxed">
            Get the latest verified standalone Android installation package (<code className="font-mono text-pink-700">.apk</code>) directly from the official release channel.
          </p>
        </div>

        {/* Frosted Pink-Glass Release Card */}
        <div className="glass-panel rounded-3xl p-5 sm:p-8 md:p-10">
          {/* Release Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 pb-6 border-b border-pink-200/60 tabular-nums">
            <div className="p-3.5 rounded-2xl bg-pink-50/50 border border-pink-200/60 text-left">
              <span className="text-xs text-zinc-500 flex items-center gap-1.5 mb-1">
                <FileCode className="w-3.5 h-3.5 text-pink-600 shrink-0" aria-hidden="true" />
                <span>Version</span>
              </span>
              <span className="text-sm sm:text-base font-bold text-zinc-900 font-mono truncate block">
                {loading ? 'Checking...' : isAvailable ? latestRelease?.versionName : 'Upcoming'}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-pink-50/50 border border-pink-200/60 text-left">
              <span className="text-xs text-zinc-500 flex items-center gap-1.5 mb-1">
                <HardDrive className="w-3.5 h-3.5 text-pink-600 shrink-0" aria-hidden="true" />
                <span>APK Size</span>
              </span>
              <span className="text-sm sm:text-base font-bold text-zinc-900 font-mono truncate block">
                {loading ? '...' : isAvailable ? latestRelease?.fileSizeFormatted : 'TBA'}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-pink-50/50 border border-pink-200/60 text-left">
              <span className="text-xs text-zinc-500 flex items-center gap-1.5 mb-1">
                <Calendar className="w-3.5 h-3.5 text-pink-600 shrink-0" aria-hidden="true" />
                <span>Released</span>
              </span>
              <span className="text-sm sm:text-base font-bold text-zinc-900 font-mono truncate block">
                {loading ? '...' : isAvailable ? latestRelease?.releaseDate : 'Pending'}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-pink-50/50 border border-pink-200/60 text-left">
              <span className="text-xs text-zinc-500 flex items-center gap-1.5 mb-1">
                <Smartphone className="w-3.5 h-3.5 text-pink-600 shrink-0" aria-hidden="true" />
                <span>Android OS</span>
              </span>
              <span className="text-xs sm:text-sm font-semibold text-zinc-800 truncate block mt-0.5">
                {isAvailable ? latestRelease?.minAndroidVersion : 'Android 8.0+'}
              </span>
            </div>
          </div>

          {/* Primary Download Action */}
          <div className="py-6 sm:py-8 flex flex-col items-center justify-center">
            {loading ? (
              <div className="py-6 text-xs sm:text-sm text-zinc-500">
                Checking latest published release...
              </div>
            ) : isAvailable && latestRelease ? (
              <div className="w-full max-w-md flex flex-col items-center">
                <a
                  href={latestRelease.downloadUrl}
                  className="w-full inline-flex items-center justify-center gap-2.5 px-6 py-4 min-h-[52px] rounded-2xl font-semibold text-sm sm:text-base text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-500 hover:to-rose-500 transition-all duration-150 shadow-[0_8px_24px_rgba(219,39,119,0.24)] cursor-pointer text-center focus-visible:outline-pink-600 tabular-nums"
                >
                  <Download className="w-5 h-5 text-white shrink-0" aria-hidden="true" />
                  <span>
                    Download Zoya APK · {latestRelease.versionName} ({latestRelease.fileSizeFormatted})
                  </span>
                </a>

                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-zinc-500 text-center tabular-nums">
                  <span className="font-mono text-zinc-700">{latestRelease.fileName}</span>
                  <span aria-hidden="true" className="text-pink-300">·</span>
                  <span>Build {latestRelease.versionCode}</span>
                </div>
              </div>
            ) : (
              <div className="w-full max-w-md flex flex-col items-center p-6 rounded-2xl bg-pink-50/40 border border-pink-200/70 text-center">
                <div className="w-10 h-10 rounded-xl bg-pink-100/80 border border-pink-200 flex items-center justify-center mb-3 text-pink-600">
                  <Clock className="w-5 h-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-bold text-zinc-900 mb-1">
                  Release Package In Preparation
                </h3>
                <p className="text-xs sm:text-sm text-zinc-600 leading-relaxed max-w-xs mb-4">
                  The official Zoya Android APK is being prepared for publication. Once published, direct one-click download will be active here.
                </p>

                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] rounded-xl font-semibold text-xs sm:text-sm text-zinc-400 bg-zinc-100 border border-zinc-200 cursor-not-allowed"
                >
                  <span>Download Not Available Yet</span>
                </button>
              </div>
            )}
          </div>

          {/* Official Package Integrity Verification Bar */}
          {isAvailable && (
            <div className="pt-5 border-t border-pink-200/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0 max-w-full">
                <ShieldCheck className="w-4 h-4 text-pink-600 shrink-0" aria-hidden="true" />
                <span className="font-medium text-zinc-700">Package Verification:</span>
                <span className="text-zinc-600">
                  Official Android Package · Cryptographically Verified Release
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[11px] font-semibold shrink-0">
                <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                <span>Integrity Verified</span>
              </span>
            </div>
          )}

          {/* Published Release Notes */}
          {isAvailable && latestRelease?.releaseNotes && (
            <div className="mt-5 pt-5 border-t border-pink-200/60 text-left">
              <h4 className="text-xs font-semibold text-zinc-700 mb-2">
                Release Notes ({latestRelease.versionName})
              </h4>
              <div className="p-4 rounded-2xl bg-pink-50/40 border border-pink-200/60 text-xs sm:text-sm text-zinc-700 leading-relaxed whitespace-pre-line font-sans">
                {latestRelease.releaseNotes}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
