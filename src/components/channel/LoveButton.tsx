'use client';

import { useState, useCallback } from 'react';
import { FloatingHearts } from './FloatingHearts';
import { useListenerChat } from '@/hooks/useListenerChat';

interface LoveButtonProps {
  isAuthenticated: boolean;
  username?: string;
  showName?: string;
  compact?: boolean;
  disabled?: boolean;
  onRequireAuth?: () => void;
}

export function LoveButton({
  isAuthenticated,
  username,
  showName,
  compact = false,
  disabled = false,
  onRequireAuth,
}: LoveButtonProps) {
  const [trigger, setTrigger] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const { sendLove } = useListenerChat({ username });

  const handleClick = useCallback(async () => {
    if (disabled) return;

    if (!isAuthenticated) {
      onRequireAuth?.();
      return;
    }

    // Trigger animation
    setTrigger((prev) => prev + 1);
    setIsAnimating(true);

    // Send love reaction
    try {
      await sendLove(showName);
    } catch (err) {
      console.error('Failed to send love:', err);
    }

    // Reset animation
    setTimeout(() => setIsAnimating(false), 300);
  }, [disabled, isAuthenticated, onRequireAuth, sendLove, showName]);

  const buttonSize = compact ? 'w-10 h-10' : 'w-12 h-12';
  const iconSize = compact ? 'w-5 h-5' : 'w-6 h-6';

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`${buttonSize} flex items-center justify-center transition-all ${
          disabled
            ? 'text-gray-600 cursor-not-allowed'
            : 'text-accent hover:text-accent-hover'
        } ${isAnimating ? 'scale-125' : 'scale-100'}`}
      >
        <svg
          className={iconSize}
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      </button>

      <FloatingHearts trigger={trigger} />
    </div>
  );
}
