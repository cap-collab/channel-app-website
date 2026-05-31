'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Show, Station } from '@/types';
import { getContrastTextColor } from '@/lib/colorUtils';
import { getStationLogoUrl } from '@/lib/stations';
import { SuggestedBanner, SuggestedBridgeOverlay } from '@/components/channel/SuggestedCardBadge';
import { CardRemoveButton } from '@/components/CardRemoveButton';
import { CardActions } from '@/components/channel/CardActions';

interface LiveShowCardProps {
  show: Show;
  station: Station;
  isFollowing: boolean;
  isAddingFollow: boolean;
  onFollow: () => void;
  matchLabel?: string;
  profileMode?: boolean;
  bpm?: number | null;
  // /scene SUGGESTED variant
  suggestionBridge?: string;
  // /scene Edit mode — when set, the card renders a CardRemoveButton overlay.
  onRemove?: () => void | Promise<void>;
  isRemoving?: boolean;
}

export function LiveShowCard({
  show,
  station,
  isFollowing,
  isAddingFollow,
  onFollow,
  matchLabel,
  // profileMode is accepted for back-compat but no longer affects rendering
  // — CardActions handles all button variations.
  bpm,
  suggestionBridge,
  onRemove,
  isRemoving,
}: LiveShowCardProps) {
  const [imageError, setImageError] = useState(false);
  // Prefer the show image when present, fall back to the DJ photo.
  // Applies uniformly to Channel + external station shows.
  const photoUrl = show.imageUrl || show.djPhotoUrl;
  const hasPhoto = photoUrl && !imageError;
  const djName = show.dj || show.name;
  const textColor = hasPhoto ? '#ffffff' : getContrastTextColor(station.accentColor);
  const stationLogo = getStationLogoUrl(station.id);

  const imageOverlays = (
    <>
      {/* Gradient scrims */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
      {/* Online badge - top left */}
      <div className="absolute top-2 left-2">
        <span className="text-[10px] font-mono text-white uppercase tracking-tighter flex items-center gap-1 drop-shadow-lg">
          <svg className="w-3 h-3 text-sky-300" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
          Online
        </span>
      </div>
      {/* DJ Name, Genre, Location - bottom left */}
      <div className="absolute bottom-2 left-2 right-2">
        <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
          {djName}
        </span>
        {show.djGenres && show.djGenres.length > 0 && (
          <span className="block text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-300 drop-shadow-lg whitespace-nowrap overflow-hidden">
            {show.djGenres.join(' · ')}
          </span>
        )}
      </div>
    </>
  );

  const stationLogoOverlay = stationLogo ? (
    <div className="absolute -bottom-4 right-3 w-8 h-8 rounded border border-white/30 overflow-hidden bg-black z-10">
      <Image
        src={stationLogo}
        alt={station.name}
        fill
        className="object-contain"
      />
    </div>
  ) : null;

  return (
    <div className="w-full group flex flex-col h-full">
      {/* Match label on left, Live indicator on right */}
      <div className="flex items-center justify-between mb-1 h-4 px-0.5">
        {matchLabel ? (
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">{matchLabel}</span>
        ) : <div />}
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-live-pulse absolute inline-flex h-full w-full rounded-full bg-red-400"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]"></span>
          </span>
          <span className="text-[10px] font-mono text-red-500 uppercase tracking-tighter font-bold">Live</span>
          {bpm && (
            <span className="text-[10px] font-mono text-red-500 uppercase tracking-tighter">
              {bpm} BPM
            </span>
          )}
        </div>
      </div>

      {suggestionBridge !== undefined && <SuggestedBanner bridgeDjName={suggestionBridge} />}
      {/* Full width 16:9 image with overlays */}
      <div className="relative">
        {show.djUsername ? (
          <Link href={`/dj/${show.djUsername}`} className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10">
            {hasPhoto ? (
              <>
                <Image
                  src={photoUrl}
                  alt={djName}
                  fill
                  className="object-cover"
                  unoptimized
                  onError={() => setImageError(true)}
                />
                {imageOverlays}
              </>
            ) : (
              <div
                className="w-full h-full flex items-center justify-center"
                style={{ backgroundColor: station.accentColor }}
              >
                <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-center px-4" style={{ color: textColor }}>
                  {djName}
                </h2>
              </div>
            )}
          </Link>
        ) : (
          <div className="relative w-full aspect-[16/9] overflow-hidden border border-white/10">
            {hasPhoto ? (
              <>
                <Image
                  src={photoUrl}
                  alt={djName}
                  fill
                  className="object-cover"
                  unoptimized
                  onError={() => setImageError(true)}
                />
                {imageOverlays}
              </>
            ) : (
              <div
                className="w-full h-full flex items-center justify-center"
                style={{ backgroundColor: station.accentColor }}
              >
                <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-center px-4" style={{ color: textColor }}>
                  {djName}
                </h2>
              </div>
            )}
          </div>
        )}
        {stationLogoOverlay}
        {suggestionBridge !== undefined && <SuggestedBridgeOverlay bridgeDjName={suggestionBridge} />}
        {onRemove && (
          <CardRemoveButton
            onRemove={onRemove}
            isRemoving={isRemoving}
            ariaLabel={`Remove ${show.dj || show.name}`}
          />
        )}
      </div>

      {/* Show info + bottom-right action icon */}
      <div className="flex items-end justify-between gap-2 py-2 mt-auto">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-white leading-tight truncate">
            {show.djUsername ? (
              <Link href={`/dj/${show.djUsername}`} className="hover:underline">
                {show.name}
              </Link>
            ) : (
              show.name
            )}
          </h3>
          <a
            href={station.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-zinc-500 flex items-center gap-1 mt-0.5 uppercase hover:text-zinc-300 transition"
          >
            at {show.externalRadioName || station.name}
            <svg className="w-2 h-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
        <CardActions
          djUsername={show.djUsername}
          isLive
          // Channel Radio (broadcast / dj-radio) → home player. External
          // station → the station's site in a new tab.
          joinUrl={
            station.id === 'broadcast' || station.id === 'dj-radio'
              ? '/'
              : station.websiteUrl
          }
          isFollowing={isFollowing}
          onAddToWatchlist={onFollow}
          isAddingWatchlist={isAddingFollow}
        />
      </div>
    </div>
  );
}
