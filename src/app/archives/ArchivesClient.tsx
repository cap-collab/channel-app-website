'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
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

interface ArchiveCardProps {
  archive: ArchiveSerialized;
  isPlaying: boolean;
  onPlayPause: () => void;
  currentTime: number;
  onSeek: (time: number) => void;
  onAudioRef: (el: HTMLAudioElement | null) => void;
  onTimeUpdate: () => void;
  onEnded: () => void;
}

function ArchiveCard({ archive, isPlaying, onPlayPause, currentTime, onSeek, onAudioRef, onTimeUpdate, onEnded }: ArchiveCardProps) {
  const [copied, setCopied] = useState(false);

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const url = `${window.location.origin}/archives/${archive.slug}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: archive.showName,
          url,
        });
      } catch {
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

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSeek(parseFloat(e.target.value));
  };

  return (
    <div className="bg-surface-card rounded-xl p-4">
      {/* Top row: Photo, info, and share button */}
      <div className="flex items-start gap-4">
        {/* DJ Photo */}
        <div className="w-16 h-16 rounded-lg bg-gray-800 flex-shrink-0 overflow-hidden">
          {archive.djs[0]?.photoUrl ? (
            <Image
              src={archive.djs[0].photoUrl}
              alt={archive.djs[0].name}
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

        {/* Show info */}
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-semibold">{archive.showName}</h2>
          <p className="text-gray-400 text-sm">
            {archive.djs.map((dj, index) => (
              <span key={index}>
                {dj.username ? (
                  <Link
                    href={`/dj/${dj.username}`}
                    className="hover:text-white transition-colors"
                    onClick={(e) => e.stopPropagation()}
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
          <div className="flex items-center gap-3 mt-1 text-gray-500 text-xs">
            <span>{formatDate(archive.recordedAt)}</span>
            <span>•</span>
            <span>{formatDuration(archive.duration)}</span>
          </div>
        </div>

        {/* Share button */}
        <button
          onClick={handleShare}
          className="flex-shrink-0 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          title={copied ? 'Copied!' : 'Share'}
        >
          {copied ? (
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          )}
        </button>
      </div>

      {/* Audio player */}
      <div className="mt-4 flex items-center gap-4">
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

export function ArchivesClient() {
  const [archives, setArchives] = useState<ArchiveSerialized[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [currentTimes, setCurrentTimes] = useState<Record<string, number>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  useEffect(() => {
    async function fetchArchives() {
      try {
        const response = await fetch('/api/archives');
        if (!response.ok) {
          throw new Error('Failed to fetch archives');
        }
        const data = await response.json();
        setArchives(data.archives || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load archives');
      } finally {
        setLoading(false);
      }
    }

    fetchArchives();
  }, []);

  const handlePlayPause = (archiveId: string) => {
    const audio = audioRefs.current[archiveId];
    if (!audio) return;

    // Pause any currently playing audio
    if (playingId && playingId !== archiveId) {
      const currentAudio = audioRefs.current[playingId];
      if (currentAudio) {
        currentAudio.pause();
      }
    }

    if (playingId === archiveId) {
      audio.pause();
      setPlayingId(null);
    } else {
      audio.play();
      setPlayingId(archiveId);
    }
  };

  const handleSeek = (archiveId: string, time: number) => {
    const audio = audioRefs.current[archiveId];
    if (audio) {
      audio.currentTime = time;
      setCurrentTimes(prev => ({ ...prev, [archiveId]: time }));
    }
  };

  const handleTimeUpdate = (archiveId: string) => {
    const audio = audioRefs.current[archiveId];
    if (audio) {
      setCurrentTimes(prev => ({ ...prev, [archiveId]: audio.currentTime }));
    }
  };

  const handleEnded = (archiveId: string) => {
    setPlayingId(null);
    setCurrentTimes(prev => ({ ...prev, [archiveId]: 0 }));
  };

  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <Header currentPage="archives" position="sticky" />

      <main className="max-w-4xl mx-auto flex-1 w-full px-4 py-6">
        <h1 className="text-2xl font-bold mb-6">Archives</h1>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="text-center py-20">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && archives.length === 0 && (
          <div className="text-center py-20">
            <p className="text-gray-500">No archives yet</p>
            <p className="text-gray-600 text-sm mt-2">Recorded broadcasts will appear here</p>
          </div>
        )}

        {!loading && !error && archives.length > 0 && (
          <div className="space-y-3">
            {archives.map((archive) => (
              <ArchiveCard
                key={archive.id}
                archive={archive}
                isPlaying={playingId === archive.id}
                onPlayPause={() => handlePlayPause(archive.id)}
                currentTime={currentTimes[archive.id] || 0}
                onSeek={(time) => handleSeek(archive.id, time)}
                onAudioRef={(el) => { audioRefs.current[archive.id] = el; }}
                onTimeUpdate={() => handleTimeUpdate(archive.id)}
                onEnded={() => handleEnded(archive.id)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
