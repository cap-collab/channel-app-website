'use client';

import { useState, useEffect } from 'react';
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

export function ArchivesClient() {
  const [archives, setArchives] = useState<ArchiveSerialized[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
              <Link
                key={archive.id}
                href={`/archives/${archive.slug}`}
                className="block bg-surface-card hover:bg-surface-card/80 rounded-xl p-4 transition-colors"
              >
                <div className="flex items-start gap-4">
                  {/* DJ Photo or placeholder */}
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
                    <h2 className="text-white font-semibold truncate">{archive.showName}</h2>
                    <p className="text-gray-400 text-sm truncate">
                      {archive.djs.map((dj) => dj.name).join(', ') || 'Unknown DJ'}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-gray-500 text-xs">
                      <span>{formatDate(archive.recordedAt)}</span>
                      <span>•</span>
                      <span>{formatDuration(archive.duration)}</span>
                    </div>
                  </div>

                  {/* Play icon */}
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                    <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
