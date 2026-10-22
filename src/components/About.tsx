import React from 'react';
import { Check, ShieldCheck } from 'lucide-react';

export const About: React.FC = () => {
  return (
    <section
      id="about"
      aria-label="About Zoya Project"
      className="py-14 sm:py-20"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="glass-card rounded-3xl p-6 sm:p-10 lg:p-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            {/* Left Column: Story & Purpose (col-span-7) */}
            <div className="lg:col-span-7 text-left">
              <div className="text-xs font-semibold text-pink-600 mb-2">
                About Zoya
              </div>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-zinc-900 tracking-tight text-balance">
                Thoughtfully engineered for everyday Android use.
              </h2>

              <p className="mt-4 text-sm sm:text-base text-zinc-600 leading-relaxed">
                Zoya AI Assistant is an independent voice assistant project for Android created by{' '}
                <span className="text-pink-600 font-semibold">Riyajul</span>. It was designed to make conversational AI on mobile devices fast, natural, and simple to control.
              </p>

              <p className="mt-3.5 text-sm sm:text-base text-zinc-600 leading-relaxed">
                Instead of cluttered menus or heavy background processes, Zoya focuses on what matters most: clear voice recognition, contextual dialogue, and transparent on-device preferences.
              </p>
            </div>

            {/* Right Column: Key Standards (col-span-5) */}
            <div className="lg:col-span-5 w-full">
              <div className="bg-pink-50/50 border border-pink-200/70 rounded-2xl p-5 sm:p-6 space-y-4 text-left">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-zinc-900">
                      Voice-First Simplicity
                    </h3>
                    <p className="text-xs sm:text-sm text-zinc-600 mt-0.5 leading-relaxed">
                      Hands-free speech input and natural audio responses without typing long prompts.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 pt-3 border-t border-pink-200/50">
                  <div className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-zinc-900">
                      Privacy-Conscious Permissions
                    </h3>
                    <p className="text-xs sm:text-sm text-zinc-600 mt-0.5 leading-relaxed">
                      Requests only microphone and network access — never your contacts, photos, or SMS.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 pt-3 border-t border-pink-200/50">
                  <div className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center shrink-0 mt-0.5">
                    <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-zinc-900">
                      Verified Direct Releases
                    </h3>
                    <p className="text-xs sm:text-sm text-zinc-600 mt-0.5 leading-relaxed">
                      Official Android builds are published directly here with SHA-256 verification.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
