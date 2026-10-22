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
    sm: { icon: 28, text: 'text-base font-bold' },
    md: { icon: 34, text: 'text-lg font-bold' },
    lg: { icon: 42, text: 'text-2xl font-bold' },
    xl: { icon: 52, text: 'text-3xl font-bold' },
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
          className="relative z-10"
        >
          <defs>
            <linearGradient id="zoya-pink-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#db2777" />
              <stop offset="100%" stopColor="#f43f5e" />
            </linearGradient>
          </defs>

          {/* Frosted soft blush rounded container */}
          <rect
            x="2"
            y="2"
            width="36"
            height="36"
            rx="11"
            fill="#fdf2f8"
            stroke="#f9a8d4"
            strokeOpacity="0.65"
            strokeWidth="1.5"
          />

          {/* Crisp geometric Zoya mark in rose-pink */}
          <path
            d="M14 14.5H26L14 25.5H26"
            stroke="url(#zoya-pink-grad)"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {showText && (
        <span className={`tracking-tight text-zinc-900 whitespace-nowrap ${current.text}`}>
          Zoya <span className="text-pink-600 font-semibold">AI</span>
        </span>
      )}
    </div>
  );
};
