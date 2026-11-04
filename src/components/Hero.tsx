import React, { useRef } from 'react';
import { ArrowDown, Sparkles } from 'lucide-react';
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  useMotionValue,
  useSpring,
  type Variants,
} from 'motion/react';
import { ZoyaLogo } from './ZoyaLogo';
import { MagneticWrapper, useFinePointer } from './LivingBackground';
import { ReleaseMetadata } from '../../server/storage';

interface HeroProps {
  latestRelease: ReleaseMetadata | null;
  onExploreDownloads?: () => void;
  onExploreFeatures?: () => void;
  onDownloadClick?: () => void;
}

const CUBIC_EASE = [0.16, 1, 0.3, 1] as const;
const headlineWords = ['Meet', 'Zoya', '—', 'Your', 'AI', 'Voice', 'Assistant'];

export const Hero: React.FC<HeroProps> = ({
  latestRelease,
  onExploreDownloads,
  onExploreFeatures,
  onDownloadClick,
}) => {
  const sectionRef = useRef<HTMLElement>(null);
  const emblemRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const isFinePointer = useFinePointer();
  const enable3D = isFinePointer && !shouldReduceMotion;

  // Cinematic Scroll Story: subtle scroll-linked parallax, scale, and opacity
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });
  const storyY = useTransform(scrollYProgress, [0, 1], [0, 36]);
  const storyScale = useTransform(scrollYProgress, [0, 1], [1, 0.965]);
  const storyOpacity = useTransform(scrollYProgress, [0, 0.85, 1], [1, 0.92, 0.78]);

  // 3D Depth / Parallax for Zoya Emblem on fine pointer devices
  const rawRotateX = useMotionValue(0);
  const rawRotateY = useMotionValue(0);
  const rawEmblemX = useMotionValue(0);
  const rawEmblemY = useMotionValue(0);

  const rotateX = useSpring(rawRotateX, { stiffness: 200, damping: 20 });
  const rotateY = useSpring(rawRotateY, { stiffness: 200, damping: 20 });
  const emblemX = useSpring(rawEmblemX, { stiffness: 200, damping: 20 });
  const emblemY = useSpring(rawEmblemY, { stiffness: 200, damping: 20 });

  const handlePanelPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enable3D || !emblemRef.current || e.pointerType === 'touch') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const ny = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);

    rawRotateX.set(Math.max(-8, Math.min(8, -ny * 7)));
    rawRotateY.set(Math.max(-8, Math.min(8, nx * 7)));
    rawEmblemX.set(Math.max(-6, Math.min(6, nx * 5)));
    rawEmblemY.set(Math.max(-6, Math.min(6, ny * 5)));
  };

  const handlePanelPointerLeave = () => {
    rawRotateX.set(0);
    rawRotateY.set(0);
    rawEmblemX.set(0);
    rawEmblemY.set(0);
  };

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

  const headlineContainerVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: shouldReduceMotion ? 0 : 0.045,
        delayChildren: shouldReduceMotion ? 0 : 0.22,
      },
    },
  };

  const headlineWordVariants: Variants = {
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
      id="hero"
      aria-label="Zoya AI Assistant Overview"
      className="relative overflow-hidden pt-20 pb-10 sm:pt-32 sm:pb-16 lg:pt-36 lg:pb-20"
    >
      {/* Subtle Animated Ambient Gradient Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-6 -bottom-10 -z-10 hero-ambient-glow"
      />

      {/* Dynamic Section Transition Bridge to next section */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-20 -z-10 section-transition-bridge"
      />

      <motion.div
        className="relative max-w-5xl mx-auto px-3 sm:px-6 lg:px-8"
        style={
          shouldReduceMotion
            ? undefined
            : { y: storyY, scale: storyScale, opacity: storyOpacity }
        }
      >
        <motion.div
          onPointerMove={handlePanelPointerMove}
          onPointerLeave={handlePanelPointerLeave}
          className="glass-panel rounded-2xl sm:rounded-3xl px-4 py-8 sm:px-10 sm:py-14 md:py-18 text-center flex flex-col items-center"
          initial={shouldReduceMotion ? false : { opacity: 0, y: 18, scale: 0.985 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: false, amount: 0.15 }}
          transition={{
            duration: shouldReduceMotion ? 0 : 0.7,
            ease: CUBIC_EASE,
          }}
        >
          {/* Original single Zoya Emblem with refined 3D Depth & Parallax */}
          <motion.div
            ref={emblemRef}
            className="flex flex-col items-center gap-2.5 sm:gap-3 mb-4 sm:mb-6"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.5,
              delay: shouldReduceMotion ? 0 : 0.12,
              ease: CUBIC_EASE,
            }}
          >
            <motion.div
              style={
                enable3D
                  ? {
                      rotateX,
                      rotateY,
                      x: emblemX,
                      y: emblemY,
                      transformPerspective: 800,
                    }
                  : undefined
              }
              className="will-change-transform"
            >
              <ZoyaLogo size="lg" showText={false} />
            </motion.div>
            <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-semibold tracking-wide text-zinc-500 tabular-nums">
              <span className="text-pink-600">Zoya AI Assistant</span>
              <span aria-hidden="true" className="text-pink-300">·</span>
              <span className="text-zinc-600">Android Edition</span>
            </div>
          </motion.div>

          {/* Exact Headline line-by-line / word-by-word staggered reveal */}
          <motion.h1
            className="text-2xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-zinc-900 leading-tight sm:leading-tight max-w-2xl text-balance"
            variants={headlineContainerVariants}
            initial={shouldReduceMotion ? false : 'hidden'}
            whileInView="visible"
            viewport={{ once: false, amount: 0.2 }}
          >
            {headlineWords.map((word, index) => (
              <React.Fragment key={index}>
                <motion.span
                  className="inline-block"
                  variants={headlineWordVariants}
                >
                  {word}
                </motion.span>
                {index < headlineWords.length - 1 ? ' ' : ''}
              </React.Fragment>
            ))}
          </motion.h1>

          {/* Exact Description */}
          <motion.p
            className="mt-3.5 sm:mt-5 text-sm sm:text-base lg:text-lg text-zinc-600 max-w-xl leading-relaxed text-balance"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.55,
              delay: shouldReduceMotion ? 0 : 0.55,
              ease: CUBIC_EASE,
            }}
          >
            Talk to Zoya naturally using your voice. Get answers to your questions, enjoy hands-free conversations, and personalize your assistant to suit your needs—all in one lightweight Android app.
          </motion.p>

          {/* Action Navigation Buttons with Interactive Magnetic Response */}
          <motion.div
            className="mt-6 sm:mt-8 w-full max-w-lg flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.55,
              delay: shouldReduceMotion ? 0 : 0.72,
              ease: CUBIC_EASE,
            }}
          >
            <MagneticWrapper className="w-full sm:w-auto">
              <button
                type="button"
                onClick={handleScrollToDownloads}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[48px] rounded-xl font-semibold text-white bg-pink-600 hover:bg-pink-700 active:bg-pink-800 transition-colors duration-150 shadow-sm cursor-pointer text-sm sm:text-base whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600"
              >
                <ArrowDown className="w-4 h-4 text-white shrink-0" aria-hidden="true" />
                <span>Explore Downloads</span>
              </button>
            </MagneticWrapper>

            <MagneticWrapper className="w-full sm:w-auto">
              <button
                type="button"
                onClick={handleScrollToFeatures}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[48px] rounded-xl font-semibold text-pink-700 bg-pink-50 hover:bg-pink-100/90 active:bg-pink-200/80 border border-pink-200/80 transition-colors duration-150 shadow-xs cursor-pointer text-sm sm:text-base whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600"
              >
                <Sparkles className="w-4 h-4 text-pink-600 shrink-0" aria-hidden="true" />
                <span>Explore Features</span>
              </button>
            </MagneticWrapper>
          </motion.div>

          {/* Quiet Release Compatibility Metadata */}
          <motion.div
            className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-zinc-500 tabular-nums"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.5,
              delay: shouldReduceMotion ? 0 : 0.85,
              ease: CUBIC_EASE,
            }}
          >
            <span className="font-medium text-zinc-700">{latestRelease?.minAndroidVersion || 'Android 8.0+'}</span>
            <span aria-hidden="true" className="text-pink-300">·</span>
            <span>
              {isAvailable && latestRelease?.versionName
                ? `v${latestRelease.versionName} Available`
                : 'Standalone Android APK'}
            </span>
            <span aria-hidden="true" className="text-pink-300">·</span>
            <span>Direct Installation</span>
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
};
