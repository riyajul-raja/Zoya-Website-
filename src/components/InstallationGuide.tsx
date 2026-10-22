import React from 'react';
import { Info } from 'lucide-react';

export const InstallationGuide: React.FC = () => {
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

  return (
    <section
      id="installation"
      aria-label="Installation Instructions"
      className="py-14 sm:py-20"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center mb-10 sm:mb-12">
          <div className="text-xs font-semibold text-pink-600 mb-2">
            Simple Setup
          </div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-zinc-900 tracking-tight text-balance">
            How to install Zoya on Android
          </h2>
          <p className="mt-3 text-sm sm:text-base text-zinc-600 leading-relaxed">
            Installing the standalone APK takes less than a minute on any smartphone or tablet running Android 8.0 or newer.
          </p>
        </div>

        {/* 4-Step Ordered Grid */}
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 list-none p-0">
          {steps.map((step) => (
            <li
              key={step.number}
              className="glass-card rounded-2xl p-6 text-left"
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
            </li>
          ))}
        </ol>

        {/* Subtle Android Security Note */}
        <div className="mt-6 glass-card rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row items-start gap-3.5">
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
        </div>
      </div>
    </section>
  );
};
