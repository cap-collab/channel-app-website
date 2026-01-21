'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArchiveSerialized } from '@/types/broadcast';

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export interface ArchiveCardProps {
  archive: ArchiveSerialized;
  isPlaying: boolean;
  onPlayPause: () => void;
  currentTime: number;
  onSeek: (time: number) => void;
  onAudioRef: (el: HTMLAudioElement | null) => void;
  onTimeUpdate: () => void;
  onEnded: () => void;
  onAddToWatchlist: () => void;
}

export function ArchiveCard({ archive, isPlaying, onPlayPause, currentTime, onSeek, onAudioRef, onTimeUpdate, onEnded, onAddToWatchlist }: ArchiveCardProps) {
  const [copied, setCopied] = useState(false);

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const url = `${window.location.origin}/archives/${archive.slug}`;

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSeek(parseFloat(e.target.value));
  };

  // Use show image if available, otherwise fall back to first DJ's photo
  const displayImage = archive.showImageUrl || archive.djs[0]?.photoUrl;
  const imageAlt = archive.showImageUrl ? archive.showName : archive.djs[0]?.name || 'Show';

  return (
    <div className="bg-surface-card rounded-xl p-4">
      {/* Top row: Photo, title column with buttons floated right */}
      <div className="flex items-start gap-4">
        {/* Show Image or DJ Photo */}
        <div className="w-16 h-16 rounded-lg bg-gray-800 flex-shrink-0 overflow-hidden">
          {displayImage ? (
            <Image
              src={displayImage}
              alt={imageAlt}
              width={64}
              height={64}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
          )}
        </div>

        {/* Title column - buttons float right, DJ names can wrap below them */}
        <div className="flex-1 min-w-0">
          {/* Action buttons - floated right */}
          <div className="float-right flex items-start gap-2 ml-2">
            {/* DJ Profile button(s) */}
            {archive.djs.filter(dj => dj.username).map((dj) => (
              <Link
                key={dj.username}
                href={`/dj/${dj.username!.replace(/\s+/g, '').toLowerCase()}`}
                className="sm:px-3 h-8 max-sm:w-8 rounded-full flex items-center justify-center gap-1.5 transition-all text-xs bg-white/10 hover:bg-white/20 text-white"
                title={`View ${dj.name}'s profile`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span className="font-medium hidden sm:inline">{archive.djs.filter(dj => dj.username).length > 1 ? dj.name : 'DJ Profile'}</span>
              </Link>
            ))}

            {/* Add to watchlist button */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onAddToWatchlist();
              }}
              className="sm:px-3 h-8 max-sm:w-8 rounded-full flex items-center justify-center gap-1.5 transition-all text-xs bg-white/10 hover:bg-white/20 text-white"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="font-medium hidden sm:inline">Add to watchlist</span>
            </button>

            {/* Copy link button */}
            <button
              onClick={handleShare}
              className={`sm:px-3 h-8 max-sm:w-8 rounded-full flex items-center justify-center gap-1.5 transition-all text-xs ${
                copied
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="font-medium hidden sm:inline">Copied!</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span className="font-medium hidden sm:inline">Copy link</span>
                </>
              )}
            </button>
          </div>

          {/* Show name */}
          <h2 className="text-white font-semibold">{archive.showName}</h2>

          {/* DJ names - will wrap below buttons naturally */}
          {archive.djs.length > 0 && (
            <p className="text-gray-400 text-sm">
              {archive.djs.map((dj, index) => (
                <span key={dj.username || dj.name || index}>
                  {index > 0 && ', '}
                  {dj.username ? (
                    <Link
                      href={`/dj/${dj.username.replace(/\s+/g, '').toLowerCase()}`}
                      className="hover:text-white transition-colors"
                    >
                      {dj.name}
                    </Link>
                  ) : (
                    dj.name
                  )}
                </span>
              ))}
            </p>
          )}

          <p className="text-gray-500 text-xs hidden sm:block">{formatDate(archive.recordedAt)}</p>
        </div>
      </div>

      {/* Audio player */}
      <div className="mt-1.5 flex items-center gap-4">
        {/* Play/Pause button */}
        <button
          onClick={onPlayPause}
          className="w-12 h-12 rounded-full bg-white flex items-center justify-center hover:bg-gray-100 transition-colors flex-shrink-0"
        >
          {isPlaying ? (
            <svg className="w-5 h-5 text-black" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-black ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Progress bar */}
        <div className="flex-1">
          <input
            type="range"
            min={0}
            max={archive.duration || 100}
            value={currentTime}
            onChange={handleSeekChange}
            className="w-full h-1 bg-gray-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{formatDuration(Math.floor(currentTime))}</span>
            <span>{formatDuration(archive.duration)}</span>
          </div>
        </div>
      </div>

      {/* Hidden audio element */}
      <audio
        ref={onAudioRef}
        src={archive.recordingUrl}
        preload="none"
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
      />
    </div>
  );
}
