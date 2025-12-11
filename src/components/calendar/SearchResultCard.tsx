"use client";

import { memo, useState } from "react";
import { Show, Station } from "@/types";
import { useAuthContext } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { AuthModal } from "@/components/AuthModal";
import { NotificationPrompt } from "@/components/NotificationPrompt";

interface SearchResultCardProps {
  show: Show;
  station: Station | undefined;
}

function SearchResultCardComponent({ show, station }: SearchResultCardProps) {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const { isAuthenticated } = useAuthContext();
  const { isShowFavorited, toggleFavorite } = useFavorites();
  const { hasFavoriteNotificationsEnabled } = useUserPreferences();

  const isFavorited = isShowFavorited(show);
  const accentColor = station?.accentColor || "#fff";

  // Check if this show is currently playing
  const now = new Date();
  const showStart = new Date(show.startTime);
  const showEnd = new Date(show.endTime);
  const isCurrentlyPlaying = showStart <= now && showEnd > now;

  // Check if this is a restream or playlist show (needs replay icon instead of red dot)
  const isRestreamOrPlaylist = show.type === 'playlist' || show.type === 'restream';

  const handleFavoriteClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    const wasNotFavorited = !isFavorited;
    await toggleFavorite(show);
    // Show notification prompt if user just favorited and hasn't enabled favorite notifications
    if (wasNotFavorited && !hasFavoriteNotificationsEnabled) {
      setShowNotificationPrompt(true);
    }
  };

  // Format day (Today, Tomorrow, or weekday)
  const formatDay = (date: Date) => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return "Tomorrow";
    } else {
      return date.toLocaleDateString([], { weekday: "short" });
    }
  };

  return (
    <>
      <div className="relative flex rounded-xl overflow-hidden bg-[#1a1a1a] border border-gray-800/50">

        {/* Left accent bar */}
        <div
          className="w-1 flex-shrink-0"
          style={{ backgroundColor: accentColor }}
        />

        <div className="flex-1 px-3 py-2.5">
          {/* Station name + star button */}
          <div className="flex items-center justify-between mb-1">
            <span
              className="text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: accentColor }}
            >
              {station?.name || show.stationId}
            </span>
            <button
              onClick={handleFavoriteClick}
              className="p-0.5 transition-colors"
              style={{ color: accentColor }}
              aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill={isFavorited ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </button>
          </div>

          {/* Show name */}
          <p className="font-medium text-white text-sm leading-snug line-clamp-2">
            {show.name}
            {/* Replay icon for restream/playlist shows */}
            {isRestreamOrPlaylist && (
              <svg
                className="w-3 h-3 inline-block ml-1 align-middle"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#9ca3af"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            )}
          </p>

          {/* DJ + Time */}
          <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
            {show.dj && (
              <>
                <span className="truncate max-w-[100px]">{show.dj}</span>
                <span className="text-gray-700">·</span>
              </>
            )}
            <span>
              {formatDay(showStart)} at{" "}
              {showStart.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
          </div>

          {/* Type badge - only show for weekly/monthly (restream/playlist have icon instead) */}
          {show.type && (show.type === 'weekly' || show.type === 'monthly') && (
            <div className="mt-1.5">
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
              >
                {show.type}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message="Sign in to save this show and get alerts"
      />

      {/* Notification Prompt */}
      <NotificationPrompt
        isOpen={showNotificationPrompt}
        onClose={() => setShowNotificationPrompt(false)}
      />
    </>
  );
}

export const SearchResultCard = memo(SearchResultCardComponent);
