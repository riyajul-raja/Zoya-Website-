import React, { useState } from 'react';
import { 
  Download, 
  Smartphone, 
  Calendar, 
  HardDrive, 
  Copy, 
  Check, 
  FileCode, 
  Clock 
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
  const [copiedHash, setCopiedHash] = useState(false);

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const isAvailable = Boolean(latestRelease && latestRelease.isPublished && latestRelease.downloadUrl);

  return (
    <section id="download" aria-label="Download Zoya Android APK" className="py-16 sm:py-20 md:py-28 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center mb-10 sm:mb-12">
          <div className="text-xs font-semibold tracking-wider uppercase text-teal-400 mb-2">
            Official Distribution
          </div>
          <h2 className="text-2xl xs:text-3xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight text-balance">
            Download Zoya for Android
          </h2>
          <p className="mt-3 sm:mt-4 text-sm sm:text-base lg:text-lg text-slate-300 leading-relaxed text-balance">
            Get the standalone Android APK package directly from the official release distribution backend.
            Engineered for modern Android smartphones and tablets.
          </p>
        </div>

        {/* Central Release Card */}
        <div className="max-w-3xl mx-auto bg-[#071319] border border-teal-500/30 rounded-2xl sm:rounded-3xl p-4 sm:p-8 md:p-10 shadow-[0_0_50px_rgba(20,184,166,0.08)] relative overflow-hidden">
          {/* Decorative glow */}
          <div aria-hidden="true" className="absolute top-0 right-1/4 w-60 h-60 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Release Specifications Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4 p-3.5 sm:p-4 rounded-xl sm:rounded-2xl bg-[#040c10] border border-teal-950/80 mb-5 sm:mb-8">
            <div className="text-left">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5 mb-1">
                <FileCode className="w-3.5 h-3.5 text-teal-400 shrink-0" aria-hidden="true" />
                Version
              </span>
              <span className="text-xs sm:text-sm md:text-base font-bold text-white font-mono truncate block">
                {loading ? 'Checking...' : isAvailable ? latestRelease?.versionName : 'In Development'}
              </span>
            </div>

            <div className="text-left">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5 mb-1">
                <HardDrive className="w-3.5 h-3.5 text-cyan-400 shrink-0" aria-hidden="true" />
                File Size
              </span>
              <span className="text-xs sm:text-sm md:text-base font-bold text-white font-mono truncate block">
                {loading ? '...' : isAvailable ? latestRelease?.fileSizeFormatted : 'TBA'}
              </span>
            </div>

            <div className="text-left">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5 mb-1">
                <Calendar className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                Release Date
              </span>
              <span className="text-xs sm:text-sm md:text-base font-bold text-white truncate block">
                {loading ? '...' : isAvailable ? latestRelease?.releaseDate : 'Upcoming'}
              </span>
            </div>

            <div className="text-left">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5 mb-1">
                <Smartphone className="w-3.5 h-3.5 text-teal-300 shrink-0" aria-hidden="true" />
                OS Target
              </span>
              <span className="text-xs sm:text-sm font-semibold text-slate-200 truncate block">
                {isAvailable ? latestRelease?.minAndroidVersion : 'Android 8.0+'}
              </span>
            </div>
          </div>

          {/* Real One-Click Download Button */}
          <div className="flex flex-col items-center justify-center py-2 sm:py-4">
            {loading ? (
              <div className="p-6 text-xs text-slate-400 animate-pulse">
                Querying latest verified release from backend...
              </div>
            ) : isAvailable && latestRelease ? (
              /* REAL ONE-CLICK DOWNLOAD BUTTON: Direct native download with zero fake redirects */
              <div className="w-full max-w-md flex flex-col items-center">
                <a
                  href={latestRelease.downloadUrl}
                  download={`zoya-assistant-${latestRelease.versionName || 'latest'}.apk`}
                  className="w-full inline-flex items-center justify-center gap-2.5 px-4 sm:px-8 py-3.5 sm:py-4 min-h-[48px] rounded-xl font-bold text-sm sm:text-base md:text-lg text-slate-950 bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 transition-all shadow-[0_0_25px_rgba(45,212,191,0.35)] hover:shadow-[0_0_40px_rgba(45,212,191,0.5)] active:scale-98 cursor-pointer text-center focus-visible:outline-teal-400"
                >
                  <Download className="w-5 h-5 text-slate-950 shrink-0" aria-hidden="true" />
                  <span>Download Zoya APK ({latestRelease.fileSizeFormatted})</span>
                </a>

                <div className="mt-2.5 text-xs text-slate-400 text-center break-all">
                  Direct package: <span className="font-mono text-slate-300">{latestRelease.fileName}</span> (code: {latestRelease.versionCode})
                </div>
              </div>
            ) : (
              /* CLEAN HONEST COMING SOON / UNPUBLISHED STATE */
              <div className="w-full max-w-md flex flex-col items-center p-4 sm:p-6 rounded-2xl bg-slate-900/70 border border-slate-800 text-center">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mb-3 text-teal-400">
                  <Clock className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
                </div>
                <h3 className="text-base sm:text-lg font-bold text-white mb-1">
                  Download Coming Soon
                </h3>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-xs mb-4">
                  The official Zoya Android APK is currently in active development. Verified release packages will be made available directly on this page once published by the administrator.
                </p>

                {/* Disabled download action button adhering strictly to prompt requirements */}
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] rounded-xl font-semibold text-xs sm:text-sm text-slate-400 bg-slate-800/80 border border-slate-700 cursor-not-allowed opacity-80"
                >
                  <span>Download Not Available Yet</span>
                </button>
              </div>
            )}
          </div>

          {/* Genuine SHA-256 Checksum - Calculated server-side, only shown when published */}
          {isAvailable && latestRelease?.sha256 && (
            <div className="mt-5 p-3 sm:p-3.5 rounded-xl bg-[#040b0f] border border-teal-950/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 text-[11px]">
              <div className="flex items-center gap-2 min-w-0 max-w-full">
                <span className="font-semibold text-slate-400 shrink-0">Verified SHA-256:</span>
                <span className="font-mono text-slate-400 truncate max-w-[160px] xs:max-w-xs sm:max-w-md">
                  {latestRelease.sha256}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleCopyHash(latestRelease.sha256)}
                className="inline-flex items-center gap-1.5 text-teal-400 hover:text-teal-300 font-medium shrink-0 cursor-pointer min-h-[36px] py-1 px-2.5 bg-slate-900/60 sm:bg-transparent rounded-lg border border-teal-500/20 sm:border-transparent focus-visible:outline-teal-400"
                title="Copy SHA-256 Checksum"
              >
                {copiedHash ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-teal-400" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Copy Hash</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Published Release Notes */}
          {isAvailable && latestRelease?.releaseNotes && (
            <div className="mt-6 text-left">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Release Notes ({latestRelease.versionName})
              </h4>
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 leading-relaxed whitespace-pre-line font-sans">
                {latestRelease.releaseNotes}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
