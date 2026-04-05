'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { ArchiveSerialized } from '@/types/broadcast';
import { WatchlistModal } from '@/components/WatchlistModal';
import { ArchiveCard } from '@/components/ArchiveCard';

interface Props {
  slug: string;
}

export function ArchiveClient({ slug }: Props) {
  const [archive, setArchive] = useState<ArchiveSerialized | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [showWatchlistModal, setShowWatchlistModal] = useState(false);

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

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
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

        <ArchiveCard
          archive={archive}
          isPlaying={isPlaying}
          onPlayPause={handlePlayPause}
          currentTime={currentTime}
          onSeek={handleSeek}
          onAudioRef={(el) => { audioRef.current = el; }}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onAddToWatchlist={() => setShowWatchlistModal(true)}
        />

        {/* Watchlist Modal */}
        <WatchlistModal
          isOpen={showWatchlistModal}
          onClose={() => setShowWatchlistModal(false)}
          showName={archive.showName}
          djs={archive.djs.map((dj) => ({
            name: dj.name,
            username: dj.username,
            userId: dj.userId,
            email: dj.email,
          }))}
        />
      </main>
    </div>
  );
}
