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
    weekday: 'long',
    month: 'long',
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

    if (navigator.share) {
      try {
        await navigator.share({
          title: archive?.showName || 'Channel Archive',
          url,
        });
      } catch {
        // User cancelled or share failed, fall back to copy
        await copyToClipboard(url);
      }
    } else {
      await copyToClipboard(url);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
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

      <main className="max-w-2xl mx-auto flex-1 w-full px-4 py-6">
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

        {/* Archive card */}
        <div className="bg-surface-card rounded-2xl p-6">
          {/* Header with DJ info */}
          <div className="flex items-start gap-4 mb-6">
            {/* DJ Photo */}
            <div className="w-20 h-20 rounded-xl bg-gray-800 flex-shrink-0 overflow-hidden">
              {archive.djs[0]?.photoUrl ? (
                <Image
                  src={archive.djs[0].photoUrl}
                  alt={archive.djs[0].name}
                  width={80}
                  height={80}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
              )}
            </div>

            {/* Show info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-white mb-1">{archive.showName}</h1>
              <div className="flex flex-wrap gap-2">
                {archive.djs.map((dj, index) => (
                  <span key={index}>
                    {dj.username ? (
                      <Link
                        href={`/dj/${dj.username}`}
                        className="text-gray-400 hover:text-white transition-colors"
                      >
                        @{dj.username}
                      </Link>
                    ) : (
                      <span className="text-gray-400">{dj.name}</span>
                    )}
                    {index < archive.djs.length - 1 && <span className="text-gray-600">, </span>}
                  </span>
                ))}
              </div>
              <p className="text-gray-500 text-sm mt-2">{formatDate(archive.recordedAt)}</p>
            </div>
          </div>

          {/* Audio player */}
          <div className="bg-black/30 rounded-xl p-4">
            <audio
              ref={audioRef}
              src={archive.recordingUrl}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />

            {/* Play button and progress */}
            <div className="flex items-center gap-4">
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

          {/* Share button */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleShare}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-colors"
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
