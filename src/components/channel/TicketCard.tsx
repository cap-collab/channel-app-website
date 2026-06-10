'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Show, Station } from '@/types';
import { getStationLogoUrl } from '@/lib/stations';
import { SuggestedBanner, type SuggestionKind } from '@/components/channel/SuggestedCardBadge';
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
  suggestionKind?: SuggestionKind;
  // /scene Edit mode — when set, the card renders a CardRemoveButton overlay.
  onRemove?: () => void | Promise<void>;
  isRemoving?: boolean;
}

export function TicketCard({
  show,
  station,
  isFollowing,
  isAddingFollow,
  onFollow,
  // isShowFavorited / isAddingReminder / onRemindMe accepted for back-compat
  // but no longer rendered — Remind Me was replaced with See profile so
  // explore cards don't repeat the same "Watchlist + Remind Me" pair.
  matchLabel,
  profileMode,
  suggestionBridge,
  suggestionKind,
  onRemove,
  isRemoving,
}: TicketCardProps) {
  const [imageError, setImageError] = useState(false);

  // True when this card lives in /scene (watchlist or suggestion). In that
  // mode we render the compact editorial layout (single bottom-right action
  // icon, no genre line, no station logo badge). Elsewhere (BEYOND YOUR
  // SCENE / home) we keep the original 2-button row, station logo, and
  // genre line so discovery cards stay information-dense.
  const sceneLayout = profileMode || suggestionBridge !== undefined;

  const djName = show.dj || show.name;
  // Prefer the show image when present (artwork is usually richer than a
  // generic DJ headshot), fall back to the DJ photo, then placeholder.
  // Applies uniformly to Channel + external station shows.
  const photoUrl = show.imageUrl || show.djPhotoUrl;
  const stationLogo = !sceneLayout ? getStationLogoUrl(station.id) : null;
  const hasPhoto = photoUrl && !imageError;

  const imageOverlays = (
    <>
      {/* Gradient scrims */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
      {/* Top row: Online/Channel badge left, Date right */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
        <span className="text-[10px] font-mono text-white uppercase tracking-tighter flex items-center gap-1 drop-shadow-lg">
          {station.id === 'broadcast' ? (
            <>
              <Image
                src="/logo-white-on-black-square.png"
                alt=""
                width={12}
                height={12}
                className="w-3 h-3 inline-block"
              />
              Channel
            </>
          ) : (
            <>
              <svg className="w-3 h-3 text-sky-300" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
              </svg>
              Online
            </>
          )}
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
      {suggestionBridge !== undefined && <SuggestedBanner bridgeDjName={suggestionBridge} kind={suggestionKind} />}
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
        {onRemove && (
          <CardRemoveButton
            onRemove={onRemove}
            isRemoving={isRemoving}
            ariaLabel={`Remove ${show.dj || show.name}`}
          />
        )}
        {/* Compact /scene mode: action icon overlays the image. */}
        {sceneLayout && (
          <CardActions
            asOverlay
            djUsername={show.djUsername}
            isFollowing={isFollowing}
            onAddToWatchlist={onFollow}
            isAddingWatchlist={isAddingFollow}
          />
        )}
        {/* Discovery mode: station logo badge in the same slot. */}
        {!sceneLayout && stationLogo && (
          <div className="absolute -bottom-4 right-3 w-8 h-8 rounded border border-white/30 overflow-hidden bg-black z-10">
            <Image
              src={stationLogo}
              alt={station.name}
              fill
              className="object-contain"
            />
          </div>
        )}
      </div>

      {/* Show info */}
      <div className="py-2 mt-auto">
        <h3 className="text-sm font-bold text-white leading-tight truncate">
          {show.djUsername ? (
            <Link href={`/dj/${show.djUsername}`} className="hover:underline">
              {show.name}
            </Link>
          ) : (
            show.name
          )}
        </h3>
        <p className="text-[10px] text-zinc-500 mt-0.5 uppercase truncate">
          Selected by {show.externalRadioName || station.name}
        </p>
        {/* Discovery mode: genre line under the metadata. */}
        {!sceneLayout && show.djGenres && show.djGenres.length > 0 && (
          <p className="text-[10px] font-mono text-zinc-500 mt-0.5 uppercase tracking-tighter truncate">
            {show.djGenres.join(' · ')}
          </p>
        )}
      </div>

      {/* Discovery mode: Watchlist + See profile (matches the other card types). */}
      {!sceneLayout && (
        <div className="space-y-2">
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
            {show.djUsername && (
              <Link
                href={`/dj/${show.djUsername}`}
                className="flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white text-center"
              >
                See profile
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
