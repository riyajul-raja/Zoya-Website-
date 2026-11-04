import React, { useRef } from 'react';
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
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type Variants,
} from 'motion/react';
import { MagneticWrapper } from './LivingBackground';
import { ZoyaLogo } from './ZoyaLogo';
import { ReleaseMetadata } from '../../server/storage';

interface ApkDownloadProps {
  latestRelease: ReleaseMetadata | null;
  loading: boolean;
  onOpenAdmin?: () => void;
}

const CUBIC_EASE = [0.16, 1, 0.3, 1] as const;
const headingWords = ['Download', 'Zoya', 'AI', 'Assistant'];

export const ApkDownload: React.FC<ApkDownloadProps> = ({
  latestRelease,
  loading,
}) => {
  const sectionRef = useRef<HTMLElement>(null);
  const shouldReduceMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });
  const storyY = useTransform(scrollYProgress, [0, 0.5, 1], [26, 0, -24]);
  const storyScale = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.975, 1, 1, 0.98]);
  const storyOpacity = useTransform(scrollYProgress, [0, 0.14, 0.86, 1], [0.75, 1, 1, 0.8]);

  const isAvailable = Boolean(
    latestRelease &&
    latestRelease.isPublished &&
    latestRelease.downloadUrl &&
    latestRelease.binaryVerified !== false
  );

  const headingContainerVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: shouldReduceMotion ? 0 : 0.045,
        delayChildren: shouldReduceMotion ? 0 : 0.06,
      },
    },
  };

  const headingWordVariants: Variants = {
    hidden: shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: shouldReduceMotion ? 0 : 0.45,
        ease: CUBIC_EASE,
      },
    },
  };

  return (
    <section
      ref={sectionRef}
      id="download"
      aria-label="Download Zoya Android APK"
      className="relative py-14 sm:py-20"
    >
      {/* Dynamic Section Atmospheric Blending */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 section-ambient-halo"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-20 -z-10 section-transition-bridge"
      />

      <motion.div
        className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8"
        style={
          shouldReduceMotion
            ? undefined
            : { y: storyY, scale: storyScale, opacity: storyOpacity }
        }
      >
        <div className="max-w-2xl mx-auto text-center mb-8 sm:mb-10">
          <motion.div
            className="inline-flex items-center justify-center gap-2 text-xs font-semibold text-pink-600 mb-2"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.4,
              ease: CUBIC_EASE,
            }}
          >
            <ZoyaLogo size="xs" showText={false} />
            <span>Official Android Release</span>
          </motion.div>
          <motion.h2
            className="text-2xl sm:text-3xl lg:text-4xl font-bold text-zinc-900 tracking-tight text-balance"
            variants={headingContainerVariants}
            initial={shouldReduceMotion ? false : 'hidden'}
            whileInView="visible"
            viewport={{ once: false, amount: 0.2 }}
          >
            {headingWords.map((word, index) => (
              <React.Fragment key={index}>
                <motion.span className="inline-block" variants={headingWordVariants}>
                  {word}
                </motion.span>
                {index < headingWords.length - 1 ? ' ' : ''}
              </React.Fragment>
            ))}
          </motion.h2>
          <motion.p
            className="mt-3 text-sm sm:text-base text-zinc-600 leading-relaxed"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.5,
              delay: shouldReduceMotion ? 0 : 0.28,
              ease: CUBIC_EASE,
            }}
          >
            Get the latest verified standalone Android installation package (<code className="font-mono text-pink-700">.apk</code>) directly from the official release channel.
          </motion.p>
        </div>

        {/* Frosted Pink-Glass Release Card */}
        <motion.div
          className="glass-panel rounded-3xl p-5 sm:p-8 md:p-10"
          initial={shouldReduceMotion ? false : { opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.15 }}
          transition={{
            duration: shouldReduceMotion ? 0 : 0.6,
            ease: CUBIC_EASE,
          }}
        >
          {/* Release Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 pb-6 border-b border-pink-200/60 tabular-nums">
            <motion.div
              className="p-3.5 rounded-2xl bg-pink-50/50 border border-pink-200/60 text-left"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: false, amount: 0.15 }}
              transition={{
                duration: shouldReduceMotion ? 0 : 0.45,
                delay: shouldReduceMotion ? 0 : 0.05,
                ease: CUBIC_EASE,
              }}
            >
              <span className="text-xs text-zinc-500 flex items-center gap-1.5 mb-1">
                <FileCode className="w-3.5 h-3.5 text-pink-600 shrink-0" aria-hidden="true" />
                <span>Version</span>
              </span>
              <span className="text-sm sm:text-base font-bold text-zinc-900 font-mono truncate block">
                {loading ? 'Checking...' : isAvailable ? latestRelease?.versionName : 'Upcoming'}
              </span>
            </motion.div>

            <motion.div
              className="p-3.5 rounded-2xl bg-pink-50/50 border border-pink-200/60 text-left"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: false, amount: 0.15 }}
              transition={{
                duration: shouldReduceMotion ? 0 : 0.45,
                delay: shouldReduceMotion ? 0 : 0.12,
                ease: CUBIC_EASE,
              }}
            >
              <span className="text-xs text-zinc-500 flex items-center gap-1.5 mb-1">
                <HardDrive className="w-3.5 h-3.5 text-pink-600 shrink-0" aria-hidden="true" />
                <span>APK Size</span>
              </span>
              <span className="text-sm sm:text-base font-bold text-zinc-900 font-mono truncate block">
                {loading ? '...' : isAvailable ? latestRelease?.fileSizeFormatted : 'TBA'}
              </span>
            </motion.div>

            <motion.div
              className="p-3.5 rounded-2xl bg-pink-50/50 border border-pink-200/60 text-left"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: false, amount: 0.15 }}
              transition={{
                duration: shouldReduceMotion ? 0 : 0.45,
                delay: shouldReduceMotion ? 0 : 0.19,
                ease: CUBIC_EASE,
              }}
            >
              <span className="text-xs text-zinc-500 flex items-center gap-1.5 mb-1">
                <Calendar className="w-3.5 h-3.5 text-pink-600 shrink-0" aria-hidden="true" />
                <span>Released</span>
              </span>
              <span className="text-sm sm:text-base font-bold text-zinc-900 font-mono truncate block">
                {loading ? '...' : isAvailable ? latestRelease?.releaseDate : 'Pending'}
              </span>
            </motion.div>

            <motion.div
              className="p-3.5 rounded-2xl bg-pink-50/50 border border-pink-200/60 text-left"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: false, amount: 0.15 }}
              transition={{
                duration: shouldReduceMotion ? 0 : 0.45,
                delay: shouldReduceMotion ? 0 : 0.26,
                ease: CUBIC_EASE,
              }}
            >
              <span className="text-xs text-zinc-500 flex items-center gap-1.5 mb-1">
                <Smartphone className="w-3.5 h-3.5 text-pink-600 shrink-0" aria-hidden="true" />
                <span>Android OS</span>
              </span>
              <span className="text-xs sm:text-sm font-semibold text-zinc-800 truncate block mt-0.5">
                {isAvailable ? latestRelease?.minAndroidVersion : 'Android 8.0+'}
              </span>
            </motion.div>
          </div>

          {/* Primary Download Action */}
          <div className="py-6 sm:py-8 flex flex-col items-center justify-center">
            {loading ? (
              <div className="py-6 text-xs sm:text-sm text-zinc-500">
                Checking latest published release...
              </div>
            ) : isAvailable && latestRelease ? (
              <div className="w-full max-w-md flex flex-col items-center">
                <MagneticWrapper className="w-full">
                  <a
                    href={latestRelease.downloadUrl}
                    className="group relative w-full inline-flex items-center justify-center gap-2.5 px-6 py-4 min-h-[54px] rounded-2xl font-semibold text-sm sm:text-base text-white bg-gradient-to-r from-pink-600 via-pink-600 to-rose-500 hover:from-pink-500 hover:via-pink-600 hover:to-rose-500 border border-pink-400/30 shadow-[0_10px_28px_-6px_rgba(219,39,119,0.38),inset_0_1px_0_rgba(255,255,255,0.25)] hover:shadow-[0_14px_34px_-6px_rgba(219,39,119,0.48),inset_0_1px_0_rgba(255,255,255,0.35)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] transition-all duration-200 cursor-pointer text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600 tabular-nums"
                  >
                    <Download
                      className="w-5 h-5 text-white shrink-0 transition-transform duration-200 group-hover:translate-y-0.5"
                      aria-hidden="true"
                    />
                    <span>
                      Download Zoya APK · {latestRelease.versionName} ({latestRelease.fileSizeFormatted})
                    </span>
                  </a>
                </MagneticWrapper>

                <div className="mt-3.5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-xs text-zinc-500 text-center tabular-nums">
                  <span className="font-mono text-zinc-700 font-medium">{latestRelease.fileName}</span>
                  <span aria-hidden="true" className="text-pink-300">·</span>
                  <span>Build {latestRelease.versionCode}</span>
                  {latestRelease.minAndroidVersion && (
                    <>
                      <span aria-hidden="true" className="text-pink-300">·</span>
                      <span>{latestRelease.minAndroidVersion}</span>
                    </>
                  )}
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
        </motion.div>
      </motion.div>
    </section>
  );
};
