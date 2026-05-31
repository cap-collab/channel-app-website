'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Show, Station } from '@/types';
import { getStationLogoUrl } from '@/lib/stations';
import { SuggestedBanner, SuggestedBridgeOverlay } from '@/components/channel/SuggestedCardBadge';
import { CardRemoveButton } from '@/components/CardRemoveButton';
import { CardActions } from '@/components/channel/CardActions';

interface TicketCardProps {
  show: Show;
  station: Station;
  isAuthenticated: boolean;
  isFollowing: boolean;
  isShowFavorited: boolean;
  isAddingFollow: boolean;
  isAddingReminder: boolean;
  onFollow: () => void;
  onRemindMe: () => void;
  matchLabel?: string;
  profileMode?: boolean;
  // /scene SUGGESTED variant
  suggestionBridge?: string;
  // /scene Edit mode — when set, the card renders a CardRemoveButton overlay.
  onRemove?: () => void | Promise<void>;
  isRemoving?: boolean;
}

export function TicketCard({
  show,
  station,
  isFollowing,
  isShowFavorited,
  isAddingFollow,
  isAddingReminder,
  onFollow,
  onRemindMe,
  matchLabel,
  profileMode,
  suggestionBridge,
  onRemove,
  isRemoving,
}: TicketCardProps) {
  const [imageError, setImageError] = useState(false);
  const [copied, setCopied] = useState(false);

  const djName = show.dj || show.name;
  // Prefer the show image when present (artwork is usually richer than a
  // generic DJ headshot), fall back to the DJ photo, then placeholder.
  // Applies uniformly to Channel + external station shows.
  const photoUrl = show.imageUrl || show.djPhotoUrl;
  const hasPhoto = photoUrl && !imageError;
  const stationLogo = getStationLogoUrl(station.id);

  const imageOverlays = (
    <>
      {/* Gradient scrims */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
      {/* Top row: Online badge left, Date right */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
        <span className="text-[10px] font-mono text-white uppercase tracking-tighter flex items-center gap-1 drop-shadow-lg">
          <svg className="w-3 h-3 text-sky-300" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
          Online
        </span>
        <span className="text-[10px] font-mono text-white uppercase tracking-tighter drop-shadow-lg whitespace-nowrap">
          <span className="md:hidden">
            {new Date(show.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {new Date(show.startTime).toLocaleTimeString('en-US', { hour: 'numeric' })}
          </span>
          <span className="hidden md:inline">
            {new Date(show.startTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {new Date(show.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
        </span>
      </div>
      {/* DJ Name, Genre, Location - bottom left */}
      <div className="absolute bottom-2 left-2 right-12">
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
      {/* Match label row */}
      <div className="flex items-center mb-1 h-4 px-0.5">
        {matchLabel && (
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">
            {matchLabel}
          </span>
        )}
      </div>
      {suggestionBridge !== undefined && <SuggestedBanner bridgeDjName={suggestionBridge} />}
      {/* Full width image with overlays - links to DJ profile if available */}
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
                <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-white text-center px-4">
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
                <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-white text-center px-4">
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

      {/* Show Info */}
      <div className="flex flex-col justify-start py-2">
        <h3 className="text-sm font-bold leading-tight truncate">
          {show.djUsername ? (
            <Link href={`/dj/${show.djUsername}`} className="hover:underline">
              {show.name}
            </Link>
          ) : (
            show.name
          )}
        </h3>
        <p className="text-[10px] text-zinc-500 mt-0.5 uppercase">
          Selected by {show.externalRadioName || station.name}
        </p>
      </div>

      {/* Action Buttons — shared row. Upcoming online show: not live yet, no
          tickets → left button is +Watchlist (or Share when already followed). */}
      <div className="space-y-2 mt-auto">
        <CardActions
          djUsername={show.djUsername}
          isFollowing={isFollowing}
          onAddToWatchlist={onFollow}
          isAddingWatchlist={isAddingFollow}
        />

      </div>
    </div>
  );
}
