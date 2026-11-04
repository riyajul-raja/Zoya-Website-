import React, { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useReducedMotion } from 'motion/react';

/**
 * Detects whether the current device supports fine pointer hover interactions.
 * Returns false on touch-only mobile/tablet devices.
 */
export function useFinePointer(): boolean {
  const [isFinePointer, setIsFinePointer] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(hover: hover) and (pointer: fine)');
    setIsFinePointer(mql.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setIsFinePointer(e.matches);
    };

    if (mql.addEventListener) {
      mql.addEventListener('change', handleChange);
      return () => mql.removeEventListener('change', handleChange);
    }
  }, []);

  return isFinePointer;
}

interface MagneticProps {
  children: React.ReactNode;
  className?: string;
  strength?: number;
}

/**
 * Subtle spring-based magnetic cursor wrapper for CTA buttons and interactive elements.
 * Automatically disabled on touch devices and when prefers-reduced-motion is enabled.
 */
export const MagneticWrapper: React.FC<MagneticProps> = ({
  children,
  className = '',
  strength = 0.22,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const isFinePointer = useFinePointer();
  const enabled = isFinePointer && !shouldReduceMotion;

  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);

  const x = useSpring(rawX, { stiffness: 220, damping: 20, mass: 0.5 });
  const y = useSpring(rawY, { stiffness: 220, damping: 20, mass: 0.5 });

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || !ref.current || e.pointerType === 'touch') return;
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = (e.clientX - centerX) * strength;
    const deltaY = (e.clientY - centerY) * strength;

    const maxOffset = 7;
    rawX.set(Math.max(-maxOffset, Math.min(maxOffset, deltaX)));
    rawY.set(Math.max(-maxOffset, Math.min(maxOffset, deltaY)));
  };

  const handlePointerLeave = () => {
    rawX.set(0);
    rawY.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={enabled ? { x, y } : undefined}
      className={className}
    >
      {children}
    </motion.div>
  );
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  phase: number;
  color: string;
}

/**
 * Lightweight animated particle and flowing-light ambient background.
 * - Uses a restrained particle count (10 on mobile/low-core Android, 20 on desktop).
 * - Pauses completely when document.hidden is true.
 * - Renders a static subtle ambient glow when prefers-reduced-motion is enabled.
 * - Never blocks pointer events or reduces text readability.
 */
export const LivingBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || shouldReduceMotion) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let animationFrameId: number | null = null;
    let isPageVisible = !document.hidden;
    let width = window.innerWidth;
    let height = window.innerHeight;

    const isLowPowerOrMobile =
      width < 768 || (typeof navigator !== 'undefined' && (navigator.hardwareConcurrency || 4) <= 4);
    const particleCount = isLowPowerOrMobile ? 11 : 20;

    const palette = [
      '236, 72, 153',  // pink-500
      '244, 114, 182', // pink-400
      '251, 113, 133', // rose-400
    ];

    const setCanvasSize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    setCanvasSize();

    const particles: Particle[] = Array.from({ length: particleCount }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.22,
      vy: -0.1 - Math.random() * 0.18,
      radius: 1.4 + (i % 3) * 0.85,
      alpha: 0.12 + (i % 4) * 0.045,
      phase: Math.random() * Math.PI * 2,
      color: palette[i % palette.length],
    }));

    let time = 0;

    const renderFrame = () => {
      if (!isPageVisible) {
        animationFrameId = null;
        return;
      }

      time += 0.008;
      ctx.clearRect(0, 0, width, height);

      // Subtle flowing light ribbon 1
      const light1X = width * (0.28 + Math.sin(time * 0.7) * 0.08);
      const light1Y = height * (0.24 + Math.cos(time * 0.5) * 0.06);
      const grad1 = ctx.createRadialGradient(
        light1X,
        light1Y,
        10,
        light1X,
        light1Y,
        Math.max(width, height) * 0.36
      );
      grad1.addColorStop(0, 'rgba(244, 114, 182, 0.065)');
      grad1.addColorStop(0.5, 'rgba(251, 113, 133, 0.03)');
      grad1.addColorStop(1, 'rgba(253, 248, 250, 0)');
      ctx.fillStyle = grad1;
      ctx.fillRect(0, 0, width, height);

      // Subtle flowing light ribbon 2
      const light2X = width * (0.72 + Math.cos(time * 0.6) * 0.08);
      const light2Y = height * (0.68 + Math.sin(time * 0.45) * 0.06);
      const grad2 = ctx.createRadialGradient(
        light2X,
        light2Y,
        10,
        light2X,
        light2Y,
        Math.max(width, height) * 0.34
      );
      grad2.addColorStop(0, 'rgba(236, 72, 153, 0.05)');
      grad2.addColorStop(0.55, 'rgba(244, 114, 182, 0.025)');
      grad2.addColorStop(1, 'rgba(253, 248, 250, 0)');
      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, width, height);

      // Soft floating particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx + Math.sin(time + p.phase) * 0.08;
        p.y += p.vy;

        if (p.y < -12) p.y = height + 12;
        if (p.y > height + 12) p.y = -12;
        if (p.x < -12) p.x = width + 12;
        if (p.x > width + 12) p.x = -12;

        const pulseAlpha = p.alpha * (0.78 + 0.22 * Math.sin(time * 1.6 + p.phase));

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${pulseAlpha.toFixed(3)})`;
        ctx.fill();
      }

      animationFrameId = window.requestAnimationFrame(renderFrame);
    };

    const startLoop = () => {
      if (animationFrameId === null && isPageVisible) {
        animationFrameId = window.requestAnimationFrame(renderFrame);
      }
    };

    const stopLoop = () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    };

    const handleVisibilityChange = () => {
      isPageVisible = !document.hidden;
      if (isPageVisible) {
        startLoop();
      } else {
        stopLoop();
      }
    };

    let resizeTimer: number | null = null;
    const handleResize = () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        setCanvasSize();
      }, 150);
    };

    startLoop();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', handleResize, { passive: true });

    return () => {
      stopLoop();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', handleResize);
    };
  }, [shouldReduceMotion]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
    >
      {!shouldReduceMotion && (
        <canvas
          ref={canvasRef}
          className="w-full h-full block opacity-90"
        />
      )}
    </div>
  );
};
