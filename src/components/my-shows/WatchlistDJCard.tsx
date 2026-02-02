'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

interface WatchlistDJCardProps {
  djName: string;
  djPhotoUrl?: string;
  djUsername?: string;
  djLocation?: string;
  djGenres?: string[];
  onRemove: () => void;
  isRemoving: boolean;
}

export function WatchlistDJCard({
  djName,
  djPhotoUrl,
  djUsername,
  djLocation,
  djGenres,
  onRemove,
  isRemoving,
}: WatchlistDJCardProps) {
  const router = useRouter();
  const [imageError, setImageError] = useState(false);
  const hasPhoto = djPhotoUrl && !imageError;

  const handleCardClick = () => {
    console.log('[WatchlistDJCard] Click! djUsername:', djUsername);
    if (djUsername) {
      const url = `/dj/${djUsername}`;
      console.log('[WatchlistDJCard] Navigating to:', url);
      window.location.href = url;
    }
  };

  return (
    <div
      className={`rounded-xl overflow-hidden bg-[#1a1a1a] border border-gray-800/50 relative group ${djUsername ? 'cursor-pointer' : ''}`}
      onClick={handleCardClick}
    >
      {/* X remove button - top right corner */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        disabled={isRemoving}
        className="absolute top-2 right-2 z-20 p-1 rounded-full bg-black/50 transition-colors text-gray-400 hover:text-red-400 hover:bg-black/70 disabled:opacity-50"
        aria-label="Remove from watchlist"
      >
        {isRemoving ? (
          <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </button>

      {/* Photo area */}
      <div className="relative w-full aspect-square overflow-hidden">
        {hasPhoto ? (
          <>
            <Image
              src={djPhotoUrl}
              alt={djName}
              fill
              className="object-cover"
              unoptimized
              onError={() => setImageError(true)}
            />
            {/* Gradient scrim for text contrast */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
            {/* DJ Name overlay on bottom-left */}
            <div className="absolute bottom-2 left-2 right-2 pointer-events-none">
              <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
                {djName}
              </span>
              {djLocation && (
                <span className="block text-[10px] text-white/80 drop-shadow-lg mt-0.5">
                  {djLocation}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900 relative">
            <span className="text-4xl font-bold text-white mb-2">
              {djName.charAt(0).toUpperCase()}
            </span>
            <span className="text-xs font-black uppercase tracking-wider text-white/80 text-center px-2 line-clamp-1">
              {djName}
            </span>
            {djLocation && (
              <span className="text-[10px] text-white/60 mt-0.5">
                {djLocation}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Genre tags below photo */}
      {djGenres && djGenres.length > 0 && (
        <div className="px-2 py-2">
          <p className="text-[10px] font-mono text-gray-500 uppercase tracking-tighter line-clamp-1">
            {djGenres.join(' · ')}
          </p>
        </div>
      )}
    </div>
  );
}
