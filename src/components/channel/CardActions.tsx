'use client';

import Link from 'next/link';

// Single bottom-right icon button rendered on every /scene card. The icon
// reflects the priority action chain:
//   1. Tickets       (IRL event with ticketUrl)
//   2. Join          (show is live now)
//   3. + Watchlist   (DJ isn't already followed)
//   4. View profile  (fallback — DJ already on watchlist, no live show,
//                     no event tickets)

interface CardActionsProps {
  djUsername?: string;
  ticketUrl?: string;
  isLive?: boolean;
  joinUrl?: string;
  isFollowing?: boolean;
  onAddToWatchlist?: () => void | Promise<void>;
  isAddingWatchlist?: boolean;
  // When true, render the action as an absolute bottom-right overlay
  // sized like the old station-logo badge. Caller's parent must be
  // position: relative.
  asOverlay?: boolean;
}

// Editorial frosted-glass action chip:
//   - 6x6 (24px) — ~15% smaller than the previous 7x7 (28px), reads as a
//     subtle utility rather than a primary CTA.
//   - Semi-transparent white fill with backdrop blur so the artwork colors
//     show through. Thin white border, square corners, white icon.
const iconClass = 'w-3 h-3 pointer-events-none';
const buttonBase =
  'inline-flex items-center justify-center w-6 h-6 bg-white/10 hover:bg-white/20 text-white border border-white/30 backdrop-blur-md transition-colors disabled:opacity-50';
const overlayPos = 'absolute bottom-2 right-2 z-10';

export function CardActions({
  djUsername,
  ticketUrl,
  isLive,
  joinUrl,
  isFollowing,
  onAddToWatchlist,
  isAddingWatchlist,
  asOverlay,
}: CardActionsProps) {
  const buttonClass = asOverlay ? `${buttonBase} ${overlayPos}` : buttonBase;

  let action: React.ReactNode;
  if (ticketUrl) {
    action = (
      <a
        href={ticketUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass}
        aria-label="Tickets"
        title="Tickets"
      >
        {/* Ticket icon — stub-shaped paper with a notch + barcode line */}
        <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24">
          <path d="M2 9a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4V9zm14.5 0v6h1.5v-6h-1.5z" />
        </svg>
      </a>
    );
  } else if (isLive && joinUrl) {
    const external = /^https?:\/\//.test(joinUrl);
    const playIcon = (
      <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24">
        <path d="M8 5v14l11-7z" />
      </svg>
    );
    action = external ? (
      <a
        href={joinUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass}
        aria-label="Join"
        title="Join"
      >
        {playIcon}
      </a>
    ) : (
      <Link href={joinUrl} className={buttonClass} aria-label="Join" title="Join">
        {playIcon}
      </Link>
    );
  } else if (!isFollowing && onAddToWatchlist) {
    action = (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAddToWatchlist();
        }}
        disabled={isAddingWatchlist}
        className={buttonClass}
        aria-label="Add to watchlist"
        title="Add to watchlist"
      >
        {isAddingWatchlist ? (
          <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg
            className={iconClass}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        )}
      </button>
    );
  } else if (djUsername) {
    // Fallback: open the DJ profile. The card image is also a link to the
    // profile, but a tappable icon here makes the action explicit on the
    // bottom-right corner of every card.
    action = (
      <Link
        href={`/dj/${djUsername}`}
        className={buttonClass}
        aria-label="View profile"
        title="View profile"
      >
        <svg className={iconClass} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      </Link>
    );
  } else {
    action = null;
  }

  if (asOverlay) return <>{action}</>;
  return <div className="flex justify-end">{action}</div>;
}
