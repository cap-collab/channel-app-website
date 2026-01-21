'use client';

import { useState, useEffect, useRef } from 'react';
import { Header } from '@/components/Header';
import { HeaderSearch } from '@/components/HeaderSearch';
import { AuthModal } from '@/components/AuthModal';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { ArchiveSerialized } from '@/types/broadcast';
import { WatchlistModal } from '@/components/WatchlistModal';
import { ArchiveCard } from '@/components/ArchiveCard';

const STREAM_COUNT_THRESHOLD = 300; // 5 minutes in seconds

export function ArchivesClient() {
  const [archives, setArchives] = useState<ArchiveSerialized[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [currentTimes, setCurrentTimes] = useState<Record<string, number>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const [showWatchlistModal, setShowWatchlistModal] = useState(false);
  const [selectedArchive, setSelectedArchive] = useState<ArchiveSerialized | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Track cumulative playback time and whether stream has been counted
  const playbackTimeRef = useRef<Record<string, number>>({});
  const streamCountedRef = useRef<Set<string>>(new Set());
  const lastTimeRef = useRef<Record<string, number>>({});

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

  const handleTimeUpdate = (archiveId: string, archiveSlug: string) => {
    const audio = audioRefs.current[archiveId];
    if (audio) {
      const currentTime = audio.currentTime;
      setCurrentTimes(prev => ({ ...prev, [archiveId]: currentTime }));

      // Track cumulative playback time
      const lastTime = lastTimeRef.current[archiveId] || 0;
      const timeDelta = currentTime - lastTime;

      // Only count forward playback (not seeking backwards)
      if (timeDelta > 0 && timeDelta < 2) {
        playbackTimeRef.current[archiveId] = (playbackTimeRef.current[archiveId] || 0) + timeDelta;

        // Check if we've reached the threshold and haven't counted yet
        if (
          playbackTimeRef.current[archiveId] >= STREAM_COUNT_THRESHOLD &&
          !streamCountedRef.current.has(archiveId)
        ) {
          streamCountedRef.current.add(archiveId);
          // Fire and forget - don't await
          fetch(`/api/archives/${archiveSlug}/stream`, { method: 'POST' }).catch(console.error);
        }
      }

      lastTimeRef.current[archiveId] = currentTime;
    }
  };

  const handleEnded = (archiveId: string) => {
    setPlayingId(null);
    setCurrentTimes(prev => ({ ...prev, [archiveId]: 0 }));
  };

  const handleAddToWatchlist = (archive: ArchiveSerialized) => {
    setSelectedArchive(archive);
    setShowWatchlistModal(true);
  };

  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <Header currentPage="archives" position="sticky" />

      <main className="max-w-4xl mx-auto flex-1 w-full px-4 py-6">
        {/* Search bar - mobile only */}
        <div className="md:hidden mb-4">
          <HeaderSearch onAuthRequired={() => setShowAuthModal(true)} />
        </div>

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
                onTimeUpdate={() => handleTimeUpdate(archive.id, archive.slug)}
                onEnded={() => handleEnded(archive.id)}
                onAddToWatchlist={() => handleAddToWatchlist(archive)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Watchlist Modal */}
      {selectedArchive && (
        <WatchlistModal
          isOpen={showWatchlistModal}
          onClose={() => {
            setShowWatchlistModal(false);
            setSelectedArchive(null);
          }}
          showName={selectedArchive.showName}
          djs={selectedArchive.djs.map((dj) => ({
            name: dj.name,
            username: dj.username,
            userId: dj.userId,
            email: dj.email,
          }))}
        />
      )}

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
