import React, { useState, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type Variants,
} from 'motion/react';
import { ApkReleaseConfig } from '../config/apkConfig';

interface FaqProps {
  apkConfig: ApkReleaseConfig;
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

const CUBIC_EASE = [0.16, 1, 0.3, 1] as const;
const headingWords = ['Common', 'questions', 'about', 'Zoya'];

export const Faq: React.FC<FaqProps> = ({ apkConfig }) => {
  const sectionRef = useRef<HTMLElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const [openId, setOpenId] = useState<string | null>('what-is-zoya');

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });
  const storyY = useTransform(scrollYProgress, [0, 0.5, 1], [22, 0, -18]);
  const storyScale = useTransform(scrollYProgress, [0, 0.2, 0.85, 1], [0.98, 1, 1, 0.985]);
  const storyOpacity = useTransform(scrollYProgress, [0, 0.14, 0.9, 1], [0.76, 1, 1, 0.85]);

  const faqs: FaqItem[] = [
    {
      id: 'what-is-zoya',
      question: 'What is Zoya AI Assistant?',
      answer:
        'Zoya is an independent voice-first AI assistant application developed for Android devices by Riyajul. It allows users to have contextual conversations, make spoken inquiries, and configure custom assistant preferences in a lightweight, mobile-first package.',
    },
    {
      id: 'how-to-download',
      question: 'How do I download Zoya?',
      answer:
        'You can download the APK package directly from the Hero or Download section on this website. When an official release build is published, tapping "Download APK" will directly save the verified installation package to your Android device.',
    },
    {
      id: 'how-to-install',
      question: 'How do I install the APK?',
      answer:
        'Once downloaded, tap the file in your notification bar or navigate to your Downloads folder using a file manager. Android will ask whether you wish to allow installing apps from this source. Enable the toggle in Settings, return to the installer, and tap "Install".',
    },
    {
      id: 'supported-versions',
      question: 'Which Android versions are supported?',
      answer: `Zoya currently requires ${apkConfig.minAndroidVersion}. It is designed for smartphones and tablets running Android 8.0 and above, on standard ARM64 and universal mobile architectures.`,
    },
    {
      id: 'future-updates',
      question: 'How will I receive future updates?',
      answer:
        'Future releases are published directly on this official website. When a new version is released, download the updated APK and install it directly over the existing version to upgrade while preserving your saved local preferences.',
    },
    {
      id: 'permissions-privacy',
      question: 'What permissions does Zoya require on Android?',
      answer:
        'Zoya requires Microphone permission solely to capture spoken queries for voice interaction, and standard Network access to query assistant responses. It does not require access to your personal contacts, photos, SMS, or private device storage.',
    },
  ];

  const toggleFaq = (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

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
      id="faq"
      aria-label="Frequently Asked Questions"
      className="relative py-14 sm:py-20"
    >
      {/* Dynamic Section Atmospheric Blending */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 section-ambient-halo"
      />

      <motion.div
        className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8"
        style={
          shouldReduceMotion
            ? undefined
            : { y: storyY, scale: storyScale, opacity: storyOpacity }
        }
      >
        <div className="text-center mb-10 sm:mb-12">
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
            FAQ
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
            Clear answers about downloading, installing, and running Zoya AI Assistant on Android.
          </motion.p>
        </div>

        {/* Accordion List */}
        <div className="space-y-3">
          {faqs.map((faq, index) => {
            const isOpen = openId === faq.id;
            const answerId = `faq-answer-${faq.id}`;
            const headerId = `faq-header-${faq.id}`;

            return (
              <motion.div
                key={faq.id}
                className={`rounded-2xl transition-colors duration-200 overflow-hidden glass-card ${
                  isOpen
                    ? 'border-pink-300/90 shadow-[0_12px_30px_-10px_rgba(219,39,119,0.1)]'
                    : 'hover:border-pink-300/70'
                }`}
                initial={shouldReduceMotion ? false : { opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: false, amount: 0.15 }}
                transition={{
                  duration: shouldReduceMotion ? 0 : 0.45,
                  delay: shouldReduceMotion ? 0 : index * 0.05,
                  ease: CUBIC_EASE,
                }}
              >
                <h3>
                  <button
                    type="button"
                    id={headerId}
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => toggleFaq(faq.id)}
                    className="w-full py-4 px-5 sm:px-6 text-left flex items-center justify-between gap-4 cursor-pointer focus-visible:outline-pink-600 min-h-[52px] transition-colors duration-150 hover:bg-pink-50/35"
                  >
                    <span className="text-sm sm:text-base font-semibold text-zinc-900 tracking-tight">
                      {faq.question}
                    </span>
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200 ${
                        isOpen
                          ? 'rotate-180 bg-pink-100 text-pink-600'
                          : 'bg-pink-50/80 text-zinc-500'
                      }`}
                    >
                      <ChevronDown className="w-4 h-4" aria-hidden="true" />
                    </div>
                  </button>
                </h3>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={answerId}
                      role="region"
                      aria-labelledby={headerId}
                      initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={shouldReduceMotion ? { height: 0, opacity: 0 } : { height: 0, opacity: 0 }}
                      transition={{
                        height: {
                          duration: shouldReduceMotion ? 0 : 0.28,
                          ease: CUBIC_EASE,
                        },
                        opacity: {
                          duration: shouldReduceMotion ? 0 : 0.22,
                          ease: CUBIC_EASE,
                        },
                      }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 sm:px-6 pb-5 pt-2.5 text-xs sm:text-sm text-zinc-600 leading-relaxed border-t border-pink-100/90">
                        <p>{faq.answer}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </section>
  );
};
