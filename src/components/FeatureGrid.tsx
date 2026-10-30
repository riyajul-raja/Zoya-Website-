import React from 'react';
import {
  Mic,
  MessageCircle,
  Smartphone,
  Zap,
  Globe,
  UserCheck,
  Workflow,
  BrainCircuit,
} from 'lucide-react';

interface FeatureCardItem {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

export const FeatureGrid: React.FC = () => {
  const cards: FeatureCardItem[] = [
    {
      id: 'real-time-voice',
      title: 'Real-Time Voice',
      description:
        'Talk to Zoya like a person, in English or Hindi. Interrupt mid-sentence and Zoya stops speaking and listens.',
      icon: Mic,
    },
    {
      id: 'whatsapp-integration',
      title: 'WhatsApp & WhatsApp Business',
      description:
        'Messages, chats read aloud, photos and files, voice and video calls — on both apps.',
      icon: MessageCircle,
    },
    {
      id: 'phone-control',
      title: 'Full Phone Control',
      description:
        'Opens apps, taps, types and swipes. Torch, brightness, volume, hotspot, silent mode and screen lock.',
      icon: Smartphone,
    },
    {
      id: 'wake-word-sleep',
      title: 'Wake Word & Sleep',
      description:
        '"Hey Zoya" wakes it, "Bye Zoya" sends it to sleep — recognized offline and ready right after a reboot.',
      icon: Zap,
    },
    {
      id: 'deep-research',
      title: 'Deep Research',
      description:
        'Ask a real question and Zoya researches the web, reads relevant pages and returns with an answer and its sources.',
      icon: Globe,
    },
    {
      id: 'memory-that-lasts',
      title: 'Memory That Lasts',
      description:
        'Remembers your people, preferences and how you like things done — not just the current conversation.',
      icon: UserCheck,
    },
    {
      id: 'teach-routines',
      title: 'Teach It Routines',
      description:
        'Perform a multi-step task once, save it as a routine or macro, then run the whole task with one command.',
      icon: Workflow,
    },
    {
      id: 'long-term-memory',
      title: 'Long-Term Memory',
      description:
        "Zoya builds on information saved across conversations, connecting important details, past context and preferences over time so you don't have to explain everything again.",
      icon: BrainCircuit,
    },
  ];

  return (
    <section id="features" aria-label="Zoya Capabilities" className="pb-14 sm:pb-20 -mt-4 sm:-mt-6 scroll-mt-20 sm:scroll-mt-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <article
                key={card.id}
                className="glass-card rounded-2xl p-6 transition-all duration-150 hover:border-pink-300/80 flex flex-col justify-start"
              >
                <div className="w-11 h-11 rounded-xl bg-pink-50 border border-pink-200/70 flex items-center justify-center text-pink-600 mb-4 shrink-0">
                  <Icon className="w-5 h-5" aria-hidden="true" />
                </div>

                <h3 className="text-base font-bold text-zinc-900 tracking-tight leading-snug">
                  {card.title}
                </h3>

                <p className="mt-2 text-xs sm:text-sm text-zinc-600 leading-relaxed">
                  {card.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};
