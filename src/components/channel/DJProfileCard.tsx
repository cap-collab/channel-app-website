'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { DJProfile } from '@/types';

interface DJProfileCardProps {
  profile: DJProfile;
  isFollowing?: boolean;
  isAddingFollow?: boolean;
  onFollow?: () => void;
  matchLabel?: string;
  watchlistMode?: boolean;
}

export function DJProfileCard({
  profile,
  isFollowing,
  isAddingFollow,
  onFollow,
  matchLabel,
  watchlistMode,
}: DJProfileCardProps) {
  const [imageError, setImageError] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasPhoto = profile.photoUrl && !imageError;
  const href = `/dj/${profile.username}`;

  const imageOverlays = (
    <>
      {/* Gradient scrims */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
      {/* DJ name and city - bottom left */}
      <div className="absolute bottom-2 left-2 right-2">
        <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
          {profile.displayName}
        </span>
        {profile.location && (
          <span className="block text-[10px] text-white/80 drop-shadow-lg mt-0.5">
            {profile.location}
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
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900 to-pink-900">
      <h2 className="text-4xl font-black uppercase tracking-tight leading-none text-white text-center px-4">
        {profile.displayName}
      </h2>
    </div>
  );

  return (
    <div className="w-full group flex flex-col h-full">
      {/* Match label row */}
      {matchLabel && (
        <div className="flex items-center mb-1 h-4 px-0.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">
            {matchLabel}
          </span>
        </div>
      )}
      {/* Full width image with overlays */}
      <Link href={href} className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10">
        {imageContent}
      </Link>

      {/* Info */}
      <div className="flex flex-col justify-start py-2">
        <h3 className="text-sm font-bold leading-tight truncate">
          {profile.displayName}
        </h3>
        {profile.genres && profile.genres.length > 0 && (
          <p className="text-[10px] font-mono text-zinc-500 mt-0.5 uppercase tracking-tighter">
            {profile.genres.join(' · ')}
          </p>
        )}
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 mt-auto">
        <div className="flex gap-2">
          {watchlistMode ? (
            profile.isChannelUser ? (
              <Link
                href={`/dj/${profile.username}#chat`}
                className="flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors bg-white hover:bg-gray-100 text-gray-900 text-center"
              >
                Chat
              </Link>
            ) : (
              <button
                onClick={async () => {
                  const profileUrl = `${window.location.origin}/dj/${profile.username}`;
                  const message = `Hey, your profile showed up on Channel, a platform built for electronic music communities. A girl named Cap is building the platform, she'd love to have you on board. Reach out to her at info@channel-app.com.\n${profileUrl}`;
                  try {
                    if (navigator.share) {
                      await navigator.share({ text: message });
                    } else {
                      await navigator.clipboard.writeText(message);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }
                  } catch {}
                }}
                className="flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors bg-white hover:bg-gray-100 text-gray-900 text-center"
              >
                {copied ? 'Copied!' : 'Invite to Channel'}
              </button>
            )
          ) : (
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
          )}
          <Link
            href={href}
            className="flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white text-center"
          >
            See profile
          </Link>
        </div>
      </div>
    </div>
  );
}
