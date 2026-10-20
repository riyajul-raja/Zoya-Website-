import React from 'react';
import { 
  MessageSquareCode, 
  Mic, 
  Sliders, 
  BrainCircuit, 
  Settings2, 
  Smartphone,
  ChevronRight
} from 'lucide-react';

interface FeatureItem {
  id: string;
  title: string;
  shortDesc: string;
  detail: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  accentColor: string;
  tag: string;
}

export const Features: React.FC = () => {
  const features: FeatureItem[] = [
    {
      id: 'conversations',
      title: 'AI Conversations',
      shortDesc: 'Context-aware natural dialogue',
      detail:
        'Engage in multi-turn conversational exchanges that maintain context, answer complex queries, and reason step-by-step.',
      icon: MessageSquareCode,
      accentColor: 'text-teal-400',
      tag: 'Core Pipeline',
    },
    {
      id: 'voice',
      title: 'Voice Interaction',
      shortDesc: 'Hands-free voice recognition & speech synthesis',
      detail:
        'Speak directly to Zoya using Android microphone input, receiving clear audio responses with low-latency processing.',
      icon: Mic,
      accentColor: 'text-cyan-400',
      tag: 'Speech Engine',
    },
    {
      id: 'personalized',
      title: 'Personalized Experience',
      shortDesc: 'Tailored tone and assistant behavior',
      detail:
        'Adjust assistant personality, greeting styles, preferred response depth, and interaction pacing to match your daily workflow.',
      icon: Sliders,
      accentColor: 'text-emerald-400',
      tag: 'Customization',
    },
    {
      id: 'memory',
      title: 'Smart Memory',
      shortDesc: 'Continuous context and preference retention',
      detail:
        'Zoya maintains short-term conversational context and stores user-designated notes locally so you don’t have to repeat key details.',
      icon: BrainCircuit,
      accentColor: 'text-teal-300',
      tag: 'Context Store',
    },
    {
      id: 'settings',
      title: 'Assistant Settings',
      shortDesc: 'Comprehensive configuration controls',
      detail:
        'Fine-tune speech rate, voice pitch, audio input source, wake triggers, and data clear options with dedicated settings.',
      icon: Settings2,
      accentColor: 'text-cyan-300',
      tag: 'User Controls',
    },
    {
      id: 'mobile',
      title: 'Mobile-Friendly Experience',
      shortDesc: 'Optimized for Android device performance',
      detail:
        'Constructed specifically as an Android application with minimal memory overhead, responsive touch controls, and clean UI.',
      icon: Smartphone,
      accentColor: 'text-teal-400',
      tag: 'Android Native',
    },
  ];

  return (
    <section id="features" aria-label="Zoya Capabilities" className="py-16 sm:py-20 md:py-28 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="max-w-2xl text-left mb-10 sm:mb-14">
          <div className="text-xs font-semibold tracking-wider uppercase text-teal-400 mb-2">
            Capabilities & Architecture
          </div>
          <h2 className="text-2xl xs:text-3xl sm:text-4xl font-extrabold text-white tracking-tight text-balance">
            Designed for intuitive, voice-first interaction
          </h2>
          <p className="mt-3 sm:mt-4 text-slate-300 text-sm sm:text-base lg:text-lg leading-relaxed">
            Every feature in Zoya is built around conversational utility — enabling direct speech,
            reliable context handling, and configurable Android controls.
          </p>
        </div>

        {/* Feature Cards Grid (Mobile-first responsive grid) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.id}
                className="group relative bg-[#071319]/80 hover:bg-[#0a1b24] border border-teal-950/90 hover:border-teal-500/40 rounded-2xl p-4.5 sm:p-6 lg:p-7 transition-all duration-300 flex flex-col justify-between shadow-xs hover:shadow-[0_4px_25px_rgba(20,184,166,0.12)] hover:-translate-y-0.5"
              >
                {/* Top content */}
                <div>
                  <div className="flex items-center justify-between mb-3.5 sm:mb-5">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-teal-950/60 border border-teal-500/20 flex items-center justify-center group-hover:scale-105 group-hover:border-teal-400/40 transition-all duration-300">
                      <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${feature.accentColor}`} aria-hidden="true" />
                    </div>
                    {/* Clean unboxed category identifier */}
                    <span className="text-[11px] sm:text-xs font-medium text-slate-400 group-hover:text-slate-300 transition-colors">
                      {feature.tag}
                    </span>
                  </div>

                  <h3 className="text-base sm:text-lg lg:text-xl font-bold text-white tracking-tight group-hover:text-teal-200 transition-colors">
                    {feature.title}
                  </h3>

                  <p className="mt-1 text-xs font-medium text-teal-400/90">
                    {feature.shortDesc}
                  </p>

                  <p className="mt-2.5 sm:mt-3 text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {feature.detail}
                  </p>
                </div>

                {/* Bottom subtle anchor */}
                <div className="mt-5 sm:mt-6 pt-3.5 sm:pt-4 border-t border-slate-800/60 flex items-center text-xs font-medium text-slate-400 group-hover:text-teal-300 transition-colors">
                  <span>Android Client Feature</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};
