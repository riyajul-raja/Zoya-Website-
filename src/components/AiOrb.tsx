import React, { useState } from 'react';
import { Mic, Volume2, Sparkles } from 'lucide-react';

export const AiOrb: React.FC = () => {
  const [orbState, setOrbState] = useState<'idle' | 'listening' | 'speaking'>('idle');

  return (
    <div className="relative flex flex-col items-center justify-center p-2 sm:p-6 select-none max-w-full">
      {/* Outer ambient glow */}
      <div 
        aria-hidden="true"
        className={`absolute w-56 h-56 sm:w-72 sm:h-72 rounded-full transition-all duration-700 blur-3xl pointer-events-none ${
          orbState === 'listening' 
            ? 'bg-teal-500/25 scale-110' 
            : orbState === 'speaking' 
              ? 'bg-cyan-500/30 scale-125' 
              : 'bg-teal-600/15'
        }`} 
      />

      {/* Main Orb Container - fully responsive */}
      <div className="relative w-52 h-52 sm:w-64 sm:h-64 md:w-72 md:h-72 flex items-center justify-center">
        {/* Orbital rings */}
        <div 
          aria-hidden="true"
          className="absolute inset-0 border border-teal-500/20 rounded-full animate-spin-slow pointer-events-none"
        >
          <div className="w-2 h-2 rounded-full bg-teal-400 absolute -top-1 left-1/2 -translate-x-1/2 shadow-[0_0_8px_#2dd4bf]" />
        </div>

        <div 
          aria-hidden="true"
          className="absolute inset-3 sm:inset-4 border border-cyan-500/15 rounded-full animate-spin-reverse-slow pointer-events-none"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 absolute bottom-0 left-1/3 shadow-[0_0_6px_#38bdf8]" />
        </div>

        {/* Outer Pulsing Waveform Ring */}
        <div 
          aria-hidden="true"
          className={`absolute inset-6 sm:inset-8 rounded-full border border-teal-400/30 transition-all duration-500 ${
            orbState !== 'idle' ? 'scale-105 border-teal-400/50' : 'animate-orb-pulse'
          }`}
        />

        {/* Glowing Core Sphere */}
        <button 
          type="button"
          aria-label={`Zoya voice assistant simulation in ${orbState} mode. Click to cycle modes.`}
          className="relative w-32 h-32 sm:w-40 sm:h-40 md:w-44 md:h-44 rounded-full flex items-center justify-center animate-orb-glow shadow-[inset_0_0_30px_rgba(20,184,166,0.5)] transition-transform duration-300 hover:scale-105 cursor-pointer focus-visible:outline-teal-400"
          style={{
            background: 'radial-gradient(circle at 35% 35%, #2dd4bf 0%, #0d9488 35%, #0f766e 60%, #042f2e 85%, #021a1b 100%)',
          }}
          onClick={() => {
            setOrbState((prev) => (prev === 'idle' ? 'listening' : prev === 'listening' ? 'speaking' : 'idle'));
          }}
        >
          {/* Internal Shimmer / Glass reflection */}
          <div 
            aria-hidden="true"
            className="absolute inset-2 rounded-full bg-gradient-to-tr from-transparent via-white/10 to-white/20 pointer-events-none opacity-70" 
          />

          {/* Soundwave bars (reactive visualizer in center) */}
          <div aria-hidden="true" className="relative z-10 flex items-center justify-center gap-1 sm:gap-1.5 h-10 sm:h-12">
            {[0.4, 0.8, 1, 0.7, 0.9, 0.5, 0.3].map((heightMultiplier, i) => {
              const activeScale = orbState === 'idle' 
                ? heightMultiplier * 0.4
                : orbState === 'listening' 
                  ? heightMultiplier * 0.85
                  : heightMultiplier * 1.25;

              return (
                <span
                  key={i}
                  className="w-0.75 sm:w-1 rounded-full bg-white transition-all duration-200 shadow-[0_0_8px_#ffffff]"
                  style={{
                    height: `${Math.max(6, activeScale * 26)}px`,
                    opacity: 0.85 + (i % 2) * 0.15,
                  }}
                />
              );
            })}
          </div>
        </button>
      </div>

      {/* Interactive State Bar - allows visitors to see how Zoya responds */}
      <div 
        role="group" 
        aria-label="Simulation voice state selectors"
        className="mt-4 flex flex-wrap items-center justify-center gap-1.5 p-1 bg-slate-900/95 border border-teal-500/20 rounded-xl text-xs backdrop-blur-md shadow-lg max-w-full"
      >
        <button
          type="button"
          aria-pressed={orbState === 'idle'}
          onClick={() => setOrbState('idle')}
          className={`flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg font-medium transition-all cursor-pointer ${
            orbState === 'idle'
              ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40 shadow-xs'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Idle</span>
        </button>

        <button
          type="button"
          aria-pressed={orbState === 'listening'}
          onClick={() => setOrbState('listening')}
          className={`flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg font-medium transition-all cursor-pointer ${
            orbState === 'listening'
              ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40 shadow-xs'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Mic className="w-3.5 h-3.5 text-teal-400" aria-hidden="true" />
          <span>Listening</span>
        </button>

        <button
          type="button"
          aria-pressed={orbState === 'speaking'}
          onClick={() => setOrbState('speaking')}
          className={`flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg font-medium transition-all cursor-pointer ${
            orbState === 'speaking'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Volume2 className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
          <span>Speaking</span>
        </button>
      </div>

      <div className="sr-only" aria-live="polite">
        Current assistant state: {orbState}
      </div>

      <p className="mt-2 text-[11px] text-slate-400 text-center max-w-xs">
        Interactive voice visualizer simulation · Select modes to preview
      </p>
    </div>
  );
};
