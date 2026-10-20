import React from 'react';
import { Download, FolderOpen, ShieldAlert, Play, Info } from 'lucide-react';

export const InstallationGuide: React.FC = () => {
  const steps = [
    {
      number: '01',
      title: 'Download the APK',
      desc: 'Tap the Download APK button above. The package (.apk) file will save to your device’s Downloads folder.',
      icon: Download,
    },
    {
      number: '02',
      title: 'Open the downloaded file',
      desc: 'Swipe down your Android notification panel and tap the download completion alert, or locate the file in your Files manager app.',
      icon: FolderOpen,
    },
    {
      number: '03',
      title: 'Allow installation from this source',
      desc: 'If Android prompts with "Install unknown apps", tap Settings and toggle "Allow from this source" for your browser or file manager.',
      icon: ShieldAlert,
    },
    {
      number: '04',
      title: 'Install and open Zoya',
      desc: 'Tap "Install" on the confirmation screen. Once installation finishes, tap "Open" to launch Zoya and grant microphone permissions for voice assistance.',
      icon: Play,
    },
  ];

  return (
    <section id="installation" aria-label="Installation Instructions" className="py-16 sm:py-20 md:py-24 bg-[#04080c]/85 border-t border-teal-950/40 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl text-left mb-10 sm:mb-12">
          <div className="text-xs font-semibold tracking-wider uppercase text-teal-400 mb-2">
            Step-by-Step Instructions
          </div>
          <h2 className="text-2xl xs:text-3xl sm:text-4xl font-extrabold text-white tracking-tight text-balance">
            How to Install the APK on Android
          </h2>
          <p className="mt-3 sm:mt-4 text-sm sm:text-base text-slate-300 leading-relaxed">
            Follow these straightforward steps to set up Zoya AI Assistant on your Android smartphone or tablet.
          </p>
        </div>

        {/* Steps List (Ordered list for semantic accessibility) */}
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 list-none p-0">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <li
                key={step.number}
                className="bg-[#071319] border border-teal-950/80 hover:border-teal-500/30 rounded-2xl p-4 sm:p-6 transition-all duration-300 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xl sm:text-2xl font-mono font-bold text-teal-400/90">
                      {step.number}
                    </span>
                    <div className="w-10 h-10 rounded-lg bg-teal-950/60 border border-teal-500/20 flex items-center justify-center text-teal-300">
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </div>
                  </div>

                  <h3 className="text-base sm:text-lg font-bold text-white mb-2 tracking-tight">
                    {step.title}
                  </h3>

                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {step.desc}
                  </p>
                </div>

                <div className="mt-5 pt-3 border-t border-slate-800/60 text-[11px] text-slate-400">
                  Step {step.number} of 04
                </div>
              </li>
            );
          })}
        </ol>

        {/* Android Security Warning Explanation Box */}
        <div className="mt-8 sm:mt-10 p-4 sm:p-5 rounded-2xl bg-[#09151c] border border-cyan-900/40 flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
          <div className="p-2 rounded-xl bg-cyan-950/80 border border-cyan-500/30 text-cyan-300 shrink-0">
            <Info className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-left text-xs sm:text-sm leading-relaxed text-slate-300">
            <h4 className="font-bold text-white mb-1">
              About Android Unknown Sources &amp; Play Protect Warnings
            </h4>
            <p className="text-slate-300 text-xs sm:text-sm">
              Because Zoya is distributed directly as an APK outside the Google Play Store, Android will display a standard security prompt (such as <em>&quot;File might be harmful&quot;</em> or <em>&quot;Install unknown apps&quot;</em>). This is Android&apos;s standard operating system safeguard for sideloaded packages.
            </p>
            <p className="mt-1.5 text-xs text-slate-400">
              Only install APK files obtained directly from this official domain. Zoya requests standard microphone permissions strictly for audio voice interaction.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
