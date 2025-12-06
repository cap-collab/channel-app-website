"use client";

import { memo, useState } from "react";
import { Show } from "@/types";
import { useAuthContext } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { useCalendarSync } from "@/hooks/useCalendarSync";
import { AuthModal } from "@/components/AuthModal";

interface ShowBlockProps {
  show: Show;
  pixelsPerHour: number;
  accentColor: string;
  dayStart: Date;
  stationName: string;
  stationUrl?: string;
  isHighlighted?: boolean;
}

function ShowBlockComponent({
  show,
  pixelsPerHour,
  accentColor,
  dayStart,
  stationName,
  stationUrl,
  isHighlighted = false,
}: ShowBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const { isAuthenticated } = useAuthContext();
  const { isShowFavorited, toggleFavorite } = useFavorites();
  const { isConnected: isCalendarConnected, addToCalendar, connectCalendar } = useCalendarSync();

  const isFavorited = isShowFavorited(show);

  const handleFavoriteClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    await toggleFavorite(show);
  };

  const handleCalendarClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    if (!isCalendarConnected) {
      await connectCalendar();
      return;
    }
    setCalendarLoading(true);
    await addToCalendar(show, stationName, stationUrl);
    setCalendarLoading(false);
  };

  const showStart = new Date(show.startTime);
  const showEnd = new Date(show.endTime);

  // Calculate position relative to day start
  const startMinutes =
    (showStart.getTime() - dayStart.getTime()) / (1000 * 60);
  const endMinutes = (showEnd.getTime() - dayStart.getTime()) / (1000 * 60);

  // Clamp to day boundaries (0 to 24 hours = 0 to 1440 minutes)
  const clampedStart = Math.max(0, startMinutes);
  const clampedEnd = Math.min(1440, endMinutes);

  if (clampedEnd <= 0 || clampedStart >= 1440) {
    return null; // Show is outside this day
  }

  const top = (clampedStart / 60) * pixelsPerHour;
  const height = ((clampedEnd - clampedStart) / 60) * pixelsPerHour;

  const minHeight = 36; // Minimum height for readability

  return (
    <div
      className={`absolute left-1 right-1 rounded overflow-hidden cursor-pointer transition-all hover:brightness-110 ${
        isHighlighted ? "ring-2 ring-white" : ""
      }`}
      style={{
        top,
        height: Math.max(height, minHeight),
        backgroundColor: `${accentColor}15`,
        borderBottom: `1px solid ${accentColor}30`,
      }}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      {/* Star icon for quick favorite */}
      <button
        onClick={handleFavoriteClick}
        className="absolute top-1 right-1 p-0.5 text-white/60 hover:text-white transition-colors z-10"
        aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
      >
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill={isFavorited ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      </button>

      <div className="px-2 py-1.5 h-full flex flex-col pr-6">
        <p
          className="font-medium text-white text-xs leading-tight truncate"
          title={show.name}
        >
          {show.name}
        </p>
        {show.dj && height > 50 && (
          <p className="text-gray-500 text-[10px] truncate mt-0.5">{show.dj}</p>
        )}
        {height > 70 && (
          <p className="text-gray-600 text-[10px] mt-auto">
            {showStart.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        )}
      </div>

      {/* Expanded overlay */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(false);
          }}
        >
          <div
            className="bg-black border border-gray-800 rounded-xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Accent bar */}
            <div
              className="h-1 w-12 rounded-full mb-5"
              style={{ backgroundColor: accentColor }}
            />

            <h3 className="text-xl font-bold text-white mb-1">{show.name}</h3>
            {show.dj && (
              <p className="text-gray-500 text-sm mb-4">{show.dj}</p>
            )}

            <div className="text-gray-400 text-sm mb-4 flex items-center gap-2">
              <span>
                {showStart.toLocaleDateString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <span className="text-gray-700">·</span>
              <span>
                {showStart.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                –{" "}
                {showEnd.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>

            {show.description && (
              <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                {show.description}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleFavoriteClick}
                className={`flex-1 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                  isFavorited
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : "bg-gray-900 text-white border border-gray-800 hover:bg-gray-800"
                }`}
              >
                <svg
                  className="w-5 h-5"
                  fill={isFavorited ? "currentColor" : "none"}
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                  />
                </svg>
                {isFavorited ? "Saved" : "Save"}
              </button>
              <button
                onClick={handleCalendarClick}
                disabled={calendarLoading}
                className="flex-1 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 bg-gray-900 text-white border border-gray-800 hover:bg-gray-800 disabled:opacity-50"
              >
                {calendarLoading ? (
                  <div className="w-5 h-5 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                )}
                {isCalendarConnected ? "Add to Cal" : "Connect Cal"}
              </button>
            </div>
            <button
              className="w-full mt-3 py-2 text-gray-500 text-sm hover:text-white transition-colors"
              onClick={() => setIsExpanded(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message="Sign in to save this show and get alerts"
      />
    </div>
  );
}

export const ShowBlock = memo(ShowBlockComponent);
