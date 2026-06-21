'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { IRLShowData } from '@/types';
import { SuggestedBanner, type SuggestionKind } from '@/components/channel/SuggestedCardBadge';
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
  suggestionKind?: SuggestionKind;
  // /scene Edit mode — when set, the card renders a CardRemoveButton overlay.
  onRemove?: () => void | Promise<void>;
  isRemoving?: boolean;
  // When true the top-left badge shows the cloud icon + station label instead of
  // the green "IRL" badge — for online radio shows reusing this card.
  isOnline?: boolean;
  // Station label for the online badge (e.g. "Channel"). Defaults to "Channel".
  stationLabel?: string;
}

export function IRLShowCard({
  show,
  isFollowing,
  isAddingFollow,
  onFollow,
  matchLabel,
  profileMode,
  suggestionBridge,
  suggestionKind,
  onRemove,
  isRemoving,
  isOnline,
  stationLabel = 'Channel',
}: IRLShowCardProps) {
  const [imageError, setImageError] = useState(false);
  // Compact /scene layout vs full discovery layout.
  const sceneLayout = profileMode || suggestionBridge !== undefined;

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
      {/* Top row: IRL/Online badge left, Date right */}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
        {isOnline ? (
          <span className="text-[11.9px] font-mono text-white uppercase tracking-tighter flex items-center gap-1 drop-shadow-lg">
            <svg className="w-3.5 h-3.5 text-sky-300" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
            </svg>
            {stationLabel}
          </span>
        ) : (
          <span className="text-[11.9px] font-mono text-white uppercase tracking-tighter flex items-center gap-1 drop-shadow-lg min-w-0 mr-2">
            <svg
              className="w-3.5 h-3.5 shrink-0 text-green-300 drop-shadow-[0_0_3px_rgba(74,222,128,0.6)]"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M12 2L8 8h2v3H8l-4 6h5v5h2v-5h5l-4-6h-2V8h2L12 2z" />
            </svg>
            <span className="truncate">IRL{show.venueName ? ` · ${show.venueName}` : ''}</span>
          </span>
        )}
        <span className="text-[11.9px] font-mono text-white uppercase tracking-tighter drop-shadow-lg whitespace-nowrap">
          <span className="md:hidden">
            {new Date(show.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
          <span className="hidden md:inline">
            {new Date(show.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </span>
      </div>
      {/* Bottom left: DJ/collective name + (scene mode) show name, else genres. */}
      <div className="absolute bottom-2 left-2 right-2">
        <span className="text-sm font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
          {show.djName}
        </span>
        {sceneLayout ? (
          show.eventName && show.eventName !== show.djName ? (
            <span className="block text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-300 drop-shadow-lg whitespace-nowrap overflow-hidden">
              {show.eventName}
            </span>
          ) : null
        ) : (
          show.djGenres && show.djGenres.length > 0 && (
            <span className="block text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-300 drop-shadow-lg whitespace-nowrap overflow-hidden">
              {show.djGenres.join(' · ')}
            </span>
          )
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
    // No photo: gradient placeholder, but keep ALL the same overlays (badge,
    // date, DJ/show name) so image-less cards look consistent with the rest.
    <div className="w-full h-full bg-gradient-to-br from-stone-800 to-amber-900">
      {imageOverlays}
    </div>
  );

  return (
    <div className="w-full group flex flex-col h-full">
      {/* Match label row — only when there's a label, so the card top aligns
          with the archive cards (no empty spacer above image). */}
      {matchLabel && (
        <div className="flex items-center mb-1 h-4 px-0.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">
            {matchLabel}
          </span>
        </div>
      )}
      {suggestionBridge !== undefined && <SuggestedBanner bridgeDjName={suggestionBridge} kind={suggestionKind} />}
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
        {onRemove && (
          <CardRemoveButton
            onRemove={onRemove}
            isRemoving={isRemoving}
            ariaLabel={`Remove ${show.djName || show.eventName}`}
          />
        )}
        {/* Compact /scene mode: action icon overlays the image. */}
        {sceneLayout && (
          <CardActions
            asOverlay
            djUsername={show.djUsername}
            ticketUrl={show.ticketUrl}
            isFollowing={isFollowing}
            onAddToWatchlist={onFollow}
            isAddingWatchlist={isAddingFollow}
          />
        )}
      </div>

      {/* Event info (discovery mode only). In scene mode the show name + DJ live
          in the image overlay and the venue sits next to the IRL badge, so the
          below-card block is omitted entirely (no dead padding). */}
      {!sceneLayout && (
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
          {show.djGenres && show.djGenres.length > 0 && (
            <p className="text-[10px] font-mono text-zinc-500 mt-0.5 uppercase tracking-tighter truncate">
              {show.djGenres.join(' · ')}
            </p>
          )}
        </div>
      )}

      {/* Discovery mode: original two-button row (Watchlist + Tickets). */}
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
            {show.ticketUrl && (
              <a
                href={show.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white flex items-center justify-center gap-2"
              >
                Tickets
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
