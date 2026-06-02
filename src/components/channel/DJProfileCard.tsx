'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { DJProfile } from '@/types';
import { CardRemoveButton } from '@/components/CardRemoveButton';
import { SuggestedBanner, type SuggestionKind } from '@/components/channel/SuggestedCardBadge';
import { CardActions } from '@/components/channel/CardActions';

interface DJProfileCardProps {
  profile: DJProfile;
  isFollowing?: boolean;
  isAddingFollow?: boolean;
  onFollow?: () => void;
  matchLabel?: string;
  watchlistMode?: boolean;
  // Show a corner "x" to remove the card. When provided, the card renders
  // the standard CardRemoveButton overlay and forwards clicks here.
  onRemove?: () => void | Promise<void>;
  isRemoving?: boolean;
  // /scene SUGGESTED variant: the bridge DJ name displayed in the badge.
  // When set, the card forces a Suggested top-bar and surfaces the follow
  // CTA regardless of watchlistMode. `suggestionKind` chooses the wording:
  // 'crew' → "Affiliated with X", 'audience' → "Similar to X" (default).
  suggestionBridge?: string;
  suggestionKind?: SuggestionKind;
}

export function DJProfileCard({
  profile,
  isFollowing,
  isAddingFollow,
  onFollow,
  matchLabel,
  watchlistMode,
  onRemove,
  isRemoving,
  suggestionBridge,
  suggestionKind,
}: DJProfileCardProps) {
  const [imageError, setImageError] = useState(false);
  // Compact /scene layout when this card is a watchlist item or a suggestion.
  // Otherwise (BEYOND YOUR SCENE / home) use the original two-button row.
  const sceneLayout = watchlistMode || suggestionBridge !== undefined;

  const hasPhoto = profile.photoUrl && !imageError;
  const href = `/dj/${profile.username}`;

  const imageOverlays = (
    <>
      {/* Gradient scrims */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
      {/* DJ name, genre, city - bottom left */}
      <div className="absolute bottom-2 left-2 right-2">
        <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
          {profile.displayName}
        </span>
        {profile.genres && profile.genres.length > 0 && (
          <span className="block text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-300 drop-shadow-lg whitespace-nowrap overflow-hidden">
            {profile.genres.join(' · ')}
          </span>
        )}
      </div>
    </>
  );

  const imageContent = hasPhoto ? (
    <>
      <Image
        src={profile.photoUrl!}
        alt={profile.displayName}
        fill
        className="object-cover"
        unoptimized
        onError={() => setImageError(true)}
      />
      {imageOverlays}
    </>
  ) : (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-stone-800 to-amber-900">
      <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-white text-center px-4">
        {profile.displayName}
      </h2>
    </div>
  );

  return (
    <div className="w-full group flex flex-col h-full">
      {/* Match label row */}
      <div className="flex items-center mb-1 h-4 px-0.5">
        {matchLabel && (
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">
            {matchLabel}
          </span>
        )}
      </div>
      {/* SUGGESTED banner + "Similar to" caption stack above the image
          (only for /scene suggestions). Mobile shows the caption as its
          own line; desktop renders the attribution inline in the banner. */}
      {suggestionBridge !== undefined && <SuggestedBanner bridgeDjName={suggestionBridge} kind={suggestionKind} />}
      {/* Full width image with overlays */}
      <div className="relative">
        <Link href={href} className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10">
          {imageContent}
        </Link>
        {onRemove && (
          <CardRemoveButton
            onRemove={onRemove}
            isRemoving={isRemoving}
            ariaLabel={`Remove ${profile.displayName}`}
          />
        )}
        {/* Compact /scene mode: action icon overlays the image (matches the
            show cards' overlay slot for visual consistency across the grid). */}
        {sceneLayout && (
          <CardActions
            asOverlay
            djUsername={profile.username}
            isFollowing={isFollowing}
            onAddToWatchlist={onFollow}
            isAddingWatchlist={isAddingFollow}
          />
        )}
      </div>

      {sceneLayout ? (
        /* Compact /scene layout: info row only (action icon is overlaid above).
           Subtitle mirrors the show-card "Selected by …" line so DJ-profile
           cards in the suggestion row read consistently with show cards. */
        <div className="py-2 mt-auto">
          <h3 className="text-sm font-bold text-white leading-tight truncate">
            {profile.displayName}
          </h3>
          <p className="text-[10px] text-zinc-500 mt-0.5 uppercase truncate">
            Selected by Channel Radio
          </p>
        </div>
      ) : (
        /* Discovery layout: name + genres + 2-button row */
        <>
          <div className="flex flex-col justify-start py-2">
            <h3 className="text-sm font-bold leading-tight truncate">
              {profile.displayName}
            </h3>
            {profile.genres && profile.genres.length > 0 && (
              <p className="text-[10px] font-mono text-zinc-500 mt-0.5 uppercase tracking-tighter truncate">
                {profile.genres.join(' · ')}
              </p>
            )}
          </div>
          <div className="space-y-2 mt-auto">
            <div className="flex gap-2">
              <button
                onClick={onFollow}
                disabled={isAddingFollow}
                className={`flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors flex items-center justify-center gap-1 ${
                  isFollowing
                    ? 'bg-white/10 text-gray-400 cursor-default'
                    : 'bg-white hover:bg-gray-100 text-gray-900'
                } disabled:opacity-50`}
              >
                {isAddingFollow ? (
                  <div className={`w-4 h-4 border-2 ${isFollowing ? 'border-white' : 'border-gray-900'} border-t-transparent rounded-full animate-spin mx-auto`} />
                ) : isFollowing ? (
                  <><svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg> Watchlist</>
                ) : (
                  <><svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg> Watchlist</>
                )}
              </button>
              <Link
                href={href}
                className="flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white text-center"
              >
                See profile
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
