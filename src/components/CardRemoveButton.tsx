'use client';

import { MouseEvent, TouchEvent } from 'react';

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
  const trigger = () => {
    if (isRemoving) return;
    onRemove();
  };

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    trigger();
  };

  // On mobile (iOS especially), tapping a position-absolute button that
  // overlaps the card's <Link> often loses the click because Safari resolves
  // the tap to the link before React's synthetic click fires. Handling
  // touchend directly + preventDefault stops the click-through.
  const handleTouchEnd = (e: TouchEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    trigger();
  };

  return (
    <button
      onClick={handleClick}
      onTouchEnd={handleTouchEnd}
      // Suppress the surrounding link's mousedown/touch handlers so the
      // browser doesn't navigate before we can fire the click.
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      disabled={isRemoving}
      className="absolute top-2 right-2 z-20 p-1.5 rounded-full bg-red-500 shadow-lg ring-2 ring-white/20 text-white transition-colors hover:bg-red-600 disabled:opacity-50 touch-manipulation cursor-pointer"
      aria-label={ariaLabel}
      type="button"
    >
      {isRemoving ? (
        <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
      ) : (
        <svg
          className="w-4 h-4 pointer-events-none"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
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
