'use client';

import { useState, useCallback } from 'react';
import { TipModal } from './TipModal';

interface TipButtonProps {
  isAuthenticated?: boolean;
  tipperUserId?: string;
  tipperUsername?: string;
  djUserId?: string;      // DJ's Firebase UID - set at go-live (preferred)
  djEmail?: string;       // DJ's email - fallback only, may not match auth email
  djUsername: string;
  broadcastSlotId: string;
  showName: string;
  compact?: boolean;      // Deprecated: use size instead
  size?: 'small' | 'medium' | 'large';  // small for TV Guide, medium for chat, large for standalone
  disabled?: boolean;
  onRequireAuth?: () => void;
}

export function TipButton({
  tipperUserId,
  tipperUsername,
  djUserId,
  djEmail,
  djUsername,
  broadcastSlotId,
  showName,
  compact = false,
  size,
  disabled = false,
}: TipButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleClick = useCallback(() => {
    if (disabled) return;
    // Allow tipping for both authenticated and guest users
    setIsModalOpen(true);
  }, [disabled]);

  // Determine size: explicit size prop takes precedence, then compact flag, then default to large
  const effectiveSize = size || (compact ? 'small' : 'large');
  const sizeClasses = {
    small: { button: 'w-4 h-4', icon: 'w-3 h-3' },      // TV Guide cards
    medium: { button: 'w-6 h-6', icon: 'w-6 h-6' },    // Chat panel (matches heart)
    large: { button: 'w-12 h-12', icon: 'w-6 h-6' },   // Standalone
  };
  const buttonSize = sizeClasses[effectiveSize].button;
  const iconSize = sizeClasses[effectiveSize].icon;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`${buttonSize} flex items-center justify-center transition-all ${
          disabled
            ? 'text-gray-600 cursor-not-allowed'
            : 'text-green-400 hover:text-green-300 hover:scale-110'
        }`}
        title={`Tip ${djUsername}`}
      >
        <svg
          className={iconSize}
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
        </svg>
      </button>

      {isModalOpen && (
        <TipModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          djUsername={djUsername}
          djUserId={djUserId}
          djEmail={djEmail}
          broadcastSlotId={broadcastSlotId}
          showName={showName}
          tipperUserId={tipperUserId}
          tipperUsername={tipperUsername}
        />
      )}
    </>
  );
}
