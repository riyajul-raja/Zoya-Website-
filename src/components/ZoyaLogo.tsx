import React from 'react';

export const OFFICIAL_ZOYA_LOGO_SRC =
  '/assets/aistudio/file_00000000ad90820abfc4c8efc87b76f1_d848dfc1.png';

export type ZoyaLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface ZoyaLogoProps {
  size?: ZoyaLogoSize;
  showText?: boolean;
  className?: string;
  imgClassName?: string;
}

export const ZoyaLogo: React.FC<ZoyaLogoProps> = ({
  size = 'md',
  showText = true,
  className = '',
  imgClassName = '',
}) => {
  const sizeMap: Record<
    ZoyaLogoSize,
    { dimension: number; boxClass: string; textClass: string }
  > = {
    xs: {
      dimension: 28,
      boxClass: 'w-7 h-7',
      textClass: 'text-sm font-bold',
    },
    sm: {
      dimension: 36,
      boxClass: 'w-9 h-9',
      textClass: 'text-base font-bold',
    },
    md: {
      dimension: 42,
      boxClass: 'w-10 h-10 sm:w-[42px] sm:h-[42px]',
      textClass: 'text-lg font-bold',
    },
    lg: {
      dimension: 88,
      boxClass: 'w-20 h-20 sm:w-24 sm:h-24',
      textClass: 'text-2xl font-bold',
    },
    xl: {
      dimension: 112,
      boxClass: 'w-24 h-24 sm:w-28 sm:h-28',
      textClass: 'text-3xl font-bold',
    },
  };

  const current = sizeMap[size];

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <div
        className={`relative flex items-center justify-center shrink-0 aspect-square ${current.boxClass}`}
      >
        <img
          src={OFFICIAL_ZOYA_LOGO_SRC}
          alt="Zoya AI Assistant Logo"
          width={current.dimension}
          height={current.dimension}
          decoding="async"
          draggable={false}
          className={`w-full h-full object-contain select-none pointer-events-none ${imgClassName}`}
        />
      </div>

      {showText && (
        <span className={`tracking-tight text-zinc-900 whitespace-nowrap ${current.textClass}`}>
          Zoya <span className="text-pink-600 font-semibold">AI</span>
        </span>
      )}
    </div>
  );
};
