'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { DJProfile } from '@/types';
import { CardRemoveButton } from '@/components/CardRemoveButton';
import { SuggestedBanner, SuggestedBridgeOverlay } from '@/components/channel/SuggestedCardBadge';
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
  // /scene SUGGESTED variant: the bridge DJ name displayed in the badge
  // ("Similar to {bridgeDjName}"). When set, the card forces a Suggested
  // top-bar and surfaces the follow CTA regardless of watchlistMode.
  suggestionBridge?: string;
}

export function DJProfileCard({
  profile,
  isFollowing,
  isAddingFollow,
  onFollow,
  matchLabel,
  // watchlistMode is still accepted for back-compat but no longer affects
  // rendering — CardActions now drives the button row uniformly.
  onRemove,
  isRemoving,
  suggestionBridge,
}: DJProfileCardProps) {
  const [imageError, setImageError] = useState(false);

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
      {/* SUGGESTED banner above the card (only for /scene suggestions) */}
      {suggestionBridge !== undefined && <SuggestedBanner bridgeDjName={suggestionBridge} />}
      {/* Full width image with overlays */}
      <div className="relative">
        <Link href={href} className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10">
          {imageContent}
          {suggestionBridge !== undefined && <SuggestedBridgeOverlay bridgeDjName={suggestionBridge} />}
        </Link>
        {onRemove && (
          <CardRemoveButton
            onRemove={onRemove}
            isRemoving={isRemoving}
            ariaLabel={`Remove ${profile.displayName}`}
          />
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col justify-start py-2">
        <h3 className="text-sm font-bold leading-tight truncate">
          {profile.displayName}
        </h3>
      </div>

      {/* Action Buttons — shared row: see profile (right), and dynamic left
          button per the priority chain (tickets / join / +watchlist / share). */}
      <div className="space-y-2 mt-auto">
        <CardActions
          djUsername={profile.username}
          isFollowing={isFollowing}
          onAddToWatchlist={onFollow}
          isAddingWatchlist={isAddingFollow}
        />
      </div>
    </div>
  );
}
