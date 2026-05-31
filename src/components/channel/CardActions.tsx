'use client';

import { useState, type MouseEvent } from 'react';
import Link from 'next/link';

// Single bottom-right icon button rendered on every /scene card. The icon
// reflects the priority action chain:
//   1. Tickets    (IRL event with ticketUrl)
//   2. Join       (show is live now)
//   3. + Watchlist (DJ isn't already followed)
//   4. Share       (fallback)
// Tapping the card image already opens the DJ profile, so there's no
// separate "See profile" affordance here.

interface CardActionsProps {
  djUsername?: string;
  ticketUrl?: string;
  isLive?: boolean;
  joinUrl?: string;
  isFollowing?: boolean;
  onAddToWatchlist?: () => void | Promise<void>;
  isAddingWatchlist?: boolean;
}

const iconClass = 'w-3.5 h-3.5 pointer-events-none';
const buttonClass =
  'inline-flex items-center justify-center w-7 h-7 bg-white text-black hover:bg-gray-100 transition-colors disabled:opacity-50';

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

  const handleShare = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
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
        {/* External-link icon */}
        <svg className={iconClass} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
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
          <div className="w-3.5 h-3.5 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
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
  } else {
    action = (
      <button
        type="button"
        onClick={handleShare}
        disabled={!djUsername}
        className={buttonClass}
        aria-label={copied ? 'Copied' : 'Share'}
        title={copied ? 'Copied' : 'Share'}
      >
        {copied ? (
          <svg className={iconClass} fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className={iconClass} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M16 6l-4-4m0 0L8 6m4-4v13"
            />
          </svg>
        )}
      </button>
    );
  }

  return <div className="flex justify-end">{action}</div>;
}
