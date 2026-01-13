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

/**
 * Calculate relative luminance of a hex color
 * Returns value between 0 (black) and 1 (white)
 */
function getLuminance(hexColor: string): number {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16) / 255;
  const g = parseInt(hex.substr(2, 2), 16) / 255;
  const b = parseInt(hex.substr(4, 2), 16) / 255;

  // Convert to linear RGB
  const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Get contrasting text color (black or white) for a given background color
 */
function getContrastTextColor(backgroundColor: string): string {
  const luminance = getLuminance(backgroundColor);
  // Use black text for light backgrounds (luminance > 0.5)
  return luminance > 0.5 ? '#000000' : '#ffffff';
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

  // Check if this show is currently playing
  const now = new Date();
  const showStart = new Date(show.startTime);
  const showEnd = new Date(show.endTime);
  const isCurrentlyPlaying = showStart <= now && showEnd > now;

  // Check if this is a restream or playlist show (needs replay icon instead of red dot)
  const isRestreamOrPlaylist = show.type === 'playlist' || show.type === 'restream';

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

        {/* Gradient overlay for currently playing shows */}
        {isCurrentlyPlaying && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `linear-gradient(180deg, ${accentColor}25 0%, transparent 60%)`,
            }}
          />
        )}

        {/* Top-right controls: chevron indicator + star */}
        <div className="absolute top-1 right-1 flex items-center gap-0.5 z-10">
          {/* Chevron indicator if expandable (has additional content beyond name/dj/time) */}
          {/* Debug: Check if show has expandable content */}
          {console.log(`[ShowBlock] ${show.name.substring(0,20)} - desc:${!!show.description} img:${!!show.imageUrl} djPhoto:${!!show.djPhotoUrl} djBio:${!!show.djBio} promo:${!!show.promoText}`)}
          {(show.description || show.imageUrl || show.djPhotoUrl || show.djBio || show.promoText) && (
            <svg
              className="w-3 h-3 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
          {/* Star icon for quick favorite */}
          <button
            onClick={handleFavoriteClick}
            className="p-0.5 transition-colors"
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
        </div>

        <div className="px-2 py-1.5 h-full flex pr-6 overflow-hidden relative gap-2">
          {/* Show image thumbnail when card is tall enough */}
          {show.imageUrl && height > 60 && (
            <div
              className="w-10 h-10 flex-shrink-0 rounded overflow-hidden bg-gray-800"
            >
              <img
                src={show.imageUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col">
          <p
            className="font-medium text-white text-xs leading-tight line-clamp-2"
            title={show.name}
          >
            {show.name}
            {/* Replay icon for restream/playlist shows */}
            {isRestreamOrPlaylist && (
              <svg
                className="w-2.5 h-2.5 inline-block ml-1 align-middle"
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
          {/* Badges row: only show for weekly/biweekly/monthly types (restream/playlist have icon instead) */}
          {show.type && height > 40 && (show.type === 'weekly' || show.type === 'biweekly' || show.type === 'monthly') && (
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ backgroundColor: accentColor, color: getContrastTextColor(accentColor) }}
              >
                {show.type}
              </span>
            </div>
          )}
          {show.dj && height > 50 && (
            <p className="text-gray-500 text-[10px] truncate mt-0.5">{show.dj}</p>
          )}
          {show.description && height > 80 && (
            <p className="text-gray-600 text-[10px] line-clamp-2 mt-1">{show.description}</p>
          )}
          </div>
        </div>

        {/* BPM badge in bottom right corner */}
        {badgeContent && (
          <div className="absolute bottom-1 right-1 text-[10px] text-gray-400 bg-black px-1.5 py-0.5 rounded flex items-center gap-1">
            <span>{badgeContent.icon}</span>
            <span>{badgeContent.text}</span>
          </div>
        )}
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
                {/* Show image */}
                {show.imageUrl && (
                  <div className="mb-3 rounded-lg overflow-hidden">
                    <img
                      src={show.imageUrl}
                      alt={show.name}
                      className="w-full h-32 object-cover"
                    />
                  </div>
                )}

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

                {/* DJ info with photo */}
                {(show.dj || show.djPhotoUrl) && (
                  <div className="flex items-center gap-3 mb-3">
                    {show.djPhotoUrl && (
                      <img
                        src={show.djPhotoUrl}
                        alt={show.dj || "DJ"}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    )}
                    <div>
                      {show.dj && <p className="text-white text-sm font-medium">{show.dj}</p>}
                      {show.djBio && <p className="text-gray-500 text-xs line-clamp-2">{show.djBio}</p>}
                    </div>
                  </div>
                )}

                {/* Time */}
                <div className="flex items-center gap-1.5 text-sm text-gray-500 mb-3">
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

                {/* Promo section (broadcast shows only) */}
                {show.promoText && (
                  <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-gray-800">
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
                      : "bg-[#252525] text-white border border-gray-800 hover:bg-[#303030]"
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
