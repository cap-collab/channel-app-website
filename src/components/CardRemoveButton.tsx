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

  // Editorial × chip: white-on-near-black square, sharp corners, sized so
  // the touch target is generous (44px effective via padding) but the
  // visual chip is still subtle (28px). Hits Apple's HIG min tap size.
  return (
    <button
      onClick={handleClick}
      onTouchEnd={handleTouchEnd}
      // Suppress the surrounding link's mousedown/touch handlers so the
      // browser doesn't navigate before we can fire the click.
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      disabled={isRemoving}
      // Outer button has invisible padding for a bigger touch area; the
      // visible chip is the inner span.
      className="absolute -top-2 -right-2 z-20 p-2 disabled:opacity-50 touch-manipulation cursor-pointer"
      aria-label={ariaLabel}
      type="button"
    >
      <span
        className="flex items-center justify-center w-7 h-7 bg-black/85 border border-white/40 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black"
      >
        {isRemoving ? (
          <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
        ) : (
          <svg
            className="w-4 h-4 pointer-events-none"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        )}
      </span>
    </button>
  );
}
