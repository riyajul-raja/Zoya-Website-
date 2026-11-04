import React, { useRef } from 'react';
import { Info } from 'lucide-react';
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type Variants,
} from 'motion/react';

const CUBIC_EASE = [0.16, 1, 0.3, 1] as const;
const headingWords = ['How', 'to', 'install', 'Zoya', 'on', 'Android'];

export const InstallationGuide: React.FC = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const shouldReduceMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });
  const storyY = useTransform(scrollYProgress, [0, 0.5, 1], [24, 0, -24]);
  const storyScale = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.975, 1, 1, 0.98]);
  const storyOpacity = useTransform(scrollYProgress, [0, 0.14, 0.86, 1], [0.72, 1, 1, 0.78]);

  const steps = [
    {
      number: '01',
      title: 'Download the APK',
      desc: 'Tap the Download APK button above to save the verified .apk package to your device.',
    },
    {
      number: '02',
      title: 'Open the package',
      desc: 'Tap the completed download notification or locate the file in your Android Files app.',
    },
    {
      number: '03',
      title: 'Allow installation',
      desc: 'If prompted with "Install unknown apps", open Settings and enable "Allow from this source".',
    },
    {
      number: '04',
      title: 'Launch Zoya',
      desc: 'Tap "Install", open Zoya AI Assistant, and grant microphone access to start speaking.',
    },
  ];

  const headingContainerVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: shouldReduceMotion ? 0 : 0.04,
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
      id="installation"
      aria-label="Installation Instructions"
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
        className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8"
        style={
          shouldReduceMotion
            ? undefined
            : { y: storyY, scale: storyScale, opacity: storyOpacity }
        }
      >
        <div className="max-w-2xl mx-auto text-center mb-10 sm:mb-12">
          <motion.div
            className="text-xs font-semibold text-pink-600 mb-2"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.2 }}
            transition={{
              duration: shouldReduceMotion ? 0 : 0.4,
              ease: CUBIC_EASE,
            }}
          >
            Simple Setup
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
              delay: shouldReduceMotion ? 0 : 0.3,
              ease: CUBIC_EASE,
            }}
          >
            Installing the standalone APK takes less than a minute on Android 8.0 or newer.
          </motion.p>
        </div>

        {/* 4-Step Ordered Grid */}
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 list-none p-0">
          {steps.map((step, index) => (
            <motion.li
              key={step.number}
              className="glass-card rounded-2xl p-6 text-left"
              initial={shouldReduceMotion ? false : { opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: false, amount: 0.15 }}
              transition={{
                duration: shouldReduceMotion ? 0 : 0.5,
                delay: shouldReduceMotion ? 0 : index * 0.08,
                ease: CUBIC_EASE,
              }}
            >
              <span className="inline-block text-sm font-mono font-bold text-pink-600 tabular-nums mb-3">
                {step.number}.
              </span>

              <h3 className="text-base font-bold text-zinc-900 mb-2 tracking-tight">
                {step.title}
              </h3>

              <p className="text-xs sm:text-sm text-zinc-600 leading-relaxed">
                {step.desc}
              </p>
            </motion.li>
          ))}
        </ol>

        {/* Subtle Android Security Note */}
        <motion.div
          className="mt-6 glass-card rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row items-start gap-3.5"
          initial={shouldReduceMotion ? false : { opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.15 }}
          transition={{
            duration: shouldReduceMotion ? 0 : 0.5,
            delay: shouldReduceMotion ? 0 : 0.28,
            ease: CUBIC_EASE,
          }}
        >
          <div className="w-8 h-8 rounded-xl bg-pink-50 border border-pink-200/70 flex items-center justify-center text-pink-600 shrink-0">
            <Info className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="text-left text-xs sm:text-sm leading-relaxed">
            <h4 className="font-bold text-zinc-900 mb-0.5">
              Note on Direct APK Installation
            </h4>
            <p className="text-zinc-600">
              Because Zoya is distributed directly from its official website outside the Google Play Store, Android may show a standard prompt (such as <em>&quot;Install unknown apps&quot;</em>). This is normal for directly installed Android packages.
            </p>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
};
