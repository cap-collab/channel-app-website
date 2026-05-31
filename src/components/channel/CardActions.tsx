'use client';

import { useState, type MouseEvent } from 'react';
import Link from 'next/link';

// Shared action-button row used at the bottom of every card on /scene
// (watchlist, suggestions, BEYOND YOUR SCENE discovery) and home.
//
// Right button: always "See profile" → /dj/{username}
// Left button (priority order):
//   1. Tickets (when the card is an IRL event with a ticketUrl)
//   2. Join (when the show is live right now)
//        - Channel Radio: press play on home (link to /)
//        - external station: open the station's website
//   3. + Watchlist (when the DJ is not already followed)
//   4. Share (fallback: clipboard the DJ profile URL)

interface CardActionsProps {
  djUsername?: string;
  // IRL-only — when set, the left button becomes "Tickets" linking out
  // to the event ticket URL.
  ticketUrl?: string;
  // True when the show is live right now (LiveShowCard).
  isLive?: boolean;
  // The URL the "Join" button opens. For external stations this is the
  // station website; for Channel Radio (broadcast / dj-radio) this is
  // typically "/" so the user lands on the home player.
  joinUrl?: string;
  // True when the DJ is already on the user's watchlist (suppresses the
  // "+ Watchlist" left button → falls through to Share).
  isFollowing?: boolean;
  // Watchlist add handler. Called when the user taps "+ Watchlist".
  onAddToWatchlist?: () => void | Promise<void>;
  isAddingWatchlist?: boolean;
}

export function CardActions({
  djUsername,
  ticketUrl,
  isLive,
  joinUrl,
  isFollowing,
  onAddToWatchlist,
  isAddingWatchlist,
}: CardActionsProps) {
  const [copied, setCopied] = useState(false);
  const profileHref = djUsername ? `/dj/${djUsername}` : '#';

  const handleShare = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!djUsername) return;
    const url = `${window.location.origin}/dj/${djUsername}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  // Decide which left-button variant to render based on the priority order.
  let leftButton: React.ReactNode;
  if (ticketUrl) {
    leftButton = (
      <a
        href={ticketUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 min-w-0 py-1 px-1 md:px-4 md:py-2 rounded text-[10px] md:text-sm font-semibold leading-none transition-colors bg-white hover:bg-gray-100 text-gray-900 flex items-center justify-center gap-1 md:gap-2 whitespace-nowrap overflow-hidden"
      >
        Tickets
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </a>
    );
  } else if (isLive && joinUrl) {
    // External stations open in a new tab; Channel Radio (/) stays in-app.
    const external = /^https?:\/\//.test(joinUrl);
    leftButton = external ? (
      <a
        href={joinUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 min-w-0 py-1 px-1 md:px-4 md:py-2 rounded text-[10px] md:text-sm font-semibold leading-none transition-colors bg-white hover:bg-gray-100 text-gray-900 flex items-center justify-center gap-1 md:gap-2 whitespace-nowrap overflow-hidden"
      >
        Join
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </a>
    ) : (
      <Link
        href={joinUrl}
        className="flex-1 min-w-0 py-1 px-1 md:px-4 md:py-2 rounded text-[10px] md:text-sm font-semibold leading-none transition-colors bg-white hover:bg-gray-100 text-gray-900 flex items-center justify-center gap-1 md:gap-2 whitespace-nowrap overflow-hidden"
      >
        Join
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      </Link>
    );
  } else if (!isFollowing && onAddToWatchlist) {
    leftButton = (
      <button
        onClick={() => onAddToWatchlist()}
        disabled={isAddingWatchlist}
        className="flex-1 min-w-0 py-1 px-1 md:px-4 md:py-2 rounded text-[10px] md:text-sm font-semibold leading-none transition-colors bg-white hover:bg-gray-100 text-gray-900 flex items-center justify-center gap-0.5 md:gap-1 whitespace-nowrap overflow-hidden disabled:opacity-50"
      >
        {isAddingWatchlist ? (
          <div className="w-4 h-4 border-2 border-gray-900 border-t-transparent rounded-full animate-spin mx-auto" />
        ) : (
          <>
            <svg
              className="w-3 h-3 md:w-3.5 md:h-3.5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Watchlist
          </>
        )}
      </button>
    );
  } else {
    leftButton = (
      <button
        onClick={handleShare}
        disabled={!djUsername}
        className="flex-1 min-w-0 py-1 px-1 md:px-4 md:py-2 rounded text-[10px] md:text-sm font-semibold leading-none transition-colors bg-white hover:bg-gray-100 text-gray-900 flex items-center justify-center gap-1 whitespace-nowrap overflow-hidden disabled:opacity-50"
      >
        {copied ? 'Copied!' : 'Share'}
      </button>
    );
  }

  return (
    <div className="flex gap-1 md:gap-2">
      {leftButton}
      <Link
        href={profileHref}
        className="flex-1 min-w-0 py-1 px-1 md:px-4 md:py-2 rounded text-[10px] md:text-sm font-semibold leading-none transition-colors bg-white/10 hover:bg-white/20 text-white text-center whitespace-nowrap overflow-hidden"
      >
        See profile
      </Link>
    </div>
  );
}
