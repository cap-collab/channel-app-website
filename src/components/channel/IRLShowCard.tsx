'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { IRLShowData } from '@/types';
import { SuggestedBanner, SuggestedBridgeOverlay } from '@/components/channel/SuggestedCardBadge';
import { CardRemoveButton } from '@/components/CardRemoveButton';
import { CardActions } from '@/components/channel/CardActions';

interface IRLShowCardProps {
  show: IRLShowData;
  isFollowing: boolean;
  isAddingFollow: boolean;
  onFollow: () => void;
  matchLabel?: string;
  profileMode?: boolean;
  // /scene SUGGESTED variant
  suggestionBridge?: string;
  // /scene Edit mode — when set, the card renders a CardRemoveButton overlay.
  onRemove?: () => void | Promise<void>;
  isRemoving?: boolean;
}

export function IRLShowCard({
  show,
  isFollowing,
  isAddingFollow,
  onFollow,
  matchLabel,
  // profileMode is accepted for back-compat but no longer affects rendering
  // — CardActions handles all button variations.
  suggestionBridge,
  onRemove,
  isRemoving,
}: IRLShowCardProps) {
  const [imageError, setImageError] = useState(false);

  // Event photo first (the curated artwork), fall back to DJ photo.
  const photoUrl = show.eventPhotoUrl || show.djPhotoUrl;
  const hasPhoto = photoUrl && !imageError;

  // Click-through: collective/venue/DJ page
  const href = show.linkUrl || (show.djUsername ? `/dj/${show.djUsername}` : undefined);

  const imageOverlays = (
    <>
      {/* Gradient scrims */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
      {/* Top row: IRL badge left, Date right */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
        <span className="text-[10px] font-mono text-white uppercase tracking-tighter flex items-center gap-1 drop-shadow-lg">
          <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L8 8h2v3H8l-4 6h5v5h2v-5h5l-4-6h-2V8h2L12 2z" />
          </svg>
          IRL
        </span>
        <span className="text-[10px] font-mono text-white uppercase tracking-tighter drop-shadow-lg whitespace-nowrap">
          <span className="md:hidden">
            {new Date(show.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
          <span className="hidden md:inline">
            {new Date(show.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </span>
      </div>
      {/* DJ name, genre, city - bottom left */}
      <div className="absolute bottom-2 left-2 right-2">
        <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
          {show.djName}
        </span>
        {show.djGenres && show.djGenres.length > 0 && (
          <span className="block text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-300 drop-shadow-lg whitespace-nowrap overflow-hidden">
            {show.djGenres.join(' · ')}
          </span>
        )}
      </div>
    </>
  );

  const imageContent = hasPhoto ? (
    <>
      <Image
        src={photoUrl!}
        alt={show.djName}
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
        {show.djName}
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
      {suggestionBridge !== undefined && <SuggestedBanner bridgeDjName={suggestionBridge} />}
      {/* Full width image with overlays */}
      <div className="relative">
        {href ? (
          <Link href={href} className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10">
            {imageContent}
          </Link>
        ) : (
          <div className="relative w-full aspect-[16/9] overflow-hidden border border-white/10">
            {imageContent}
          </div>
        )}
        {suggestionBridge !== undefined && <SuggestedBridgeOverlay bridgeDjName={suggestionBridge} />}
        {onRemove && (
          <CardRemoveButton
            onRemove={onRemove}
            isRemoving={isRemoving}
            ariaLabel={`Remove ${show.djName || show.eventName}`}
          />
        )}
        {/* Action icon overlaid in the slot the event-image badge used to occupy */}
        <CardActions
          asOverlay
          djUsername={show.djUsername}
          ticketUrl={show.ticketUrl}
          isFollowing={isFollowing}
          onAddToWatchlist={onFollow}
          isAddingWatchlist={isAddingFollow}
        />
      </div>

      {/* Event info row */}
      <div className="py-2 mt-auto">
        <h3 className="text-sm font-bold text-white leading-tight truncate">
          {show.eventName}
        </h3>
        {show.venueName ? (
          show.venueSlug ? (
            <Link
              href={`/venue/${show.venueSlug}`}
              className="text-[10px] text-zinc-500 hover:text-white mt-0.5 uppercase block w-fit truncate"
              onClick={(e) => e.stopPropagation()}
            >
              {show.venueName}
            </Link>
          ) : (
            <p className="text-[10px] text-zinc-500 mt-0.5 uppercase truncate">
              {show.venueName}
            </p>
          )
        ) : (
          <p className="text-[10px] text-zinc-500 mt-0.5 uppercase truncate">
            in {show.location}
          </p>
        )}
      </div>
    </div>
  );
}
