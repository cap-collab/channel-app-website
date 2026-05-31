'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { IRLShowData } from '@/types';
import { SuggestedBanner, SuggestedBridgeOverlay } from '@/components/channel/SuggestedCardBadge';

interface IRLShowCardProps {
  show: IRLShowData;
  isFollowing: boolean;
  isAddingFollow: boolean;
  onFollow: () => void;
  matchLabel?: string;
  profileMode?: boolean;
  // /scene SUGGESTED variant
  suggestionBridge?: string;
}

export function IRLShowCard({
  show,
  isFollowing,
  isAddingFollow,
  onFollow,
  matchLabel,
  profileMode,
  suggestionBridge,
}: IRLShowCardProps) {
  const [imageError, setImageError] = useState(false);

  // DJ photo first, fall back to event photo
  const photoUrl = show.djPhotoUrl || show.eventPhotoUrl;
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
      {suggestionBridge && <SuggestedBanner bridgeDjName={suggestionBridge} />}
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
        {/* Event-image badge — same slot as the station-logo overlay on
            online show cards. Only renders when an event photo exists. */}
        {show.eventPhotoUrl && (
          <div className="absolute -bottom-4 right-3 w-8 h-8 rounded border border-white/30 overflow-hidden bg-black z-10">
            <Image
              src={show.eventPhotoUrl}
              alt={show.eventName || 'Event'}
              fill
              className="object-cover"
              unoptimized
            />
          </div>
        )}
        {suggestionBridge && <SuggestedBridgeOverlay bridgeDjName={suggestionBridge} />}
      </div>

      {/* Event Info */}
      <div className="flex flex-col justify-start py-2">
        <h3 className="text-sm font-bold leading-tight truncate">
          {show.eventName}
        </h3>
        {show.venueName ? (
          show.venueSlug ? (
            <Link
              href={`/venue/${show.venueSlug}`}
              className="text-[10px] text-zinc-500 hover:text-white mt-0.5 uppercase block w-fit"
              onClick={(e) => e.stopPropagation()}
            >
              {show.venueName}
            </Link>
          ) : (
            <p className="text-[10px] text-zinc-500 mt-0.5 uppercase">
              {show.venueName}
            </p>
          )
        ) : (
          <p className="text-[10px] text-zinc-500 mt-0.5 uppercase">
            in {show.location}
          </p>
        )}
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 mt-auto">
        <div className="flex gap-1 md:gap-2">
          {profileMode && show.djUsername ? (
            <>
              {/* Tickets on the left in profileMode */}
              {show.ticketUrl && (
                <a
                  href={show.ticketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-0 py-1 px-1 md:px-4 md:py-2 rounded text-[10px] md:text-sm font-semibold leading-none transition-colors bg-white hover:bg-gray-100 text-gray-900 flex items-center justify-center gap-1 md:gap-2 whitespace-nowrap overflow-hidden"
                >
                  Tickets
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
              <Link
                href={`/dj/${show.djUsername}`}
                className="flex-1 min-w-0 py-1 px-1 md:px-4 md:py-2 rounded text-[10px] md:text-sm font-semibold leading-none transition-colors bg-white/10 hover:bg-white/20 text-white text-center whitespace-nowrap overflow-hidden"
              >
                See profile
              </Link>
            </>
          ) : (
            <>
            <button
              onClick={onFollow}
              disabled={isAddingFollow}
              className={`flex-1 min-w-0 py-1 px-1 md:px-4 md:py-2 rounded text-[10px] md:text-sm font-semibold leading-none transition-colors flex items-center justify-center gap-0.5 md:gap-1 whitespace-nowrap overflow-hidden ${
                isFollowing
                  ? 'bg-white/10 text-gray-400 cursor-default'
                  : 'bg-white hover:bg-gray-100 text-gray-900'
              } disabled:opacity-50`}
            >
              {isAddingFollow ? (
                <div className={`w-4 h-4 border-2 ${isFollowing ? 'border-white' : 'border-gray-900'} border-t-transparent rounded-full animate-spin mx-auto`} />
              ) : isFollowing ? (
                <><svg className="w-3 h-3 md:w-3.5 md:h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg> Watchlist</>
              ) : (
                <><svg className="w-3 h-3 md:w-3.5 md:h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg> Watchlist</>
              )}
            </button>

          {/* Tickets Button */}
          {show.ticketUrl && (
            <a
              href={show.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 min-w-0 py-1 px-1 md:px-4 md:py-2 rounded text-[10px] md:text-sm font-semibold leading-none transition-colors bg-white/10 hover:bg-white/20 text-white flex items-center justify-center gap-1 md:gap-2 whitespace-nowrap overflow-hidden"
            >
              Tickets
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
            </>
          )}
        </div>

      </div>
    </div>
  );
}
