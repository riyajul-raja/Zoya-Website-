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

  return (
    <section
      id="faq"
      aria-label="Frequently Asked Questions"
      className="py-14 sm:py-20"
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10 sm:mb-12">
          <div className="text-xs font-semibold text-pink-600 mb-2">
            FAQ
          </div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-zinc-900 tracking-tight text-balance">
            Common questions about Zoya
          </h2>
          <p className="mt-3 text-sm sm:text-base text-zinc-600 leading-relaxed">
            Clear answers about downloading, installing, and running Zoya AI Assistant on Android.
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
                className={`rounded-2xl transition-colors duration-150 overflow-hidden glass-card ${
                  isOpen ? 'border-pink-300/90' : 'hover:border-pink-300/70'
                }`}
              >
                <h3>
                  <button
                    type="button"
                    id={headerId}
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => toggleFaq(faq.id)}
                    className="w-full py-4 px-5 sm:px-6 text-left flex items-center justify-between gap-4 cursor-pointer focus-visible:outline-pink-600 min-h-[52px]"
                  >
                    <span className="text-sm sm:text-base font-semibold text-zinc-900 tracking-tight">
                      {faq.question}
                    </span>
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-150 ${
                        isOpen
                          ? 'rotate-180 bg-pink-100 text-pink-600'
                          : 'bg-pink-50/80 text-zinc-500'
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
                    className="px-5 sm:px-6 pb-5 pt-2 text-xs sm:text-sm text-zinc-600 leading-relaxed border-t border-pink-100"
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
