'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { ArchiveSerialized } from '@/types/broadcast';

interface Props {
  slug: string;
}

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

export function ArchiveClient({ slug }: Props) {
  const [archive, setArchive] = useState<ArchiveSerialized | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [copied, setCopied] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    async function fetchArchive() {
      try {
        const response = await fetch(`/api/archives/${slug}`);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Archive not found');
          }
          throw new Error('Failed to fetch archive');
        }
        const data = await response.json();
        setArchive(data.archive);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load archive');
      } finally {
        setLoading(false);
      }
    }

    fetchArchive();
  }, [slug]);

  const handlePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] text-white relative flex flex-col">
        <AnimatedBackground />
        <Header currentPage="archives" position="sticky" />
        <main className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
        </main>
      </div>
    );
  }

  if (error || !archive) {
    return (
      <div className="min-h-[100dvh] text-white relative flex flex-col">
        <AnimatedBackground />
        <Header currentPage="archives" position="sticky" />
        <main className="flex-1 flex flex-col items-center justify-center px-4">
          <p className="text-red-400 mb-4">{error || 'Archive not found'}</p>
          <Link href="/archives" className="text-gray-400 hover:text-white transition-colors">
            &larr; Back to Archives
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <Header currentPage="archives" position="sticky" />

      <main className="max-w-4xl mx-auto flex-1 w-full px-4 py-6">
        {/* Back link */}
        <Link
          href="/archives"
          className="inline-flex items-center gap-1 text-gray-400 hover:text-white transition-colors mb-6 text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Archives
        </Link>

        {/* Archive card - expanded version matching list card style */}
        <div className="bg-surface-card rounded-xl p-4">
          <audio
            ref={audioRef}
            src={archive.recordingUrl}
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />

          {/* Top row: Photo, show name, date, and share button */}
          <div className="flex items-start gap-4">
            {/* Show Image or DJ Photo */}
            <div className="w-16 h-16 rounded-lg bg-gray-800 flex-shrink-0 overflow-hidden">
              {(archive.showImageUrl || archive.djs[0]?.photoUrl) ? (
                <Image
                  src={archive.showImageUrl || archive.djs[0]?.photoUrl || ''}
                  alt={archive.showImageUrl ? archive.showName : archive.djs[0]?.name || 'Show'}
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

            {/* Show name and date */}
            <div className="flex-1 min-w-0">
              <h1 className="text-white font-semibold">{archive.showName}</h1>
              <p className="text-gray-500 text-xs mt-1">{formatDate(archive.recordedAt)}</p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* DJ Profile button(s) */}
              {archive.djs.filter(dj => dj.username).map((dj) => (
                <Link
                  key={dj.username}
                  href={`/dj/${dj.username!.replace(/\s+/g, '').toLowerCase()}`}
                  className="px-4 h-10 rounded-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white transition-all"
                  title={`View ${dj.name}'s profile`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span className="text-sm font-medium">{archive.djs.filter(dj => dj.username).length > 1 ? dj.name : 'DJ Profile'}</span>
                </Link>
              ))}

              {/* Copy link button */}
              <button
                onClick={handleShare}
                className={`px-4 h-10 rounded-full flex items-center justify-center gap-2 transition-all ${
                  copied
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-sm font-medium">Copied!</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm font-medium">Copy link</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* DJ names - below the top row so they can expand freely */}
          <p className="text-gray-400 text-sm mt-2 ml-20">
            {archive.djs.map((dj, index) => (
              <span key={index}>
                {dj.username ? (
                  <Link
                    href={`/dj/${dj.username}`}
                    className="hover:text-white transition-colors"
                  >
                    @{dj.username}
                  </Link>
                ) : (
                  <span>{dj.name}</span>
                )}
                {index < archive.djs.length - 1 && ', '}
              </span>
            ))}
          </p>

          {/* Audio player - expanded section */}
          <div className="mt-4 flex items-center gap-4">
            {/* Play/Pause button */}
            <button
              onClick={handlePlayPause}
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
                onChange={handleSeek}
                className="w-full h-1 bg-gray-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>{formatDuration(Math.floor(currentTime))}</span>
                <span>{formatDuration(archive.duration)}</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
