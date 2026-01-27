'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Show, Station } from '@/types';
import { TipButton } from './TipButton';
import { WatchlistModal } from '@/components/WatchlistModal';
import { AuthModal } from '@/components/AuthModal';
import { useFavorites } from '@/hooks/useFavorites';

interface ExpandedShowCardProps {
  show: Show;
  station: Station;
  isLive?: boolean;
  onClose: () => void;
  // Favorite functionality
  isFavorited: boolean;
  isTogglingFavorite: boolean;
  onToggleFavorite: (e: React.MouseEvent) => void;
  // Tip functionality
  canTip: boolean;
  isAuthenticated: boolean;
  tipperUserId?: string;
  tipperUsername?: string;
  // Time display
  timeDisplay: string;
}

export function ExpandedShowCard({
  show,
  station,
  isLive = false,
  onClose,
  isFavorited,
  isTogglingFavorite,
  onToggleFavorite,
  canTip,
  isAuthenticated,
  tipperUserId,
  tipperUsername,
  timeDisplay,
}: ExpandedShowCardProps) {
  const accentColor = station.accentColor || '#D94099';
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [showWatchlistModal, setShowWatchlistModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { addToWatchlist, isInWatchlist } = useFavorites();
  const [isAddingDirect, setIsAddingDirect] = useState(false);

  const handleImageError = (imageUrl: string) => {
    setFailedImages(prev => new Set(prev).add(imageUrl));
  };

  // Determine if we should skip the popup:
  // Only skip if there's exactly 1 DJ AND that DJ has an official profile (djUsername)
  const hasSingleDjWithProfile = show.dj && show.djUsername && !show.dj.includes(',') && !show.dj.includes('&');

  // Check if the DJ is already in watchlist (for direct add case)
  const djInWatchlist = show.dj ? isInWatchlist(show.dj) : false;

  const handleWatchlistClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (hasSingleDjWithProfile) {
      // Direct add without popup
      if (djInWatchlist) return;

      // Check authentication first
      if (!isAuthenticated) {
        setShowAuthModal(true);
        return;
      }

      setIsAddingDirect(true);
      await addToWatchlist(show.dj!, show.djUserId, show.djEmail);
      setIsAddingDirect(false);
    } else {
      // Show the modal (it handles auth internally)
      setShowWatchlistModal(true);
    }
  };

  // Build DJs list for the modal - parse from show.dj string
  const djsList = show.dj
    ? show.dj.split(/[,&]/).map((name) => ({
        name: name.trim(),
        userId: show.djUserId,
        email: show.djEmail,
      }))
    : [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 z-[100]"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      {/* Popup */}
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] border border-gray-700 rounded-xl p-5 max-w-md w-[90vw] max-h-[85vh] overflow-y-auto shadow-2xl"
        style={{ backgroundColor: '#121212' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top right: Favorite button + Close button */}
        <div className="absolute top-3 right-3 flex items-center gap-2">
          {/* Favorite button */}
          <button
            onClick={onToggleFavorite}
            disabled={isTogglingFavorite}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/15 transition-colors"
            style={{ color: accentColor }}
            title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
          >
            {isTogglingFavorite ? (
              <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg
                className="w-5 h-5"
                fill={isFavorited ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                />
              </svg>
            )}
          </button>
          {/* Close button */}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Show image + name header */}
        <div className="flex items-start gap-3 mb-3">
          {show.imageUrl && !failedImages.has(show.imageUrl) && (
            <Image
              src={show.imageUrl}
              alt={show.name}
              width={64}
              height={64}
              className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
              unoptimized
              onError={() => handleImageError(show.imageUrl!)}
            />
          )}
          <div className="flex-1 min-w-0 pr-16">
            <h3 className="text-white text-lg font-semibold mb-1">
              {show.name}
            </h3>
            {show.dj && (
              <p className="text-gray-400 text-sm">
                by {show.dj}
              </p>
            )}
          </div>
        </div>

        {/* Station & time */}
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
          <span>{station.name}</span>
          <span>•</span>
          <span>{timeDisplay}</span>
          {isLive && (
            <>
              <span>•</span>
              <span className="text-red-500 font-medium">LIVE</span>
            </>
          )}
        </div>

        {/* DJ Photo and Bio */}
        {((show.djPhotoUrl && !failedImages.has(show.djPhotoUrl)) || show.djBio) && (
          <div className="flex items-start gap-3 mb-4">
            {show.djPhotoUrl && !failedImages.has(show.djPhotoUrl) && (
              <Image
                src={show.djPhotoUrl}
                alt={show.dj || 'DJ'}
                width={64}
                height={64}
                className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                unoptimized
                onError={() => handleImageError(show.djPhotoUrl!)}
              />
            )}
            {show.djBio && (
              <p className="text-gray-300 text-sm">{show.djBio}</p>
            )}
          </div>
        )}

        {/* Description */}
        {show.description && (
          <p className="text-gray-400 text-sm leading-relaxed mb-4">{show.description}</p>
        )}

        {/* Promo section */}
        {show.promoText && (
          <div className="bg-gray-800/50 rounded-lg p-3 mb-4">
            <p className="text-gray-300 text-sm">{show.promoText}</p>
            {show.promoUrl && (
              <a
                href={show.promoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-sm hover:underline"
                style={{ color: accentColor }}
                onClick={(e) => e.stopPropagation()}
              >
                Learn more
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>
        )}

        {/* Actions - 3 buttons, smaller font, single line */}
        <div className="flex items-center gap-1.5 mt-5 pt-4 border-t border-gray-800 flex-nowrap">
          {/* 1. Add to Watchlist button - always shown */}
          <button
            onClick={handleWatchlistClick}
            disabled={isAddingDirect || !!(hasSingleDjWithProfile && djInWatchlist)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-xs disabled:opacity-60 whitespace-nowrap flex-shrink-0"
            style={{ color: (hasSingleDjWithProfile && djInWatchlist) ? undefined : accentColor }}
          >
            {isAddingDirect ? (
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (hasSingleDjWithProfile && djInWatchlist) ? (
              <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            ) : (
              <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            )}
            <span className={(hasSingleDjWithProfile && djInWatchlist) ? 'text-gray-400' : 'text-white'}>
              {(hasSingleDjWithProfile && djInWatchlist) ? 'Watching' : 'Watchlist'}
            </span>
          </button>

          {/* 2. View Profile button (accent color person icon, opens in new window) */}
          {show.djUsername && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.open(`/dj/${show.djUsername}`, '_blank', 'noopener,noreferrer');
              }}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-xs whitespace-nowrap flex-shrink-0"
            >
              <svg
                className="w-3 h-3 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                style={{ color: accentColor }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-white">Profile</span>
            </button>
          )}

          {/* 3. Tip button */}
          {canTip && (
            <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-xs whitespace-nowrap flex-shrink-0">
              <TipButton
                isAuthenticated={isAuthenticated}
                tipperUserId={tipperUserId}
                tipperUsername={tipperUsername}
                djUserId={show.djUserId}
                djEmail={show.djEmail}
                djUsername={show.dj!}
                broadcastSlotId={show.broadcastSlotId!}
                showName={show.name}
                size="medium"
              />
              <span className="text-white">Tip</span>
            </div>
          )}
        </div>
      </div>

      {/* Watchlist Modal */}
      <WatchlistModal
        isOpen={showWatchlistModal}
        onClose={() => setShowWatchlistModal(false)}
        showName={show.name}
        djs={djsList}
      />

      {/* Auth Modal - shown when user tries to add without being logged in */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message="Sign in to add to your watchlist"
      />
    </>
  );
}
