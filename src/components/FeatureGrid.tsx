import React, { useRef } from 'react';
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
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  useMotionValue,
  useSpring,
} from 'motion/react';
import { useFinePointer } from './LivingBackground';

interface FeatureCardItem {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

interface TiltFeatureCardProps {
  card: FeatureCardItem;
  index: number;
  shouldReduceMotion: boolean;
  enable3D: boolean;
}

const TiltFeatureCard: React.FC<TiltFeatureCardProps> = ({
  card,
  index,
  shouldReduceMotion,
  enable3D,
}) => {
  const Icon = card.icon;
  const rawRotateX = useMotionValue(0);
  const rawRotateY = useMotionValue(0);

  const rotateX = useSpring(rawRotateX, { stiffness: 220, damping: 22, mass: 0.5 });
  const rotateY = useSpring(rawRotateY, { stiffness: 220, damping: 22, mass: 0.5 });

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!enable3D || e.pointerType === 'touch') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const ny = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);

    const maxDeg = 4.5;
    rawRotateX.set(Math.max(-maxDeg, Math.min(maxDeg, -ny * maxDeg)));
    rawRotateY.set(Math.max(-maxDeg, Math.min(maxDeg, nx * maxDeg)));
  };

  const handlePointerLeave = () => {
    rawRotateX.set(0);
    rawRotateY.set(0);
  };

  return (
    <motion.article
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={
        enable3D
          ? {
              rotateX,
              rotateY,
              transformPerspective: 950,
            }
          : undefined
      }
      className="glass-card feature-card-hover rounded-2xl p-6 flex flex-col justify-start will-change-transform"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: false, amount: 0.15 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.5,
        delay: shouldReduceMotion ? 0 : (index % 4) * 0.07 + Math.floor(index / 4) * 0.1,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <div className="feature-icon-wrap w-11 h-11 rounded-xl bg-pink-50 border border-pink-200/70 flex items-center justify-center text-pink-600 mb-4 shrink-0">
        <Icon className="w-5 h-5" aria-hidden="true" />
      </div>

      <h3 className="text-base font-bold text-zinc-900 tracking-tight leading-snug">
        {card.title}
      </h3>

      <p className="mt-2 text-xs sm:text-sm text-zinc-600 leading-relaxed">
        {card.description}
      </p>
    </motion.article>
  );
};

export const FeatureGrid: React.FC = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const shouldReduceMotion = Boolean(useReducedMotion());
  const isFinePointer = useFinePointer();
  const enable3D = isFinePointer && !shouldReduceMotion;

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });
  const storyY = useTransform(scrollYProgress, [0, 0.5, 1], [22, 0, -22]);
  const storyScale = useTransform(scrollYProgress, [0, 0.18, 0.82, 1], [0.98, 1, 1, 0.98]);
  const storyOpacity = useTransform(scrollYProgress, [0, 0.12, 0.88, 1], [0.76, 1, 1, 0.8]);

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
    <section
      ref={sectionRef}
      id="features"
      aria-label="Zoya Capabilities"
      className="relative pb-14 sm:pb-20 -mt-4 sm:-mt-6 scroll-mt-20 sm:scroll-mt-24"
    >
      {/* Dynamic Section Atmospheric Blending */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 section-ambient-halo"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-20 -z-10 section-transition-bridge"
      />

      <motion.div
        className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8"
        style={
          shouldReduceMotion
            ? undefined
            : { y: storyY, scale: storyScale, opacity: storyOpacity }
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6">
          {cards.map((card, index) => (
            <TiltFeatureCard
              key={card.id}
              card={card}
              index={index}
              shouldReduceMotion={shouldReduceMotion}
              enable3D={enable3D}
            />
          ))}
        </div>
      </motion.div>
    </section>
  );
};
