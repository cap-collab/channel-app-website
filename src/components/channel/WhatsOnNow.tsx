'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { useFavorites } from '@/hooks/useFavorites';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useBPM } from '@/contexts/BPMContext';
import { Show, Station } from '@/types';
import { STATIONS, getStationById, getMetadataKeyByStationId } from '@/lib/stations';
import { TipButton } from './TipButton';

interface WhatsOnNowProps {
  onAuthRequired?: () => void;
}

export function WhatsOnNow({ onAuthRequired }: WhatsOnNowProps) {
  const { isAuthenticated, user } = useAuthContext();
  const { chatUsername } = useUserProfile(user?.uid);
  const { addToWatchlist, isInWatchlist, isShowFavorited, toggleFavorite } = useFavorites();
  const { stationBPM } = useBPM();
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [addingToWatchlist, setAddingToWatchlist] = useState<string | null>(null);
  const [togglingFavoriteId, setTogglingFavoriteId] = useState<string | null>(null);
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

  const handleToggleFavorite = useCallback(async (show: Show) => {
    if (!isAuthenticated) {
      onAuthRequired?.();
      return;
    }
    setTogglingFavoriteId(show.id);
    await toggleFavorite(show);
    setTogglingFavoriteId(null);
  }, [isAuthenticated, onAuthRequired, toggleFavorite]);

  // Get ordered stations (broadcast first)
  const orderedStations = useMemo(() => {
    const broadcastStation = STATIONS.find((s) => s.id === 'broadcast');
    const otherStations = STATIONS.filter((s) => s.id !== 'broadcast');
    return broadcastStation ? [broadcastStation, ...otherStations] : otherStations;
  }, []);

  // Get shows for each station: current show + upcoming shows
  const stationShows = useMemo(() => {
    const now = currentTime;
    const result: Map<string, Show[]> = new Map();

    for (const station of orderedStations) {
      const shows = allShows
        .filter((show) => show.stationId === station.id)
        .filter((show) => {
          const end = new Date(show.endTime);
          return end > now; // Show hasn't ended yet
        })
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      if (shows.length > 0) {
        result.set(station.id, shows);
      }
    }

    return result;
  }, [allShows, currentTime, orderedStations]);

  // Check if a show is currently live
  const isShowLive = (show: Show): boolean => {
    const now = currentTime;
    const start = new Date(show.startTime);
    const end = new Date(show.endTime);
    return start <= now && end > now;
  };

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

  if (stationShows.size === 0) {
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

      {/* One row per station */}
      <div className="space-y-2">
        {orderedStations.map((station) => {
          const shows = stationShows.get(station.id);
          if (!shows || shows.length === 0) return null;

          const accentColor = station.accentColor || '#D94099';
          const metadataKey = getMetadataKeyByStationId(station.id);
          const bpm = metadataKey ? stationBPM[metadataKey]?.bpm : null;

          return (
            <div key={station.id} className="flex items-stretch gap-3 rounded-lg bg-white/5 overflow-hidden">
              {/* Station accent bar */}
              <div
                className="w-1 flex-shrink-0 rounded-l-lg"
                style={{ backgroundColor: accentColor }}
              />

              {/* Station name column */}
              <div className="flex-shrink-0 w-20 py-2 flex flex-col justify-center">
                <span className="text-white text-xs font-medium line-clamp-2 leading-tight">
                  {station.name}
                </span>
                {bpm && (
                  <span className="text-gray-500 text-[10px] mt-0.5">{Math.round(bpm)} BPM</span>
                )}
              </div>

              {/* Horizontal scrollable shows */}
              <div className="flex-1 overflow-x-auto py-2 pr-2">
                <div className="flex gap-2">
                  {shows.map((show) => (
                    <ShowCard
                      key={show.id}
                      show={show}
                      station={station}
                      isLive={isShowLive(show)}
                      isExpanded={expandedShowId === show.id}
                      onToggleExpand={() => setExpandedShowId(expandedShowId === show.id ? null : show.id)}
                      onCloseExpand={() => setExpandedShowId(null)}
                      isFavorited={isShowFavorited(show)}
                      isTogglingFavorite={togglingFavoriteId === show.id}
                      onToggleFavorite={handleToggleFavorite}
                      djInWatchlist={show.dj ? isInWatchlist(show.dj) : false}
                      isAddingToWatchlist={addingToWatchlist === show.dj}
                      onAddToWatchlist={handleAddToWatchlist}
                      isAuthenticated={isAuthenticated}
                      userId={user?.uid}
                      chatUsername={chatUsername}
                      bpm={bpm}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ShowCardProps {
  show: Show;
  station: Station;
  isLive: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onCloseExpand: () => void;
  isFavorited: boolean;
  isTogglingFavorite: boolean;
  onToggleFavorite: (show: Show) => void;
  djInWatchlist: boolean;
  isAddingToWatchlist: boolean;
  onAddToWatchlist: (djName: string, djUserId?: string, djEmail?: string) => void;
  isAuthenticated: boolean;
  userId?: string;
  chatUsername?: string | null;
  bpm: number | null;
}

function ShowCard({
  show,
  station,
  isLive,
  isExpanded,
  onToggleExpand,
  onCloseExpand,
  isFavorited,
  isTogglingFavorite,
  onToggleFavorite,
  djInWatchlist,
  isAddingToWatchlist,
  onAddToWatchlist,
  isAuthenticated,
  userId,
  chatUsername,
  bpm,
}: ShowCardProps) {
  const accentColor = station.accentColor || '#D94099';
  const canTip = station.id === 'broadcast' && show.dj && (show.djUserId || show.djEmail) && show.broadcastSlotId;

  // Format time for upcoming shows
  const formatTime = (startTime: string): string => {
    const date = new Date(startTime);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <>
      <div
        className={`flex-shrink-0 w-48 p-2 rounded-lg cursor-pointer transition-colors ${
          isLive
            ? 'bg-white/10 border border-white/20'
            : 'bg-white/5 hover:bg-white/10'
        }`}
        onClick={onToggleExpand}
      >
        {/* Live indicator or time */}
        <div className="flex items-center gap-1 mb-1">
          {isLive ? (
            <span className="text-red-500 text-[10px] font-medium">LIVE</span>
          ) : (
            <span className="text-gray-500 text-[10px]">{formatTime(show.startTime)}</span>
          )}
        </div>

        {/* Show content */}
        <div className="flex gap-2">
          {/* DJ photo thumbnail */}
          {show.djPhotoUrl && (
            <Image
              src={show.djPhotoUrl}
              alt={show.dj || 'DJ'}
              width={36}
              height={36}
              className="w-9 h-9 rounded-full object-cover flex-shrink-0"
              unoptimized
            />
          )}

          {/* Show info */}
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium line-clamp-2 leading-tight">{show.name}</p>
            {show.dj && (
              <p className="text-gray-500 text-[10px] truncate">{show.dj}</p>
            )}
          </div>
        </div>
      </div>

      {/* Popup modal for expanded show details */}
      {isExpanded && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 z-40"
            onClick={(e) => {
              e.stopPropagation();
              onCloseExpand();
            }}
          />
          {/* Popup */}
          <div
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[#1a1a1a] border border-gray-700 rounded-xl p-5 max-w-md w-[90vw] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={onCloseExpand}
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
              <span>{station.name}</span>
              <span>•</span>
              {isLive ? (
                <span className="text-red-500 font-medium">LIVE NOW</span>
              ) : (
                <span>{formatTime(show.startTime)}</span>
              )}
              {bpm && isLive && (
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
            <div className="flex flex-wrap items-center gap-3 mt-5 pt-4 border-t border-gray-800">
              {/* Favorite button (star) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(show);
                }}
                disabled={isTogglingFavorite}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-sm"
                style={{ color: accentColor }}
              >
                {isTogglingFavorite ? (
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-4 h-4"
                    fill={isFavorited ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                    />
                  </svg>
                )}
                <span className="text-white">{isFavorited ? 'Favorited' : 'Favorite'}</span>
              </button>

              {/* Add DJ to Watchlist button */}
              {show.dj && !djInWatchlist && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToWatchlist(show.dj!, show.djUserId, show.djEmail);
                  }}
                  disabled={isAddingToWatchlist}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-sm"
                  style={{ color: accentColor }}
                >
                  {isAddingToWatchlist ? (
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
                  tipperUserId={userId}
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
    </>
  );
}
