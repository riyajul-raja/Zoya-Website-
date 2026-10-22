import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ZoyaLogo } from './ZoyaLogo';

interface ZoyaBrandLinkProps {
  onAdminTrigger: () => void;
  onNormalClick?: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
  href?: string;
}

export const ZoyaBrandLink: React.FC<ZoyaBrandLinkProps> = ({
  onAdminTrigger,
  onNormalClick,
  size = 'md',
  showText = true,
  className = '',
  href = '#hero',
}) => {
  const [isPressing, setIsPressing] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const didTriggerRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const LONG_PRESS_DURATION = 2000; // 2 seconds

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsPressing(false);
  }, []);

  const startPress = useCallback(() => {
    clearTimer();
    didTriggerRef.current = false;
    setIsPressing(true);

    timerRef.current = setTimeout(() => {
      didTriggerRef.current = true;
      setIsPressing(false);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(50);
        } catch (e) {
          // Ignore
        }
      }
      onAdminTrigger();
    }, LONG_PRESS_DURATION);
  }, [clearTimer, onAdminTrigger]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  // Global keyboard shortcut (Alt + Shift + A) for accessible desktop administrator access
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        onAdminTrigger();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [onAdminTrigger]);

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only primary left click
    startPress();
  };

  const handleMouseUp = () => {
    clearTimer();
  };

  const handleMouseLeave = () => {
    clearTimer();
  };

  // Touch handlers for Android and mobile screens
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartPosRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      startPress();
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartPosRef.current && e.touches.length === 1) {
      const dx = e.touches[0].clientX - touchStartPosRef.current.x;
      const dy = e.touches[0].clientY - touchStartPosRef.current.y;
      // If user moves finger more than 10px, cancel long-press (they are scrolling)
      if (Math.hypot(dx, dy) > 10) {
        clearTimer();
        touchStartPosRef.current = null;
      }
    }
  };

  const handleTouchEnd = () => {
    clearTimer();
    touchStartPosRef.current = null;
  };

  const handleTouchCancel = () => {
    clearTimer();
    touchStartPosRef.current = null;
  };

  // Keyboard support: holding Space or Enter for 2 seconds
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (!e.repeat) {
        startPress();
      }
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      clearTimer();
      if (!didTriggerRef.current) {
        e.preventDefault();
        if (onNormalClick) {
          onNormalClick();
        } else {
          const el = document.querySelector(href);
          if (el) el.scrollIntoView({ behavior: 'smooth' });
        }
      }
      didTriggerRef.current = false;
    }
  };

  // Click handler
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (didTriggerRef.current) {
      // Long-press was triggered: suppress standard click/scroll
      didTriggerRef.current = false;
      return;
    }
    // Normal tap action
    if (onNormalClick) {
      onNormalClick();
    } else {
      const element = document.querySelector(href);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onContextMenu={(e) => {
        // Prevent default long-press context menu on Android and desktop
        e.preventDefault();
        return false;
      }}
      className={`group relative flex items-center whitespace-nowrap shrink-0 rounded-md focus-visible:outline-pink-600 py-1 select-none transition-transform duration-150 cursor-pointer ${
        isPressing ? 'scale-[0.98]' : ''
      } ${className}`}
      style={{
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
      aria-label="Zoya AI Assistant Home"
      title="Zoya AI Assistant"
    >
      <ZoyaLogo size={size} showText={showText} />

      {/* Subtle feedback during hold (active only while pressing, invisible otherwise) */}
      {isPressing && (
        <span
          aria-hidden="true"
          className="absolute -inset-1.5 rounded-xl border border-pink-400/50 pointer-events-none"
        />
      )}
    </a>
  );
};
