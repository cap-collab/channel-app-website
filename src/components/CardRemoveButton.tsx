'use client';

import { MouseEvent } from 'react';

interface CardRemoveButtonProps {
  onRemove: () => void | Promise<void>;
  isRemoving?: boolean;
  ariaLabel?: string;
}

// Small "x" overlay rendered top-right on a card. Click stops propagation so
// the underlying card click handler does not fire.
export function CardRemoveButton({
  onRemove,
  isRemoving = false,
  ariaLabel = 'Remove',
}: CardRemoveButtonProps) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onRemove();
  };

  return (
    <button
      onClick={handleClick}
      disabled={isRemoving}
      className="absolute top-2 right-2 z-20 p-1 rounded-full bg-black/50 transition-colors text-gray-400 hover:text-red-400 hover:bg-black/70 disabled:opacity-50"
      aria-label={ariaLabel}
    >
      {isRemoving ? (
        <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
      ) : (
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      )}
    </button>
  );
}
