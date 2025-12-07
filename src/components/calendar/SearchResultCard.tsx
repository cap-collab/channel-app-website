"use client";

import { memo, useState } from "react";
import { Show, Station } from "@/types";
import { useAuthContext } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { AuthModal } from "@/components/AuthModal";

interface SearchResultCardProps {
  show: Show;
  station: Station | undefined;
}

function SearchResultCardComponent({ show, station }: SearchResultCardProps) {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { isAuthenticated } = useAuthContext();
  const { isShowFavorited, toggleFavorite } = useFavorites();

  const isFavorited = isShowFavorited(show);
  const accentColor = station?.accentColor || "#fff";

  const handleFavoriteClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    await toggleFavorite(show);
  };

  const showStart = new Date(show.startTime);
  const showEnd = new Date(show.endTime);

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
      <div className="flex rounded-xl overflow-hidden bg-[#1a1a1a] border border-gray-800/50">
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
        </div>
      </div>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message="Sign in to save this show and get alerts"
      />
    </>
  );
}

export const SearchResultCard = memo(SearchResultCardComponent);
