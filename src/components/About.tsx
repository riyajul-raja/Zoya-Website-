import React from 'react';
import { Code2, Target, Cpu, RefreshCw } from 'lucide-react';

export const About: React.FC = () => {
  return (
    <section id="about" aria-label="About Zoya Project" className="py-16 sm:py-20 md:py-28 bg-[#04080c]/70 border-y border-teal-950/40 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 sm:gap-12 items-center">
          {/* Left Column: Story & Vision (col-span-7) */}
          <div className="lg:col-span-7 text-left">
            <div className="text-xs font-semibold tracking-wider uppercase text-teal-400 mb-2">
              Project Overview
            </div>
            <h2 className="text-2xl xs:text-3xl sm:text-4xl font-extrabold text-white tracking-tight text-balance">
              About Zoya AI Assistant
            </h2>

            <p className="mt-4 sm:mt-6 text-sm sm:text-base lg:text-lg text-slate-300 leading-relaxed">
              Zoya AI Assistant is an independent voice assistant project designed for Android devices.
              Created by <span className="text-teal-300 font-semibold">Riyajul</span>, the project began with a focused purpose:
              to make conversational AI interaction on mobile devices direct, responsive, and easy to control.
            </p>

            <p className="mt-3 sm:mt-4 text-xs sm:text-sm md:text-base text-slate-400 leading-relaxed">
              Zoya is currently an active, developing software project. Rather than functioning as a bloated portal with complicated sub-menus, Zoya focuses on the essentials: hands-free voice input, contextual multi-turn conversation, and customizable settings tailored to how you use your phone.
            </p>

            {/* Development Principles */}
            <div className="mt-6 sm:mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
              <div className="p-4 rounded-xl bg-[#08151b] border border-teal-950/90">
                <div className="flex items-center gap-2.5 text-white font-semibold text-sm mb-1.5">
                  <Target className="w-4 h-4 text-teal-400 shrink-0" aria-hidden="true" />
                  <span>Voice-First Focus</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Direct speech input and natural audio playback without needing to type queries manually.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#08151b] border border-teal-950/90">
                <div className="flex items-center gap-2.5 text-white font-semibold text-sm mb-1.5">
                  <Cpu className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
                  <span>Lightweight Android APK</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Engineered to run efficiently on standard Android hardware with minimal battery impact.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Grounded Development Status Card (col-span-5) */}
          <div className="lg:col-span-5 w-full">
            <div className="bg-[#071319] border border-teal-500/20 rounded-2xl p-4 sm:p-7 shadow-xl relative overflow-hidden">
              <div aria-hidden="true" className="absolute top-0 right-0 w-32 h-32 bg-teal-500/10 rounded-full blur-2xl pointer-events-none" />

              <div className="flex items-center gap-3 mb-5 sm:mb-6">
                <div className="w-10 h-10 rounded-xl bg-teal-950/80 border border-teal-500/30 flex items-center justify-center shrink-0">
                  <Code2 className="w-5 h-5 text-teal-300" aria-hidden="true" />
                </div>
                <div className="text-left">
                  <h3 className="text-base font-bold text-white">Project Status</h3>
                  <div className="text-xs text-slate-400">Active Development & Testing</div>
                </div>
              </div>

              <div className="space-y-3.5 text-xs text-slate-300 text-left">
                <div className="flex items-start gap-2.5 pb-3 border-b border-slate-800/80">
                  <div className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-1.5 shrink-0" />
                  <div>
                    <span className="font-semibold text-white">Active Development:</span> Testing speech accuracy, memory persistence, and audio drivers across Android versions.
                  </div>
                </div>

                <div className="flex items-start gap-2.5 pb-3 border-b border-slate-800/80">
                  <div className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-1.5 shrink-0" />
                  <div>
                    <span className="font-semibold text-white">User-Centric Privacy:</span> Settings are exposed so users have visibility into microphone access and saved session context.
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                  <div>
                    <span className="font-semibold text-white">Direct Releases:</span> Official APK releases will be published directly to this website upon verification.
                  </div>
                </div>
              </div>

              <div className="mt-5 sm:mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-teal-400" aria-hidden="true" />
                  Continuous Improvement
                </span>
                <span className="text-slate-400 font-mono text-[11px]">Android Project</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
