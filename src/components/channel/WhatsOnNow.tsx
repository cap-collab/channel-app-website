'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { useFavorites } from '@/hooks/useFavorites';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useBPM } from '@/contexts/BPMContext';
import { Show } from '@/types';
import { STATIONS, getStationById, getMetadataKeyByStationId } from '@/lib/stations';
import { TipButton } from './TipButton';

function getStation(stationId: string | undefined) {
  if (!stationId) return undefined;
  return getStationById(stationId);
}

interface WhatsOnNowProps {
  onAuthRequired?: () => void;
}

export function WhatsOnNow({ onAuthRequired }: WhatsOnNowProps) {
  const { isAuthenticated, user } = useAuthContext();
  const { chatUsername } = useUserProfile(user?.uid);
  const { addToWatchlist, isInWatchlist } = useFavorites();
  const { stationBPM } = useBPM();
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [addingToWatchlist, setAddingToWatchlist] = useState<string | null>(null);
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);

  // Fetch all shows on mount
  useEffect(() => {
    fetch('/api/schedule')
      .then((res) => res.json())
      .then((data) => setAllShows(data.shows || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleAddToWatchlist = useCallback(async (djName: string, djUserId?: string, djEmail?: string) => {
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    setAddingToWatchlist(djName);
    await addToWatchlist(djName, djUserId, djEmail);
    setAddingToWatchlist(null);
  }, [isAuthenticated, onAuthRequired, addToWatchlist]);

  // Get currently playing shows for each station
  const liveShows = useMemo(() => {
    const now = currentTime;
    const results: Show[] = [];

    // Get all stations (broadcast first, then others)
    const broadcastStation = STATIONS.find((s) => s.id === 'broadcast');
    const otherStations = STATIONS.filter((s) => s.id !== 'broadcast');
    const orderedStations = broadcastStation ? [broadcastStation, ...otherStations] : otherStations;

    for (const station of orderedStations) {
      const liveShow = allShows.find((show) => {
        if (show.stationId !== station.id) return false;
        const start = new Date(show.startTime);
        const end = new Date(show.endTime);
        return start <= now && end > now;
      });
      if (liveShow) {
        results.push(liveShow);
      }
    }

    return results;
  }, [allShows, currentTime]);

  if (loading) {
    return (
      <div className="bg-surface-card rounded-xl p-4">
        <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-3">What&apos;s On Now</h3>
        <div className="flex items-center justify-center py-4">
          <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (liveShows.length === 0) {
    return (
      <div className="bg-surface-card rounded-xl p-4">
        <h3 className="text-gray-500 text-xs uppercase tracking-wide mb-3">What&apos;s On Now</h3>
        <p className="text-gray-500 text-sm">No shows currently playing</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-gray-500 text-xs uppercase tracking-wide">What&apos;s On Now</h3>
        <span className="text-gray-600 text-xs">← scroll →</span>
      </div>

      {/* Horizontal scrollable container */}
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
        {liveShows.map((show) => {
          const station = getStation(show.stationId);
          const accentColor = station?.accentColor || '#D94099';
          const isExpanded = expandedShowId === show.id;
          const canTip = station?.id === 'broadcast' && show.dj && (show.djUserId || show.djEmail) && show.broadcastSlotId;
          const djInWatchlist = show.dj ? isInWatchlist(show.dj) : false;
          const isAdding = addingToWatchlist === show.dj;

          // Get BPM for this station
          const metadataKey = station ? getMetadataKeyByStationId(station.id) : null;
          const bpm = metadataKey ? stationBPM[metadataKey]?.bpm : null;

          return (
            <div
              key={show.id}
              className="flex-shrink-0 w-64 p-3 rounded-lg bg-white/5 hover:bg-white/8 transition-colors cursor-pointer snap-start border border-white/10"
              onClick={() => setExpandedShowId(isExpanded ? null : show.id)}
            >
              {/* Station name with accent color */}
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: accentColor }}
                />
                <span className="text-gray-400 text-xs truncate">{station?.name}</span>
                {bpm && (
                  <span className="text-gray-500 text-xs ml-auto">{Math.round(bpm)} BPM</span>
                )}
              </div>

              {/* Show content with optional DJ photo */}
              <div className="flex gap-3">
                {/* DJ photo thumbnail */}
                {show.djPhotoUrl && (
                  <Image
                    src={show.djPhotoUrl}
                    alt={show.dj || 'DJ'}
                    width={48}
                    height={48}
                    className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                    unoptimized
                  />
                )}

                {/* Show info */}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium line-clamp-2">{show.name}</p>
                  {show.dj && (
                    <p className="text-gray-500 text-xs truncate">{show.dj}</p>
                  )}
                </div>
              </div>

              {/* Add to Watchlist button */}
              {show.dj && !djInWatchlist && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddToWatchlist(show.dj!, show.djUserId, show.djEmail);
                  }}
                  disabled={isAdding}
                  className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-xs disabled:opacity-50"
                  style={{ color: accentColor }}
                >
                  {isAdding ? (
                    <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  )}
                  <span className="text-white">Add to Watchlist</span>
                </button>
              )}

              {/* Show checkmark if DJ already in watchlist */}
              {show.dj && djInWatchlist && (
                <div
                  className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1.5 text-xs"
                  style={{ color: accentColor }}
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                  <span className="text-gray-400">In Watchlist</span>
                </div>
              )}

              {/* Popup modal for expanded show details */}
              {isExpanded && (
                <>
                  {/* Backdrop */}
                  <div
                    className="fixed inset-0 bg-black/60 z-40"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedShowId(null);
                    }}
                  />
                  {/* Popup */}
                  <div
                    className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[#1a1a1a] border border-gray-700 rounded-xl p-5 max-w-md w-[90vw] shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Close button */}
                    <button
                      onClick={() => setExpandedShowId(null)}
                      className="absolute top-3 right-3 text-gray-400 hover:text-white transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>

                    {/* Show name */}
                    <h3 className="text-white text-lg font-semibold pr-8 mb-1">
                      {show.name}
                    </h3>

                    {/* DJ name */}
                    {show.dj && (
                      <p className="text-gray-400 text-sm mb-3">
                        by {show.dj}
                      </p>
                    )}

                    {/* Station & live indicator */}
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
                      <span>{station?.name}</span>
                      <span>•</span>
                      <span className="text-red-500 font-medium">LIVE NOW</span>
                      {bpm && (
                        <>
                          <span>•</span>
                          <span>{Math.round(bpm)} BPM</span>
                        </>
                      )}
                    </div>

                    {/* DJ Photo and Bio */}
                    {(show.djPhotoUrl || show.djBio) && (
                      <div className="flex items-start gap-3 mb-4">
                        {show.djPhotoUrl && (
                          <Image
                            src={show.djPhotoUrl}
                            alt={show.dj || 'DJ'}
                            width={64}
                            height={64}
                            className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                            unoptimized
                          />
                        )}
                        {show.djBio && (
                          <p className="text-gray-300 text-sm">{show.djBio}</p>
                        )}
                      </div>
                    )}

                    {/* Description */}
                    {show.description && (
                      <p className="text-gray-400 text-sm leading-relaxed mb-4">{show.description}</p>
                    )}

                    {/* Promo section */}
                    {show.promoText && (
                      <div className="bg-gray-800/50 rounded-lg p-3 mb-4">
                        <p className="text-gray-300 text-sm">{show.promoText}</p>
                        {show.promoUrl && (
                          <a
                            href={show.promoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-sm hover:underline"
                            style={{ color: accentColor }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Learn more
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-3 mt-5 pt-4 border-t border-gray-800">
                      {/* Add DJ to Watchlist button */}
                      {show.dj && !djInWatchlist && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddToWatchlist(show.dj!, show.djUserId, show.djEmail);
                          }}
                          disabled={isAdding}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-sm"
                          style={{ color: accentColor }}
                        >
                          {isAdding ? (
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          )}
                          <span className="text-white">Add {show.dj} to Watchlist</span>
                        </button>
                      )}

                      {/* Show checkmark if DJ already in watchlist */}
                      {show.dj && djInWatchlist && (
                        <div
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 text-sm"
                          style={{ color: accentColor }}
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                          </svg>
                          <span className="text-gray-400">{show.dj} in Watchlist</span>
                        </div>
                      )}

                      {/* Tip button */}
                      {canTip && (
                        <TipButton
                          isAuthenticated={isAuthenticated}
                          tipperUserId={user?.uid}
                          tipperUsername={chatUsername || undefined}
                          djUserId={show.djUserId}
                          djEmail={show.djEmail}
                          djUsername={show.dj!}
                          broadcastSlotId={show.broadcastSlotId!}
                          showName={show.name}
                        />
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
