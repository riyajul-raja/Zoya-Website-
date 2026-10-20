import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ApkReleaseConfig } from '../config/apkConfig';

interface FaqProps {
  apkConfig: ApkReleaseConfig;
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export const Faq: React.FC<FaqProps> = ({ apkConfig }) => {
  const [openId, setOpenId] = useState<string | null>('what-is-zoya');

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
        'You can download the APK package directly from the official Download section on this website. When an official release build is published, tapping "Download APK" will directly save the verified installation package to your Android device.',
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
        'Future releases are published directly on this official website and the project release repository. When a new version is released, download the updated APK and install it directly over the existing version to upgrade while preserving your saved local preferences.',
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

  return (
    <section id="faq" aria-label="Frequently Asked Questions" className="py-16 sm:py-20 md:py-28 relative">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10 sm:mb-12">
          <div className="text-xs font-semibold tracking-wider uppercase text-teal-400 mb-2">
            Frequently Asked Questions
          </div>
          <h2 className="text-2xl xs:text-3xl sm:text-4xl font-extrabold text-white tracking-tight text-balance">
            Got questions about Zoya?
          </h2>
          <p className="mt-3 sm:mt-4 text-sm sm:text-base text-slate-300 leading-relaxed text-balance">
            Clear, honest answers about downloading, installing, and running Zoya on Android.
          </p>
        </div>

        {/* Accordion List */}
        <div className="space-y-3">
          {faqs.map((faq) => {
            const isOpen = openId === faq.id;
            const answerId = `faq-answer-${faq.id}`;
            const headerId = `faq-header-${faq.id}`;

            return (
              <div
                key={faq.id}
                className="rounded-2xl border transition-all duration-200 overflow-hidden bg-[#071319] border-teal-950/80 hover:border-teal-500/30"
              >
                <h3>
                  <button
                    type="button"
                    id={headerId}
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => toggleFaq(faq.id)}
                    className="w-full py-3.5 sm:py-4.5 px-3.5 sm:px-6 text-left flex items-center justify-between gap-3 sm:gap-4 cursor-pointer focus-visible:outline-teal-400 min-h-[48px]"
                  >
                    <span className="text-sm sm:text-base md:text-lg font-bold text-white tracking-tight">
                      {faq.question}
                    </span>
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 ${
                        isOpen
                          ? 'rotate-180 bg-teal-500/20 text-teal-300'
                          : 'bg-slate-800/60 text-slate-400'
                      }`}
                    >
                      <ChevronDown className="w-4 h-4" aria-hidden="true" />
                    </div>
                  </button>
                </h3>

                {isOpen && (
                  <div 
                    id={answerId}
                    role="region"
                    aria-labelledby={headerId}
                    className="px-3.5 sm:px-6 pb-4 sm:pb-5 pt-1 text-xs sm:text-sm md:text-base text-slate-300 leading-relaxed border-t border-slate-800/50"
                  >
                    <p>{faq.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
