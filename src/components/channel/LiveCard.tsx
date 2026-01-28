'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Show, Station } from '@/types';
import { getContrastTextColor } from '@/lib/colorUtils';

interface LiveCardProps {
  show: Show;
  station: Station;
  bpm: number | null;
  isAuthenticated: boolean;
  isFollowed: boolean;
  isTogglingFollow: boolean;
  onFollow: () => Promise<void>;
  onAuthRequired: () => void;
}

export function LiveCard({
  show,
  station,
  bpm,
  isAuthenticated,
  isFollowed,
  isTogglingFollow,
  onFollow,
  onAuthRequired,
}: LiveCardProps) {
  const [imageError, setImageError] = useState(false);

  const djName = show.dj || show.name;
  const photoUrl = show.djPhotoUrl || show.imageUrl;
  const hasPhoto = photoUrl && !imageError;
  const isChannelBroadcast = station.id === 'broadcast';

  // Calculate BPM animation duration (ms per beat)
  const bpmDuration = bpm ? `${Math.round(60000 / bpm)}ms` : '500ms';

  // For no-photo variant, use station color with contrast text
  const textColor = hasPhoto ? '#ffffff' : getContrastTextColor(station.accentColor);

  const handleFollowClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) {
      onAuthRequired();
      return;
    }
    await onFollow();
  };

  const handleJoinStream = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isChannelBroadcast) {
      window.open(station.websiteUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="rounded-2xl overflow-hidden bg-surface-card">
      {/* Header Row: LIVE + BPM */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/40">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 bg-red-500 rounded-full animate-live-pulse"
          />
          <span className="text-red-500 text-xs font-bold uppercase tracking-wide">
            Live
          </span>
        </div>
        {bpm && (
          <div
            className="animate-bpm-pulse text-white text-sm font-bold"
            style={{ '--bpm-duration': bpmDuration } as React.CSSProperties}
          >
            {Math.round(bpm)} BPM
          </div>
        )}
      </div>

      {/* Photo / Graphic Area */}
      {hasPhoto ? (
        // Pulse Card: With Photo
        <div className="relative aspect-square">
          <Image
            src={photoUrl}
            alt={djName}
            fill
            className="object-cover"
            unoptimized
            onError={() => setImageError(true)}
          />
        </div>
      ) : (
        // Graphic Card: No Photo - vinyl label style
        <div
          className="relative aspect-square flex items-center justify-center"
          style={{ backgroundColor: station.accentColor }}
        >
          <div
            className="text-center px-4"
            style={{ color: textColor }}
          >
            <h2 className="text-4xl font-black uppercase tracking-tight leading-none">
              {djName}
            </h2>
          </div>
        </div>
      )}

      {/* Info + Actions */}
      <div className="p-4 space-y-3">
        {/* DJ Name + Station */}
        <div>
          <h3 className="text-white text-xl font-bold">
            {show.djUsername ? (
              <Link href={`/dj/${show.djUsername}`} className="hover:underline">
                {djName}
              </Link>
            ) : (
              djName
            )}
          </h3>
          <a
            href={station.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm hover:underline flex items-center gap-1"
            style={{ color: isChannelBroadcast ? '#D94099' : station.accentColor }}
          >
            at {station.name}
            {!isChannelBroadcast && (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            )}
          </a>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleFollowClick}
            disabled={isTogglingFollow}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors ${
              isFollowed
                ? 'bg-white/10 text-gray-400'
                : 'bg-white text-black hover:bg-white/90'
            } disabled:opacity-50`}
          >
            {isTogglingFollow ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mx-auto" />
            ) : isFollowed ? (
              'Following'
            ) : (
              '+ Follow'
            )}
          </button>

          {isChannelBroadcast ? (
            <button
              className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold bg-accent hover:bg-accent-hover text-white transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Tune In
            </button>
          ) : (
            <button
              onClick={handleJoinStream}
              className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center gap-2"
            >
              Join Stream
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
