import React from 'react';

interface ZoyaLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

export const ZoyaLogo: React.FC<ZoyaLogoProps> = ({
  size = 'md',
  showText = true,
  className = '',
}) => {
  const sizeMap = {
    sm: { icon: 26, text: 'text-base font-bold' },
    md: { icon: 34, text: 'text-lg font-bold' },
    lg: { icon: 44, text: 'text-2xl font-extrabold' },
    xl: { icon: 60, text: 'text-3xl font-extrabold' },
  };

  const current = sizeMap[size];

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <div className="relative flex items-center justify-center shrink-0">
        <svg
          width={current.icon}
          height={current.icon}
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative z-10 transition-transform duration-300 hover:scale-105"
        >
          {/* Outer subtle orbital ring */}
          <circle
            cx="20"
            cy="20"
            r="18"
            stroke="url(#zoya-outer-grad)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
            strokeOpacity="0.75"
          />

          {/* Glowing background pill */}
          <circle cx="20" cy="20" r="14" fill="#07181d" stroke="#134e4a" strokeWidth="1" />

          {/* Acoustic wave rings */}
          <circle
            cx="20"
            cy="20"
            r="10"
            stroke="url(#zoya-cyan-grad)"
            strokeWidth="1.5"
            strokeOpacity="0.85"
          />

          {/* Stylized geometric Z waveform mark */}
          <path
            d="M15 14.5H25L15 25.5H25"
            stroke="url(#zoya-cyan-grad)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Center glowing micro-node */}
          <circle cx="20" cy="20" r="2" fill="#22d3ee" />

          <defs>
            <linearGradient id="zoya-outer-grad" x1="2" y1="2" x2="38" y2="38" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#14b8a6" />
              <stop offset="100%" stopColor="#0891b2" />
            </linearGradient>
            <linearGradient id="zoya-cyan-grad" x1="12" y1="12" x2="28" y2="28" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#2dd4bf" />
              <stop offset="50%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#38bdf8" />
            </linearGradient>
          </defs>
        </svg>

        {/* Soft background glow */}
        <div className="absolute inset-0 bg-teal-500/20 blur-md rounded-full pointer-events-none" />
      </div>

      {showText && (
        <span className={`tracking-tight text-white whitespace-nowrap ${current.text}`}>
          Zoya <span className="text-teal-400 font-semibold">AI</span>
        </span>
      )}
    </div>
  );
};
