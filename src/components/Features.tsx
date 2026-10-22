import React from 'react';
import {
  MessageSquareCode,
  Mic,
  Sliders,
  BrainCircuit,
  Settings2,
  Smartphone,
} from 'lucide-react';

interface FeatureItem {
  id: string;
  title: string;
  detail: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

export const Features: React.FC = () => {
  const features: FeatureItem[] = [
    {
      id: 'conversations',
      title: 'AI Conversations',
      detail:
        'Engage in natural, multi-turn dialogue that keeps context and answers complex questions clearly.',
      icon: MessageSquareCode,
    },
    {
      id: 'voice',
      title: 'Voice Interaction',
      detail:
        'Speak directly using your Android microphone and hear clear, responsive spoken answers hands-free.',
      icon: Mic,
    },
    {
      id: 'personalized',
      title: 'Personalized Experience',
      detail:
        'Tailor assistant tone, response depth, and interaction pacing to fit your everyday workflow.',
      icon: Sliders,
    },
    {
      id: 'memory',
      title: 'Smart Memory',
      detail:
        'Retain conversational context and user-saved notes locally so you never have to repeat key details.',
      icon: BrainCircuit,
    },
    {
      id: 'settings',
      title: 'Assistant Settings',
      detail:
        'Adjust speech rate, voice pitch, audio input, and session data from a clean settings panel.',
      icon: Settings2,
    },
    {
      id: 'mobile',
      title: 'Mobile-Friendly Design',
      detail:
        'Engineered specifically for Android smartphones and tablets with fast startup and low battery use.',
      icon: Smartphone,
    },
  ];

  return (
    <section
      id="features"
      aria-label="Zoya Capabilities"
      className="py-14 sm:py-20"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="max-w-2xl mx-auto text-center mb-10 sm:mb-14">
          <div className="text-xs font-semibold text-pink-600 mb-2">
            Core Capabilities
          </div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-zinc-900 tracking-tight text-balance">
            Built for effortless voice interaction
          </h2>
          <p className="mt-3 text-zinc-600 text-sm sm:text-base leading-relaxed">
            Every feature in Zoya focuses on clear spoken communication, reliable context, and simple mobile controls.
          </p>
        </div>

        {/* Clean Frosted-Glass Feature Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.id}
                className="glass-card rounded-2xl p-6 sm:p-7 transition-all duration-150 hover:border-pink-300/80"
              >
                <div className="w-11 h-11 rounded-xl bg-pink-50 border border-pink-200/70 flex items-center justify-center text-pink-600 mb-5">
                  <Icon className="w-5 h-5" aria-hidden="true" />
                </div>

                <h3 className="text-lg font-bold text-zinc-900 tracking-tight">
                  {feature.title}
                </h3>

                <p className="mt-2.5 text-sm text-zinc-600 leading-relaxed">
                  {feature.detail}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};
