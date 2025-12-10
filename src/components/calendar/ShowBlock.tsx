"use client";

import { memo, useState } from "react";
import { Show } from "@/types";
import { useAuthContext } from "@/contexts/AuthContext";
import { useBPM } from "@/contexts/BPMContext";
import { useFavorites } from "@/hooks/useFavorites";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { AuthModal } from "@/components/AuthModal";
import { NotificationPrompt } from "@/components/NotificationPrompt";
import { getMetadataKeyByStationId } from "@/lib/stations";

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
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const { isAuthenticated } = useAuthContext();
  const { isShowFavorited, toggleFavorite } = useFavorites();
  const { hasFavoriteNotificationsEnabled } = useUserPreferences();
  const { stationBPM } = useBPM();

  const isFavorited = isShowFavorited(show);

  // Show needs red dot if NOT playlist or restream (i.e., "live" shows)
  const needsRedDot = !show.type || (show.type !== 'playlist' && show.type !== 'restream');

  // Check if this show is currently playing
  const now = new Date();
  const showStart = new Date(show.startTime);
  const showEnd = new Date(show.endTime);
  const isCurrentlyPlaying = showStart <= now && showEnd > now;

  // Get audio info for this station if the show is currently playing
  const metadataKey = getMetadataKeyByStationId(show.stationId);
  const audioInfo = isCurrentlyPlaying && metadataKey ? stationBPM[metadataKey] : undefined;

  // Get badge content based on audio info (matching mobile app icons)
  const getBadgeContent = (): { icon: React.ReactNode; text: string } | null => {
    if (!audioInfo) return null;

    const genre = audioInfo.genre || audioInfo.type;

    // Waveform icon for BPM
    const waveformIcon = (
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 3v18M6 7v10M18 7v10M3 10v4M21 10v4M9 5v14M15 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
    );

    // Music note icon
    const musicNoteIcon = (
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 18V5l12-2v13M9 18c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 1.34 3 3zM21 16c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 1.34 3 3z" />
      </svg>
    );

    // Mic icon for talk
    const micIcon = (
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );

    // Wind icon for ambient
    const windIcon = (
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2" />
      </svg>
    );

    // Speaker off icon for not playing
    const speakerOffIcon = (
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </svg>
    );

    if (genre === "electronic" || genre === "bpm") {
      if (audioInfo.bpm) {
        return { icon: waveformIcon, text: `${audioInfo.bpm} BPM` };
      }
      return null;
    }

    switch (genre) {
      case "rock":
        return { icon: musicNoteIcon, text: "Rock" };
      case "classical":
        return { icon: musicNoteIcon, text: "Classical" };
      case "jazz":
        return { icon: musicNoteIcon, text: "Jazz" };
      case "talk":
        return { icon: micIcon, text: "Talk" };
      case "ambient":
        return { icon: windIcon, text: "Ambient" };
      case "notPlaying":
        return { icon: speakerOffIcon, text: "Not playing" };
      default:
        return { icon: musicNoteIcon, text: "Other" };
    }
  };

  const badgeContent = getBadgeContent();

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

  // Calculate position relative to day start
  const startMinutes =
    (showStart.getTime() - dayStart.getTime()) / (1000 * 60);
  const endMinutes = (showEnd.getTime() - dayStart.getTime()) / (1000 * 60);

  // Calculate remaining minutes from dayStart to end of day (midnight)
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(24, 0, 0, 0);
  const remainingMinutes = (dayEnd.getTime() - dayStart.getTime()) / (1000 * 60);

  // Clamp to day boundaries
  const clampedStart = Math.max(0, startMinutes);
  const clampedEnd = Math.min(remainingMinutes, endMinutes);

  if (clampedEnd <= 0 || clampedStart >= remainingMinutes) {
    return null; // Show is outside visible area
  }

  const top = (clampedStart / 60) * pixelsPerHour;
  const height = ((clampedEnd - clampedStart) / 60) * pixelsPerHour;

  const minHeight = 36; // Minimum height for readability

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
      <div
        className={`absolute left-1 right-1 rounded cursor-pointer transition-all hover:brightness-110 overflow-hidden ${
          isHighlighted ? "ring-2 ring-white" : ""
        }`}
        style={{
          top,
          height: Math.max(height, minHeight),
          backgroundColor: "#1a1a1a",
          borderBottom: `1px solid ${accentColor}40`,
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Live indicator - top-left corner for live shows */}
        {needsRedDot && (
          <div className="absolute -top-1 -left-1 z-20">
            <div className="relative w-2.5 h-2.5">
              <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-75" />
              <div className="absolute inset-0 bg-red-500 rounded-full" />
            </div>
          </div>
        )}

        {/* Gradient overlay for currently playing shows */}
        {isCurrentlyPlaying && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `linear-gradient(180deg, ${accentColor}25 0%, transparent 60%)`,
            }}
          />
        )}

        {/* Star icon for quick favorite */}
        <button
          onClick={handleFavoriteClick}
          className="absolute top-1 right-1 p-0.5 transition-colors z-10"
          style={{ color: accentColor }}
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

        <div className="px-2 py-1.5 h-full flex flex-col pr-6 overflow-hidden relative">
          <p
            className="font-medium text-white text-xs leading-tight truncate"
            title={show.name}
          >
            {show.name}
          </p>
          {show.dj && height > 50 && (
            <p className="text-gray-500 text-[10px] truncate mt-0.5">{show.dj}</p>
          )}
          {show.description && height > 80 && (
            <p className="text-gray-600 text-[10px] line-clamp-2 mt-1">{show.description}</p>
          )}
        </div>

        {/* Bottom badges row: type badge and audio/BPM badge */}
        <div className="absolute bottom-1 right-1 flex items-center gap-1">
          {/* Type badge */}
          {show.type && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full"
              style={
                show.type === 'restream' || show.type === 'playlist'
                  ? { backgroundColor: '#000', color: '#9ca3af' }
                  : { backgroundColor: `${accentColor}20`, color: accentColor }
              }
            >
              {show.type}
            </span>
          )}
          {/* Audio badge for currently playing shows */}
          {badgeContent && (
            <div className="text-[10px] text-gray-400 bg-gray-800/80 px-1.5 py-0.5 rounded flex items-center gap-1">
              <span>{badgeContent.icon}</span>
              <span>{badgeContent.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* Expanded overlay - styled like SearchResultCard */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(false);
          }}
        >
          <div
            className="bg-black border border-gray-800 rounded-xl max-w-md w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Card styled like SearchResultCard */}
            <div className="flex">
              {/* Left accent bar */}
              <div
                className="w-1.5 flex-shrink-0 rounded-l-xl"
                style={{ backgroundColor: accentColor }}
              />

              <div className="flex-1 p-4">
                {/* Station name */}
                <div className="mb-2">
                  <span
                    className="text-xs font-semibold uppercase tracking-wide"
                    style={{ color: accentColor }}
                  >
                    {stationName}
                  </span>
                </div>

                {/* Show name */}
                <h3 className="font-semibold text-white text-lg leading-snug mb-1">
                  {show.name}
                </h3>

                {/* DJ + Time */}
                <div className="flex items-center gap-1.5 text-sm text-gray-500 mb-3">
                  {show.dj && (
                    <>
                      <span>{show.dj}</span>
                      <span className="text-gray-700">·</span>
                    </>
                  )}
                  <span>
                    {formatDay(showStart)} at{" "}
                    {showStart.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    {" – "}
                    {showEnd.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>

                {/* Description */}
                {show.description && (
                  <p className="text-gray-400 text-sm leading-relaxed mb-4">
                    {show.description}
                  </p>
                )}

                {/* Stream Now button - only for currently playing shows */}
                {isCurrentlyPlaying && stationUrl && (
                  <a
                    href={stationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 mb-2 bg-white text-black hover:bg-gray-100"
                  >
                    Stream Now
                  </a>
                )}

                {/* Save button */}
                <button
                  onClick={handleFavoriteClick}
                  className={`w-full py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                    isFavorited
                      ? "bg-white/20 text-white border border-white/30"
                      : "bg-gray-900 text-white border border-gray-800 hover:bg-gray-800"
                  }`}
                >
                  <svg
                    className="w-5 h-5"
                    fill={isFavorited ? "currentColor" : "none"}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  {isFavorited ? "Saved" : "Save"}
                </button>

                {/* Close button */}
                <button
                  className="w-full mt-2 py-2 text-gray-500 text-sm hover:text-white transition-colors"
                  onClick={() => setIsExpanded(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

export const ShowBlock = memo(ShowBlockComponent);
