"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { collection, query, where, getDocs, orderBy, Timestamp } from "firebase/firestore";
import { Header } from "@/components/Header";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { useSchedule } from "@/contexts/ScheduleContext";
import { useFavorites } from "@/hooks/useFavorites";
import { useUserProfile } from "@/hooks/useUserProfile";
import { AuthModal } from "@/components/AuthModal";
import { TipButton } from "@/components/channel/TipButton";
import { DJProfileChatPanel } from "@/components/dj-profile/DJProfileChatPanel";
import { useBroadcastStreamContext } from "@/contexts/BroadcastStreamContext";
import { useDJProfileChat } from "@/hooks/useDJProfileChat";
import { Show } from "@/types";
import { Archive } from "@/types/broadcast";
import { getStationById, getMetadataKeyByStationId } from "@/lib/stations";
import { useBPM } from "@/contexts/BPMContext";
import { wordBoundaryMatch } from "@/lib/dj-matching";
import { Venue, Collective, Event as ChannelEvent, EventDJRef, EventVenueRef, CollectiveRef } from "@/types/events";
import { generateSlug } from "@/lib/slug";
// Icon components (inline SVGs to avoid external dependencies)
const ShareIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
  </svg>
);

const ExternalLinkIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

const PauseIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
  </svg>
);


const InstagramIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
  </svg>
);

const GlobeIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
  </svg>
);

const MailIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

const SoundCloudIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24">
    <path d="M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.27-2.154c-.009-.06-.052-.1-.084-.1zm-.9 1.53c-.057 0-.097.045-.105.097l-.138 1.627.152 1.578c.008.058.048.097.105.097.05 0 .09-.039.098-.097l.168-1.578-.168-1.627c-.008-.052-.048-.097-.112-.097zm1.8-1.627c-.063 0-.112.047-.12.105l-.218 2.406.218 2.313c.008.063.057.112.12.112.058 0 .105-.049.12-.112l.24-2.313-.24-2.406c-.015-.058-.062-.105-.12-.105zm.9-.45c-.068 0-.12.052-.127.112l-.195 2.969.195 2.843c.007.063.059.112.127.112.063 0 .112-.049.127-.112l.217-2.843-.217-2.969c-.015-.06-.064-.112-.127-.112zm.9-.675c-.075 0-.135.06-.142.127l-.173 3.757.173 3.607c.007.068.067.127.142.127.068 0 .127-.059.135-.127l.195-3.607-.195-3.757c-.008-.067-.067-.127-.135-.127zm.9-.675c-.082 0-.142.067-.15.135l-.15 4.545.15 4.35c.008.075.068.135.15.135.075 0 .135-.06.15-.135l.165-4.35-.165-4.545c-.015-.068-.075-.135-.15-.135zm.9-.45c-.09 0-.157.068-.165.15l-.127 5.107.127 4.867c.008.082.075.15.165.15.082 0 .15-.068.157-.15l.142-4.867-.142-5.107c-.007-.082-.075-.15-.157-.15zm.9-.225c-.097 0-.172.075-.18.165l-.105 5.445.105 5.137c.008.09.083.165.18.165.09 0 .165-.075.172-.165l.12-5.137-.12-5.445c-.007-.09-.082-.165-.172-.165zm.9-.225c-.105 0-.18.082-.187.18l-.083 5.782.083 5.37c.007.098.082.18.187.18.097 0 .172-.082.18-.18l.09-5.37-.09-5.782c-.008-.098-.083-.18-.18-.18zm1.125-.225c-.112 0-.195.09-.202.195l-.068 6.12.068 5.602c.007.105.09.195.202.195.105 0 .187-.09.195-.195l.075-5.602-.075-6.12c-.008-.105-.09-.195-.195-.195zm.9 0c-.12 0-.21.097-.217.21l-.045 6.232.045 5.602c.007.112.097.21.217.21.113 0 .203-.098.21-.21l.053-5.602-.053-6.232c-.007-.113-.097-.21-.21-.21zm.9.225c-.127 0-.225.105-.232.225l-.023 6.12.023 5.602c.007.12.105.225.232.225.12 0 .218-.105.225-.225l.03-5.602-.03-6.12c-.007-.12-.105-.225-.225-.225zm1.125-.45c-.142 0-.255.112-.262.247l-.008 6.683.008 5.55c.007.135.12.247.262.247.135 0 .247-.112.255-.247l.015-5.55-.015-6.683c-.008-.135-.12-.247-.255-.247zm1.575-.225c-.15 0-.27.12-.285.27v.015l-.008 6.795.008 5.535c.015.15.135.27.285.27.142 0 .263-.12.277-.27l.015-5.535-.015-6.795c-.014-.15-.135-.27-.277-.285zm.9.225c-.157 0-.285.127-.3.285v6.75l.015 5.52c.015.157.143.285.285.285.15 0 .278-.128.285-.285l.015-5.52V6.915c-.007-.158-.135-.285-.3-.285zm.9-.225c-.165 0-.3.135-.307.3v6.75l.015 5.52c.007.165.142.3.307.3.157 0 .285-.135.3-.3l.015-5.52V6.69c-.015-.165-.143-.3-.33-.3zm4.95 1.35c-.375 0-.735.052-1.08.15-.232-2.61-2.437-4.65-5.137-4.65-.69 0-1.35.142-1.95.39-.232.098-.293.195-.3.39v9.36c.007.202.157.367.352.39h8.115c1.5 0 2.715-1.215 2.715-2.715s-1.215-2.715-2.715-2.715z"/>
  </svg>
);

const MixcloudIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24">
    <path d="M2.462 8.596l1.986 6.097 1.986-6.097h2.668l1.986 6.097 1.986-6.097h2.668l-3.307 9.808H9.767l-1.986-5.912-1.986 5.912H3.107L0 8.596h2.462zm19.552 0c1.099 0 1.986.896 1.986 1.999v5.81c0 1.103-.887 1.999-1.986 1.999-1.099 0-1.986-.896-1.986-1.999v-5.81c0-1.103.887-1.999 1.986-1.999zm-4.634 0c1.099 0 1.986.896 1.986 1.999v5.81c0 1.103-.887 1.999-1.986 1.999-1.099 0-1.986-.896-1.986-1.999v-5.81c0-1.103.887-1.999 1.986-1.999z"/>
  </svg>
);

const BandcampIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24">
    <path d="M0 18.75l7.437-13.5H24l-7.438 13.5H0z"/>
  </svg>
);

const YouTubeIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

const TwitterIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

// Helper to check if a URL is a Twitter/X link
const isTwitterLink = (url: string): boolean => {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'twitter.com' || hostname === 'www.twitter.com' ||
           hostname === 'x.com' || hostname === 'www.x.com';
  } catch {
    return false;
  }
};

// Helper functions for audio player
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Truncated bio component
const TruncatedBio = ({ bio, maxLines = 3 }: { bio: string; maxLines?: number }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [truncatedText, setTruncatedText] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const calculateTruncation = () => {
      if (!containerRef.current || !measureRef.current) {
        setTruncatedText(null);
        return;
      }

      const container = containerRef.current;
      const measure = measureRef.current;
      const containerWidth = container.offsetWidth;

      // Get actual computed line height (text-base leading-relaxed = 16px * 1.625 = 26px)
      const computedStyle = window.getComputedStyle(measure);
      const lineHeight = parseFloat(computedStyle.lineHeight) || 26;
      const maxHeight = lineHeight * maxLines + 2; // maxLines with small tolerance

      // Reset to measure full text
      measure.style.width = `${containerWidth}px`;
      measure.textContent = bio;

      // Check if truncation is needed
      if (measure.offsetHeight <= maxHeight) {
        setTruncatedText(null);
        return;
      }

      // Binary search to find text that fits in 3 lines with "... see more" inline
      let low = 0;
      let high = bio.length;
      let bestFit = '';

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const testText = bio.slice(0, mid);
        measure.textContent = testText + '... see more >';

        if (measure.offsetHeight <= maxHeight) {
          bestFit = testText;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      // Find a good word boundary (don't cut mid-word)
      let truncateAt = bestFit.length;
      const lastSpace = bestFit.lastIndexOf(' ');
      if (lastSpace > bestFit.length * 0.8 && lastSpace > 0) {
        truncateAt = lastSpace;
      }

      setTruncatedText(bio.slice(0, truncateAt));
    };

    const timer = setTimeout(calculateTruncation, 100);
    window.addEventListener('resize', calculateTruncation);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', calculateTruncation);
    };
  }, [bio, maxLines]);

  const needsTruncation = truncatedText !== null;
  const displayText = !isExpanded && needsTruncation ? truncatedText : bio;

  return (
    <div className="mb-4 relative" ref={containerRef}>
      {/* Hidden element for measuring - must match visible text styling exactly */}
      <span
        ref={measureRef}
        className="text-base leading-relaxed font-light absolute opacity-0 pointer-events-none -z-10"
        style={{ display: 'block', whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}
        aria-hidden="true"
      />

      {/* Visible content - editorial style with more spacing */}
      <p className="text-base leading-relaxed text-zinc-300 font-light">
        {displayText}
        {!isExpanded && needsTruncation && '... '}
        {needsTruncation && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="inline text-zinc-400 hover:text-white transition-colors"
          >
            {isExpanded ? 'see less' : 'see more'}
            <svg
              width={12}
              height={12}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              className={`inline ml-0.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              style={{ verticalAlign: 'middle', marginTop: '-2px' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </p>
    </div>
  );
};

// Past show without recording
interface PastShow {
  id: string;
  showName: string;
  startTime: number;
  endTime: number;
  showImageUrl?: string;
  stationId: string;
  stationName: string;
  showType?: string; // weekly, monthly, biweekly, regular, restream, playlist
}

interface CustomLink {
  label: string;
  url: string;
}

interface IrlShow {
  name?: string;
  location?: string;
  url?: string;
  venue?: string; // legacy field
  date: string;
  imageUrl?: string;
  venueId?: string;
  venueName?: string;
  linkedCollectives?: { collectiveId: string; collectiveName: string }[];
  djs?: { djName: string; djUserId?: string; djUsername?: string; djPhotoUrl?: string }[];
}

interface RadioShow {
  name?: string;
  radioName?: string;
  url?: string;
  date: string;
  time?: string;
  duration?: string; // in hours
  timezone?: string; // IANA timezone the time was entered in
}

interface DJProfile {
  chatUsername: string;
  email: string;
  djProfile: {
    bio: string | null;
    photoUrl: string | null;
    location: string | null;
    genres: string[];
    promoText: string | null;
    promoHyperlink: string | null;
    socialLinks: {
      instagram?: string;
      soundcloud?: string;
      bandcamp?: string;
      youtube?: string;
      bookingEmail?: string;
      mixcloud?: string;
      residentAdvisor?: string;
      website?: string;
      customLinks?: CustomLink[];
    };
    stripeAccountId: string | null;
    irlShows?: IrlShow[];
    radioShows?: RadioShow[];
    myRecs?: {
      bandcampLinks?: string[];
      eventLinks?: string[];
    };
  };
  uid: string;
}

interface UpcomingShow {
  id: string;
  showName: string;
  djName: string;
  startTime: number;
  endTime: number;
  status: string;
  description?: string;
  stationId: string;
  stationName: string;
  // For external shows (from /api/schedule)
  isExternal?: boolean;
  // Show image (from broadcast slot)
  showImageUrl?: string;
  // All DJs for multi-DJ restream display
  restreamDjs?: { name: string; userId?: string; username?: string; email?: string; photoUrl?: string }[];
  // Broadcast type (remote, venue, restream, recording)
  broadcastType?: string;
}

interface Props {
  username: string;
}

// Activity feed item type
type ActivityFeedItem =
  | (UpcomingShow & { feedType: "radio"; feedStatus: "upcoming" | "live" })
  | (RadioShow & { feedType: "dj-radio"; feedStatus: "upcoming" | "past"; id: string })
  | (Archive & { feedType: "recording"; feedStatus: "past" })
  | (PastShow & { feedType: "show"; feedStatus: "upcoming" | "past" })
  | (ChannelEvent & { feedType: "event"; feedStatus: "upcoming" | "past" });

// Word boundary matching for DJ/show names
// e.g. "PAC" matches "PAC" or "Night PAC" but NOT "pace" or "space"
function containsMatch(text: string, term: string): boolean {
  return wordBoundaryMatch(text, term);
}

// Calculate show progress percentage (0-100)
function calculateShowProgress(startTime: string, endTime: string): number {
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const total = end - start;
  const elapsed = now - start;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

// Normalize username for chat stationId (lowercase, no spaces/hyphens)
function normalizeUsername(chatUsername: string): string {
  return chatUsername.replace(/[\s-]+/g, "").toLowerCase();
}

export function DJPublicProfileClient({ username }: Props) {
  const { user, isAuthenticated } = useAuthContext();
  const { chatUsername, setChatUsername, loading: profileLoading } = useUserProfile(user?.uid);
  const { isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited, addToWatchlist, loading: favoritesLoading } = useFavorites();
  const { stationBPM } = useBPM();

  const [djProfile, setDjProfile] = useState<DJProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Live status
  const [liveOnChannel, setLiveOnChannel] = useState(false);
  const [liveElsewhere, setLiveElsewhere] = useState<{ stationName: string; stationUrl: string; stationAccentColor?: string } | null>(null);
  const { shows: allShows } = useSchedule();

  // Upcoming broadcasts
  const [upcomingBroadcasts, setUpcomingBroadcasts] = useState<UpcomingShow[]>([]);

  // Past recordings (archives with recordings)
  const [pastRecordings, setPastRecordings] = useState<Archive[]>([]);

  // Past external shows (from other stations like NTS, Subtle, etc.)
  const [pastExternalShows, setPastExternalShows] = useState<PastShow[]>([]);

  // Past Channel Radio shows (without recordings)
  const [pastBroadcastShows, setPastBroadcastShows] = useState<PastShow[]>([]);

  // Audio player state for recordings
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [currentTimes, setCurrentTimes] = useState<Record<string, number>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  // Subscribe state
  const [subscribing, setSubscribing] = useState(false);

  // Show popup state
  const [togglingFavoriteId, setTogglingFavoriteId] = useState<string | null>(null);
  const [copiedArchiveId, setCopiedArchiveId] = useState<string | null>(null);

  // Auto-profile state
  const [isAutoProfile, setIsAutoProfile] = useState(false);
  const [autoSources, setAutoSources] = useState<{ stationId: string; showName: string }[]>([]);

  // Linked entities state
  const [djVenues, setDjVenues] = useState<Venue[]>([]);
  const [djCollectives, setDjCollectives] = useState<Collective[]>([]);
  const [djUpcomingEvents, setDjUpcomingEvents] = useState<ChannelEvent[]>([]);
  const [djPastEvents, setDjPastEvents] = useState<ChannelEvent[]>([]);

  // Broadcast stream context for synced play/pause
  const { isPlaying, isLoading: streamLoading, toggle: toggleStream, isStreaming } = useBroadcastStreamContext();

  // Tab state for claimed profiles (with email)
  const [activeTab, setActiveTab] = useState<'timeline' | 'chat'>('timeline');
  const [hasSetDefaultTab, setHasSetDefaultTab] = useState(false);

  // Check if chat has messages to set default tab
  const chatNormalized = djProfile ? normalizeUsername(djProfile.chatUsername) : '';
  const { messages: chatMessages } = useDJProfileChat({
    chatUsernameNormalized: chatNormalized || 'noop',
    djUsername: djProfile?.chatUsername || '',
    enabled: !!djProfile?.email,
  });

  useEffect(() => {
    if (!hasSetDefaultTab && djProfile?.email && chatMessages.length > 0) {
      setActiveTab('chat');
      setHasSetDefaultTab(true);
    }
  }, [hasSetDefaultTab, djProfile?.email, chatMessages.length]);

  // Fetch DJ profile by username
  useEffect(() => {
    async function fetchDJProfile() {
      if (!db) {
        setLoading(false);
        setNotFound(true);
        return;
      }

      try {
        // Normalize the URL param: lowercase, remove spaces/hyphens
        const normalized = decodeURIComponent(username).replace(/[\s-]+/g, "").toLowerCase();

        // Check pending-dj-profiles FIRST (has public read, avoids permission issues)
        const pendingRef = collection(db, "pending-dj-profiles");
        const pendingQ = query(
          pendingRef,
          where("chatUsernameNormalized", "==", normalized)
        );
        const pendingSnapshot = await getDocs(pendingQ);

        // Use the first matching profile (no status filter - show page regardless of status)
        const pendingDoc = pendingSnapshot.docs[0];

        // Always check the users collection (Studio saves here, so it has the latest data)
        const usersRef = collection(db, "users");
        const q = query(
          usersRef,
          where("chatUsernameNormalized", "==", normalized),
          where("role", "in", ["dj", "broadcaster", "admin"])
        );
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          // Claimed account exists — always prefer users collection (Studio writes here)
          const doc = snapshot.docs[0];
          const data = doc.data();

          setDjProfile({
            chatUsername: data.chatUsername || "",
            email: data.email || "",
            djProfile: {
              bio: data.djProfile?.bio || null,
              photoUrl: data.djProfile?.photoUrl || null,
              location: data.djProfile?.location || null,
              genres: data.djProfile?.genres || [],
              promoText: data.djProfile?.promoText || null,
              promoHyperlink: data.djProfile?.promoHyperlink || null,
              socialLinks: data.djProfile?.socialLinks || {},
              stripeAccountId: data.djProfile?.stripeAccountId || null,
              irlShows: data.djProfile?.irlShows || [],
              radioShows: data.djProfile?.radioShows || [],
              myRecs: data.djProfile?.myRecs || {},
            },
            uid: doc.id,
          });
          setLoading(false);
        } else if (pendingDoc) {
          // No claimed account — fall back to pending profile
          const pendingData = pendingDoc.data();
          setDjProfile({
            chatUsername: pendingData.chatUsername || pendingData.djName || pendingData.chatUsernameNormalized || "",
            email: pendingData.email || "",
            djProfile: {
              bio: pendingData.djProfile?.bio || null,
              photoUrl: pendingData.djProfile?.photoUrl || null,
              location: pendingData.djProfile?.location || null,
              genres: pendingData.djProfile?.genres || [],
              promoText: pendingData.djProfile?.promoText || null,
              promoHyperlink: pendingData.djProfile?.promoHyperlink || null,
              socialLinks: pendingData.djProfile?.socialLinks || {},
              stripeAccountId: null,
              irlShows: pendingData.djProfile?.irlShows || [],
              radioShows: pendingData.djProfile?.radioShows || [],
              myRecs: pendingData.djProfile?.myRecs || {},
            },
            uid: `pending-${pendingDoc.id}`,
          });
          // Check if this is an auto-generated profile
          if (pendingData.source === "auto") {
            setIsAutoProfile(true);
            setAutoSources(pendingData.autoSources || []);
          }
          setLoading(false);
        } else {
          setNotFound(true);
          setLoading(false);
        }
      } catch (error) {
        console.error("Error fetching DJ profile:", error);
        setNotFound(true);
        setLoading(false);
      }
    }

    fetchDJProfile();
  }, [username]);


  // Live show state (for the dedicated live card)
  const [currentLiveShow, setCurrentLiveShow] = useState<Show | null>(null);
  const [liveShowProgress, setLiveShowProgress] = useState(0);

  // Check if DJ is live on Channel or elsewhere
  // For Channel broadcasts, also requires isStreaming (DJ actually publishing audio)
  useEffect(() => {
    if (!djProfile || allShows.length === 0) return;

    const now = Date.now();
    const djName = djProfile.chatUsername;

    // Normalize profile username for matching
    const normalizedProfileUsername = djName.replace(/[\s-]+/g, "").toLowerCase();

    // Check if live on Channel Radio
    const matchesProfile = (show: Show) =>
      show.djUsername === normalizedProfileUsername ||
      show.additionalDjUsernames?.includes(normalizedProfileUsername);

    const channelShow = allShows.find(
      (show) =>
        show.stationId === "broadcast" &&
        show.type === "live" &&
        new Date(show.startTime).getTime() <= now &&
        new Date(show.endTime).getTime() > now &&
        matchesProfile(show)
    );

    // Only show Channel live card if slot status is 'live' AND DJ is actually streaming audio
    if (channelShow && isStreaming) {
      setLiveOnChannel(true);
      setLiveElsewhere(null);
      setCurrentLiveShow(channelShow);
      return;
    }

    // Check if live elsewhere (external radio shows)
    const externalShow = allShows.find(
      (show) =>
        show.stationId !== "broadcast" &&
        new Date(show.startTime).getTime() <= now &&
        new Date(show.endTime).getTime() > now &&
        matchesProfile(show)
    );

    if (externalShow) {
      const station = getStationById(externalShow.stationId);
      setLiveElsewhere({
        stationName: station?.name || externalShow.stationId,
        stationUrl: station?.websiteUrl || "#",
        stationAccentColor: station?.accentColor,
      });
      setLiveOnChannel(false);
      setCurrentLiveShow(externalShow);
    } else {
      setLiveOnChannel(false);
      setLiveElsewhere(null);
      setCurrentLiveShow(null);
    }
  }, [djProfile, allShows, isStreaming]);

  // Update live show progress bar
  useEffect(() => {
    if (!currentLiveShow) {
      setLiveShowProgress(0);
      return;
    }

    const updateProgress = () => {
      const progress = calculateShowProgress(currentLiveShow.startTime, currentLiveShow.endTime);
      setLiveShowProgress(progress);
    };

    // Initial update
    updateProgress();

    // Update every second
    const interval = setInterval(updateProgress, 1000);

    return () => clearInterval(interval);
  }, [currentLiveShow]);

  // Fetch upcoming shows for this DJ (both broadcast slots and external radio shows)
  useEffect(() => {
    async function fetchUpcomingShows() {
      if (!djProfile) return;

      const now = Date.now();
      const upcomingShows: UpcomingShow[] = [];
      const seenIds = new Set<string>();

      // 1. Fetch broadcast slots from Firebase (Channel Radio)
      if (db) {
        try {
          const slotsRef = collection(db, "broadcast-slots");
          const q = query(
            slotsRef,
            where("endTime", ">", Timestamp.fromDate(new Date())),
            orderBy("endTime", "asc")
          );

          const snapshot = await getDocs(q);

          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            // Match by DJ username, name, or userId/email
            // Also check restreamDjs for multi-DJ restream archives
            const restreamDjMatch = data.restreamDjs && Array.isArray(data.restreamDjs) &&
              data.restreamDjs.some((dj: { userId?: string; username?: string; email?: string; name?: string }) =>
                dj.userId === djProfile.uid ||
                (dj.username && containsMatch(dj.username, djProfile.chatUsername)) ||
                (dj.email && djProfile.email && dj.email.toLowerCase() === djProfile.email.toLowerCase())
              );
            const isMatch =
              (data.djUsername && containsMatch(data.djUsername, djProfile.chatUsername)) ||
              (data.djName && containsMatch(data.djName, djProfile.chatUsername)) ||
              (data.liveDjUsername && containsMatch(data.liveDjUsername, djProfile.chatUsername)) ||
              data.djUserId === djProfile.uid ||
              (data.djEmail && djProfile.email && data.djEmail.toLowerCase() === djProfile.email.toLowerCase()) ||
              restreamDjMatch;

            if (isMatch) {
              const id = `broadcast-${docSnap.id}`;
              seenIds.add(id);

              // For restreams with multiple DJs, build DJ name with all names
              // Order: channel users first, pending DJs second, others after
              let djName = data.djName || djProfile.chatUsername;
              const restreamDjs = data.restreamDjs as UpcomingShow['restreamDjs'];
              if (restreamDjs && restreamDjs.length > 1) {
                const sortedDjs = [...restreamDjs].sort((a, b) => {
                  if (a.userId && !b.userId) return -1;
                  if (!a.userId && b.userId) return 1;
                  if (a.username && !b.username) return -1;
                  if (!a.username && b.username) return 1;
                  return 0;
                });
                djName = sortedDjs.map(dj => dj.name).join(', ');
              }

              upcomingShows.push({
                id,
                showName: data.showName || "Broadcast",
                djName,
                startTime: (data.startTime as Timestamp).toMillis(),
                endTime: (data.endTime as Timestamp).toMillis(),
                status: data.status,
                stationId: "broadcast",
                stationName: "Channel Radio",
                isExternal: false,
                showImageUrl: data.showImageUrl,
                restreamDjs,
                broadcastType: data.broadcastType as string | undefined,
              });
            }
          });
        } catch (error) {
          console.error("Error fetching broadcast slots:", error);
        }
      }

      // 2. Filter external radio shows by djUsername (pre-matched in metadata build)
      // Simple O(1) lookup - no regex matching needed!
      const normalizedProfileUsername = djProfile.chatUsername.replace(/[\s-]+/g, "").toLowerCase();

      allShows.forEach((show) => {
        // Skip broadcast shows (already handled above)
        if (show.stationId === "broadcast") return;

        // Skip dj-radio shows - these are added separately from djProfile.radioShows
        if (show.stationId === "dj-radio") return;

        // Skip replays and playlists
        if (show.type === "restream" || show.type === "playlist") return;

        // Skip shows that have already ended
        const endTime = new Date(show.endTime).getTime();
        if (endTime <= now) return;

        // Match by primary djUsername or additional profiles (for multi-DJ shows)
        if (show.djUsername === normalizedProfileUsername ||
            show.additionalDjUsernames?.includes(normalizedProfileUsername)) {
          const id = `external-${show.id}`;
          if (seenIds.has(id)) return;
          seenIds.add(id);

          const station = getStationById(show.stationId);
          upcomingShows.push({
            id,
            showName: show.name,
            djName: show.dj || djProfile.chatUsername,
            startTime: new Date(show.startTime).getTime(),
            endTime: endTime,
            status: new Date(show.startTime).getTime() <= now && endTime > now ? "live" : "scheduled",
            description: show.description,
            stationId: show.stationId,
            stationName: station?.name || show.stationId,
            isExternal: true,
            showImageUrl: show.imageUrl,
          });
        }
      });

      // Sort by start time
      upcomingShows.sort((a, b) => a.startTime - b.startTime);

      setUpcomingBroadcasts(upcomingShows);
    }

    fetchUpcomingShows();
  }, [djProfile, allShows]);

  // Fetch past shows and recordings for this DJ
  useEffect(() => {
    async function fetchPastShowsAndRecordings() {
      if (!djProfile || !db) return;
      try {
        const slotsRef = collection(db, "broadcast-slots");
        const pastSlotsMap = new Map<string, { showName: string; startTime: number; endTime: number; showImageUrl?: string }>();
        const djEmail = djProfile.email?.toLowerCase() || "";

        // Query 1: Past slots with root-level djEmail (remote broadcasts)
        const remoteQ = query(
          slotsRef,
          where("endTime", "<", Timestamp.fromDate(new Date())),
          where("djEmail", "==", djEmail)
        );
        const remoteSnapshot = await getDocs(remoteQ);
        remoteSnapshot.forEach((doc) => {
          const data = doc.data();
          pastSlotsMap.set(doc.id, {
            showName: data.showName || "Broadcast",
            startTime: (data.startTime as Timestamp).toMillis(),
            endTime: (data.endTime as Timestamp).toMillis(),
            showImageUrl: data.showImageUrl,
          });
        });

        // Query 2: Past venue slots (have djSlots array) - filter client-side
        const venueQ = query(
          slotsRef,
          where("endTime", "<", Timestamp.fromDate(new Date())),
          where("broadcastType", "==", "venue")
        );
        const venueSnapshot = await getDocs(venueQ);
        venueSnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.djSlots && Array.isArray(data.djSlots)) {
            const hasMatch = data.djSlots.some(
              (slot: { djEmail?: string }) =>
                slot.djEmail?.toLowerCase() === djEmail
            );
            if (hasMatch) {
              pastSlotsMap.set(doc.id, {
                showName: data.showName || "Broadcast",
                startTime: (data.startTime as Timestamp).toMillis(),
                endTime: (data.endTime as Timestamp).toMillis(),
                showImageUrl: data.showImageUrl,
              });
            }
          }
        });

        // Fetch archives and find which slots have recordings
        const res = await fetch("/api/archives");
        if (res.ok) {
          const data = await res.json();
          const archives: Archive[] = data.archives || [];

          // Find archives that match this DJ
          // For live broadcasts: match by broadcastSlotId being in pastSlotsMap
          // For recordings: match directly by DJ info in the archive's djs array
          const normalizedUsername = djProfile.chatUsername?.toLowerCase().replace(/\s+/g, '');
          const djUserId = djProfile.uid;

          const djArchives = archives.filter((archive) => {
            // Must have recording URL and be public
            if (!archive.recordingUrl || archive.isPublic === false) return false;

            // Check if this is the DJ's archive:
            // 1. For recordings (sourceType === 'recording'): match by userId or username in djs array
            // 2. For live broadcasts: match by broadcastSlotId in pastSlotsMap
            if (archive.sourceType === 'recording') {
              // Match recordings by DJ info
              return archive.djs?.some((dj) => {
                if (djUserId && dj.userId === djUserId) return true;
                if (dj.username && normalizedUsername) {
                  const archiveDjUsername = dj.username.toLowerCase().replace(/\s+/g, '');
                  return archiveDjUsername === normalizedUsername;
                }
                if (dj.email && djEmail) {
                  return dj.email.toLowerCase() === djEmail;
                }
                return false;
              });
            } else {
              // Match live broadcasts by slot
              return pastSlotsMap.has(archive.broadcastSlotId);
            }
          });
          setPastRecordings(djArchives);

          // Find broadcast slots that don't have a recording
          const slotsWithRecordings = new Set(
            djArchives
              .filter(a => a.broadcastSlotId)
              .map(a => a.broadcastSlotId)
          );

          const broadcastShowsWithoutRecordings: PastShow[] = [];
          pastSlotsMap.forEach((slot, slotId) => {
            if (!slotsWithRecordings.has(slotId)) {
              broadcastShowsWithoutRecordings.push({
                id: `broadcast-${slotId}`,
                showName: slot.showName,
                startTime: slot.startTime,
                endTime: slot.endTime,
                showImageUrl: slot.showImageUrl,
                stationId: "broadcast",
                stationName: "Channel Radio",
              });
            }
          });
          setPastBroadcastShows(broadcastShowsWithoutRecordings);
        }
      } catch (error) {
        console.error("Error fetching past shows:", error);
      }
    }
    fetchPastShowsAndRecordings();
  }, [djProfile]);

  // Fetch past external shows from history.json via API
  useEffect(() => {
    async function fetchPastExternalShows() {
      if (!djProfile) return;

      try {
        const normalizedUsername = (djProfile.chatUsername || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");

        if (!normalizedUsername) return;

        const res = await fetch(`/api/past-shows?dj=${normalizedUsername}`);
        if (!res.ok) return;

        const data = await res.json();
        const shows: PastShow[] = (data.shows || []).map(
          (show: { id: string; showName: string; startTime: string; endTime: string; stationId: string; stationName: string; showType?: string }) => ({
            id: show.id,
            showName: show.showName,
            startTime: new Date(show.startTime).getTime(),
            endTime: new Date(show.endTime).getTime(),
            stationId: show.stationId,
            stationName: show.stationName,
            showType: show.showType,
          })
        );

        setPastExternalShows(shows);
      } catch (error) {
        console.error("[DJ Profile] Error fetching past external shows:", error);
      }
    }

    fetchPastExternalShows();
  }, [djProfile]);

  // Fetch linked venues, collectives, and upcoming events
  useEffect(() => {
    async function fetchLinkedEntities() {
      if (!djProfile || !db) return;

      const normalizedUsername = djProfile.chatUsername.replace(/[\s-]+/g, "").toLowerCase();
      const djUserId = djProfile.uid.startsWith("pending-") ? undefined : djProfile.uid;

      const matchesDJ = (refs: EventDJRef[] | undefined): boolean => {
        if (!refs || refs.length === 0) return false;
        return refs.some(ref =>
          (ref.djUsername && ref.djUsername === normalizedUsername) ||
          (djUserId && ref.djUserId && ref.djUserId === djUserId)
        );
      };

      try {
        const [venuesSnapshot, collectivesSnapshot, eventsSnapshot] = await Promise.all([
          getDocs(collection(db, "venues")),
          getDocs(collection(db, "collectives")),
          getDocs(collection(db, "events")),
        ]);

        // Build venue photo lookup (all venues, for event fallback)
        const venuePhotoMap: Record<string, string> = {};
        const matchedVenues: Venue[] = [];
        venuesSnapshot.forEach((doc) => {
          const data = doc.data();
          if (data.photo) venuePhotoMap[doc.id] = data.photo;
          if (matchesDJ(data.residentDJs)) {
            matchedVenues.push({
              id: doc.id,
              name: data.name,
              slug: data.slug,
              photo: data.photo || null,
              location: data.location || null,
              description: data.description || null,
              genres: data.genres || [],
              socialLinks: data.socialLinks || {},
              residentDJs: data.residentDJs || [],
              createdAt: data.createdAt?.toMillis?.() || Date.now(),
              createdBy: data.createdBy,
            });
          }
        });
        setDjVenues(matchedVenues);

        const matchedCollectives: Collective[] = [];
        collectivesSnapshot.forEach((doc) => {
          const data = doc.data();
          if (matchesDJ(data.residentDJs)) {
            matchedCollectives.push({
              id: doc.id,
              name: data.name,
              slug: data.slug,
              photo: data.photo || null,
              location: data.location || null,
              description: data.description || null,
              genres: data.genres || [],
              socialLinks: data.socialLinks || {},
              residentDJs: data.residentDJs || [],
              linkedVenues: data.linkedVenues || [],
              createdAt: data.createdAt?.toMillis?.() || Date.now(),
              createdBy: data.createdBy,
            });
          }
        });
        setDjCollectives(matchedCollectives);

        const upcoming: ChannelEvent[] = [];
        const pastEvts: ChannelEvent[] = [];
        const now = Date.now();
        eventsSnapshot.forEach((doc) => {
          const data = doc.data();
          if (matchesDJ(data.djs)) {
            const event: ChannelEvent = {
              id: doc.id,
              name: data.name,
              slug: data.slug,
              date: data.date,
              endDate: data.endDate || undefined,
              photo: data.photo || (data.venueId && venuePhotoMap[data.venueId]) || null,
              description: data.description || null,
              venueId: data.venueId || null,
              venueName: data.venueName || null,
              collectiveId: data.collectiveId || null,
              collectiveName: data.collectiveName || null,
              djs: data.djs || [],
              linkedVenues: data.linkedVenues || [],
              linkedCollectives: data.linkedCollectives || [],
              genres: data.genres || [],
              location: data.location || null,
              ticketLink: data.ticketLink || null,
              createdAt: data.createdAt?.toMillis?.() || Date.now(),
              createdBy: data.createdBy,
            };
            if (event.date >= now) {
              upcoming.push(event);
            } else {
              pastEvts.push(event);
            }
          }
        });
        // Also include legacy inline irlShows (from djProfile) as ChannelEvents
        const inlineShows = djProfile?.djProfile?.irlShows || [];
        for (const show of inlineShows) {
          if (!show.date && !show.name) continue;
          const showDate = show.date ? new Date(show.date + "T12:00:00Z").getTime() : 0;
          // Skip if an event with the same name+date already exists (already migrated)
          const isDuplicate = [...upcoming, ...pastEvts].some(
            e => e.name === (show.name || "Event") && Math.abs(e.date - showDate) < 86400000
          );
          if (isDuplicate) continue;
          const inlineEvent: ChannelEvent = {
            id: `inline-${show.name}-${show.date}`,
            name: show.name || "Event",
            slug: "",
            date: showDate,
            photo: show.imageUrl || null,
            description: null,
            venueId: show.venueId || null,
            venueName: show.venueName || show.venue || null,
            collectiveId: null,
            collectiveName: null,
            djs: [],
            linkedVenues: show.venueId ? [{ venueId: show.venueId, venueName: show.venueName || "" }] : [],
            linkedCollectives: [],
            genres: [],
            location: show.location || null,
            ticketLink: show.url || null,
            createdAt: Date.now(),
            createdBy: "",
          };
          if (showDate >= now) {
            upcoming.push(inlineEvent);
          } else {
            pastEvts.push(inlineEvent);
          }
        }

        upcoming.sort((a, b) => a.date - b.date);
        pastEvts.sort((a, b) => b.date - a.date);
        setDjUpcomingEvents(upcoming);
        setDjPastEvents(pastEvts);
      } catch (error) {
        console.error("Error fetching linked entities:", error);
      }
    }

    fetchLinkedEntities();
  }, [djProfile]);

  // Subscribe/Unsubscribe handlers
  const isSubscribed = useMemo(() => {
    if (!djProfile) return false;
    return isInWatchlist(djProfile.chatUsername);
  }, [djProfile, isInWatchlist]);

  const handleSubscribe = async () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    if (!djProfile) return;

    setSubscribing(true);
    try {
      if (isSubscribed) {
        await removeFromWatchlist(djProfile.chatUsername);
      } else {
        // Use unified followDJ function - adds DJ to watchlist + auto-adds matching shows
        await followDJ(djProfile.chatUsername, djProfile.uid, djProfile.email);
      }
    } catch (error) {
      console.error("Error toggling subscription:", error);
    } finally {
      setSubscribing(false);
    }
  };

  // Format date for activity feed
  // Convert UpcomingShow to Show type for favorites compatibility
  const upcomingShowToShow = (show: UpcomingShow): Show => ({
    id: show.id,
    name: show.showName,
    dj: show.djName,
    startTime: new Date(show.startTime).toISOString(),
    endTime: new Date(show.endTime).toISOString(),
    stationId: show.stationId,
    description: show.description,
  });

  // Convert RadioShow to Show type for favorites compatibility
  const radioShowToShow = (show: RadioShow & { id: string }): Show => {
    const radioDate = show.date ? new Date(show.date) : new Date();
    let startTime = radioDate;
    let endTime = radioDate;

    if (show.time) {
      const [hours, minutes] = show.time.split(":").map(Number);
      startTime = new Date(radioDate);
      startTime.setHours(hours || 0, minutes || 0, 0, 0);
      const durationHours = parseFloat(show.duration || "1") || 1;
      endTime = new Date(startTime.getTime() + durationHours * 60 * 60 * 1000);
    }

    // Use "dj-radio" as stationId to match how /api/schedule returns these shows
    const stationId = "dj-radio";

    return {
      id: show.id,
      name: show.name || `Show on ${show.radioName}`,
      dj: djProfile?.chatUsername || "",
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      stationId,
    };
  };

  // Handle favorite toggle for a broadcast
  const handleToggleFavorite = async (broadcast: UpcomingShow, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    setTogglingFavoriteId(broadcast.id);
    await toggleFavorite(upcomingShowToShow(broadcast));
    setTogglingFavoriteId(null);
  };

  // Handle favorite toggle for a DJ radio show
  const handleToggleRadioShowFavorite = async (radioShow: RadioShow & { id: string }, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    setTogglingFavoriteId(radioShow.id);
    await toggleFavorite(radioShowToShow(radioShow));
    setTogglingFavoriteId(null);
  };

  // Audio player handlers for past recordings
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

  const handleTimeUpdate = (archiveId: string) => {
    const audio = audioRefs.current[archiveId];
    if (audio) {
      setCurrentTimes(prev => ({ ...prev, [archiveId]: audio.currentTime }));
    }
  };

  const handleEnded = (archiveId: string) => {
    setPlayingId(null);
    setCurrentTimes(prev => ({ ...prev, [archiveId]: 0 }));
  };

  // Create unified Activity Feed
  const { upcomingShows, pastActivities } = useMemo(() => {
    const upcoming: ActivityFeedItem[] = [];
    const past: ActivityFeedItem[] = [];
    const now = Date.now();

    // Add radio shows - only upcoming (live shows are handled separately)
    upcomingBroadcasts.forEach((show) => {
      // For Channel broadcasts, only treat as live if status is 'live' (DJ actually streaming)
      // For external shows, use time-based check
      const isLive = show.stationId === "broadcast"
        ? show.status === 'live'
        : show.startTime <= now && show.endTime > now;
      // Skip live shows - they're displayed in the dedicated live card above
      if (isLive) {
        return;
      }
      // Skip Channel broadcasts with status 'missed' or 'completed' that are within the time window
      // These should not appear as upcoming since the DJ didn't show up
      if (show.stationId === "broadcast" && (show.status === 'missed' || show.status === 'completed')) {
        return;
      }
      const item: ActivityFeedItem = {
        ...show,
        feedType: "radio",
        feedStatus: "upcoming",
      };
      upcoming.push(item);
    });

    // Helper: get the end timestamp for a show given date, time, duration, timezone
    const getShowEndTime = (date: string, time?: string, duration?: string, timezone?: string): number => {
      const durationHours = parseFloat(duration || "1") || 1;
      if (time) {
        // Parse the date+time in the show's timezone using Intl to find the UTC offset
        const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        // Parse as UTC first, then compute the offset for the target timezone
        const naiveUtc = new Date(`${date}T${time}:00Z`).getTime();
        // Format that UTC instant in the target timezone to find the offset
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        }).formatToParts(new Date(naiveUtc));
        const get = (t: string) => parts.find((p) => p.type === t)?.value || "0";
        const tzLocal = new Date(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`).getTime();
        const offsetMs = tzLocal - naiveUtc; // positive = ahead of UTC
        // The actual UTC start = naive UTC - offset (because the time was entered in that tz)
        const showStartUtc = naiveUtc - offsetMs;
        return showStartUtc + durationHours * 3600000;
      }
      // No time specified — consider it past after end of that day in viewer's timezone
      // new Date("YYYY-MM-DD") is UTC midnight; use local midnight + 24h instead
      return new Date(`${date}T23:59:59`).getTime();
    };

    // Add DJ radio shows - check if past or upcoming based on date + time + duration + timezone
    if (djProfile?.djProfile.radioShows) {
      djProfile.djProfile.radioShows
        .filter((show) => show.radioName || show.date)
        .forEach((show, i) => {
          const radioEndTime = show.date ? getShowEndTime(show.date, show.time, show.duration, show.timezone) : null;
          const isPastRadio = radioEndTime !== null && radioEndTime < now;
          const item: ActivityFeedItem = {
            ...show,
            feedType: "dj-radio",
            feedStatus: isPastRadio ? "past" : "upcoming",
            id: `dj-radio-${i}`,
          };
          if (isPastRadio) {
            past.push(item);
          } else {
            upcoming.push(item);
          }
        });
    }

    // Add past recordings
    pastRecordings.forEach((archive) => {
      past.push({
        ...archive,
        feedType: "recording",
        feedStatus: "past",
      });
    });

    // Add past Channel Radio shows (without recordings)
    pastBroadcastShows.forEach((show) => {
      const isPast = show.startTime < now;
      if (isPast) {
        past.push({
          ...show,
          feedType: "show",
          feedStatus: "past",
        });
      } else {
        upcoming.push({
          ...show,
          feedType: "show",
          feedStatus: "upcoming",
        });
      }
    });

    // Add past external shows (NTS, Subtle, dublab, etc.)
    pastExternalShows.forEach((show) => {
      const isPast = show.startTime < now;
      if (isPast) {
        past.push({
          ...show,
          feedType: "show",
          feedStatus: "past",
        });
      } else {
        upcoming.push({
          ...show,
          feedType: "show",
          feedStatus: "upcoming",
        });
      }
    });

    // Add IRL events from the events collection
    djUpcomingEvents.forEach((event) => {
      upcoming.push({ ...event, feedType: "event", feedStatus: "upcoming" });
    });
    djPastEvents.forEach((event) => {
      past.push({ ...event, feedType: "event", feedStatus: "past" });
    });

    // Sort upcoming by start time ascending
    const getItemTime = (item: ActivityFeedItem): number => {
      if ("startTime" in item && typeof item.startTime === "number") return item.startTime;
      if (item.feedType === "event") return item.date;
      if ("recordedAt" in item && typeof item.recordedAt === "number") return item.recordedAt;
      if ("date" in item && item.date) return new Date(item.date).getTime();
      return 0;
    };

    const sortUpcoming = (a: ActivityFeedItem, b: ActivityFeedItem) => getItemTime(a) - getItemTime(b);
    const sortPast = (a: ActivityFeedItem, b: ActivityFeedItem) => getItemTime(b) - getItemTime(a);

    upcoming.sort(sortUpcoming);
    past.sort(sortPast);

    return { upcomingShows: upcoming, pastActivities: past };
  }, [upcomingBroadcasts, pastRecordings, pastExternalShows, pastBroadcastShows, djProfile, djUpcomingEvents, djPastEvents]);

  // Create Artist Selects (recommendations)
  const artistSelects = useMemo(() => {
    const selects: { label: string; url: string; imageUrl?: string }[] = [];
    const myRecs = djProfile?.djProfile.myRecs;
    if (!myRecs) return selects;

    // New format: array of RecItem objects (saved from /studio)
    if (Array.isArray(myRecs)) {
      myRecs.forEach((rec: { type?: string; title?: string; url?: string; imageUrl?: string }) => {
        if (rec.url) {
          const label = rec.title || rec.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
          selects.push({ label, url: rec.url, imageUrl: rec.imageUrl });
        }
      });
    } else {
      // Legacy format: { bandcampLinks?: string[], eventLinks?: string[] }
      if (myRecs.bandcampLinks) {
        myRecs.bandcampLinks.forEach((url: string) => {
          const label = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
          selects.push({ label, url });
        });
      }
      if (myRecs.eventLinks) {
        myRecs.eventLinks.forEach((url: string) => {
          const label = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
          selects.push({ label, url });
        });
      }
    }

    return selects;
  }, [djProfile]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-black">
        <Header position="sticky" showSearch />
        <main className="max-w-5xl mx-auto px-6 py-16">
          <div className="text-center py-12">
            <p className="text-zinc-500 mb-4">DJ not found</p>
            <p className="text-zinc-600 text-sm">
              The DJ @{username} doesn&apos;t exist or hasn&apos;t set up their profile yet.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const profile = djProfile!;
  const socialLinks = profile.djProfile.socialLinks;

  return (
    <div className="min-h-screen text-white relative overflow-x-hidden">
      <AnimatedBackground />
      {/* Site-wide Header */}
      <Header position="sticky" showSearch />

      <main className="max-w-5xl mx-auto px-6 py-4 pb-24">
        {/* SECTION A: IDENTITY */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-6 mb-6 md:items-start">
          <div className="md:col-span-4">
            <div className="aspect-square bg-zinc-900 overflow-hidden border border-white/10">
              {profile.djProfile.photoUrl ? (
                <Image
                  src={profile.djProfile.photoUrl}
                  alt={profile.chatUsername}
                  width={400}
                  height={400}
                  className="w-full h-full object-cover"
                  unoptimized
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-24 h-24 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              )}
            </div>
          </div>

          <div className="md:col-span-8 flex flex-col">
            {/* Large: DJ Name */}
            <h1 className="text-4xl sm:text-7xl md:text-8xl font-black uppercase tracking-tighter leading-none mb-4 break-words">
              {profile.chatUsername}
            </h1>

            {/* Small & Grey: Location + Genres (Metadata Block) */}
            <div className="mb-6">
              {profile.djProfile.location && (
                <p className="text-zinc-500 text-xs uppercase tracking-[0.3em] mb-2">
                  {profile.djProfile.location}
                </p>
              )}
              {profile.djProfile.genres.length > 0 && (
                <p className="text-zinc-500 text-xs uppercase tracking-[0.2em]">
                  {profile.djProfile.genres.join(" · ")}
                </p>
              )}
            </div>

            {/* Medium: Promo + Bio */}
            <div className="max-w-xl space-y-4">
              {profile.djProfile.promoText && (
                profile.djProfile.promoHyperlink ? (
                  <a
                    href={profile.djProfile.promoHyperlink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full bg-zinc-900/50 p-4 rounded hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <p className="text-base leading-relaxed text-white">
                        {profile.djProfile.promoText}
                      </p>
                      <ExternalLinkIcon size={16} />
                    </div>
                  </a>
                ) : (
                  <div className="w-full bg-zinc-900/50 p-4 rounded">
                    <p className="text-base leading-relaxed text-white">
                      {profile.djProfile.promoText}
                    </p>
                  </div>
                )
              )}
              {profile.djProfile.bio && (
                <TruncatedBio bio={profile.djProfile.bio} />
              )}
            </div>

            {/* Venues & Collectives */}
            {(djVenues.length > 0 || djCollectives.length > 0) && (
              <div className="flex flex-wrap gap-2 mt-4">
                {djVenues.map((venue) => (
                  <Link
                    key={`venue-${venue.id}`}
                    href={`/venue/${venue.slug}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900/50 border border-white/10 rounded-full text-zinc-400 hover:text-white hover:border-white/20 transition-colors text-xs"
                  >
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    {venue.name}
                  </Link>
                ))}
                {djCollectives.map((col) => (
                  <Link
                    key={`collective-${col.id}`}
                    href={`/collective/${col.slug}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900/50 border border-white/10 rounded-full text-zinc-400 hover:text-white hover:border-white/20 transition-colors text-xs"
                  >
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    {col.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* LIVE SHOW CARD - Above tabs when DJ is live */}
        {currentLiveShow && (
          <section className="mb-4">
            <div className="bg-surface-card overflow-hidden">
              {/* Header: LIVE badge and radio name */}
              <div className="flex items-center justify-between px-4 py-3 bg-black/40">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-red-500 text-xs font-bold uppercase tracking-wide">
                    Live
                  </span>
                  {(() => {
                    const bpm = stationBPM[getMetadataKeyByStationId(currentLiveShow.stationId) || '']?.bpm;
                    return bpm ? (
                      <span className="text-[10px] font-mono text-red-500 uppercase tracking-tighter">
                        {bpm} BPM
                      </span>
                    ) : null;
                  })()}
                </div>
                <span className="text-zinc-400 text-xs">
                  {liveOnChannel ? "Channel" : liveElsewhere ? liveElsewhere.stationName : ""}
                </span>
              </div>

              {/* Show Info */}
              <div className="p-4 space-y-4">
                <div>
                  <h3 className="text-white text-xl font-bold">{currentLiveShow.name}</h3>
                </div>

                {/* Progress Bar - uses station accent color */}
                <div className="space-y-1">
                  <div className="h-1 bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full transition-all duration-1000 ease-linear"
                      style={{
                        width: `${liveShowProgress}%`,
                        backgroundColor: liveElsewhere?.stationAccentColor || '#D94099'
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>{new Date(currentLiveShow.startTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                    <span>{new Date(currentLiveShow.endTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>

                {/* Action Button */}
                {liveOnChannel ? (
                  <div className="flex gap-2">
                    <button
                      onClick={toggleStream}
                      disabled={streamLoading}
                      className="flex-1 min-w-0 py-3 px-2 sm:px-4 text-sm font-semibold bg-white hover:bg-white/90 text-black transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                    >
                      {streamLoading ? (
                        <svg className="w-4 h-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : isPlaying ? (
                        <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>
                    <button
                      onClick={() => {
                        if (!isAuthenticated) { setShowAuthModal(true); return; }
                        if (currentLiveShow) toggleFavorite(currentLiveShow);
                      }}
                      className="flex-1 min-w-0 py-3 px-2 sm:px-4 text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <svg className="w-4 h-4 shrink-0" fill={currentLiveShow && isShowFavorited(currentLiveShow) ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                      {currentLiveShow && isShowFavorited(currentLiveShow) ? "Reminded" : "Remind Me"}
                    </button>
                  </div>
                ) : liveElsewhere ? (
                  <div className="flex gap-2">
                    <a
                      href={liveElsewhere.stationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 min-w-0 py-3 px-2 sm:px-4 text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      Join Stream
                      <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                    <button
                      onClick={() => {
                        if (!isAuthenticated) { setShowAuthModal(true); return; }
                        if (currentLiveShow) toggleFavorite(currentLiveShow);
                      }}
                      className="flex-1 min-w-0 py-3 px-2 sm:px-4 text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <svg className="w-4 h-4 shrink-0" fill={currentLiveShow && isShowFavorited(currentLiveShow) ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                      {currentLiveShow && isShowFavorited(currentLiveShow) ? "Reminded" : "Remind Me"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        )}

        {/* STICKY TAB BAR - only if DJ has email (claimed profile) */}
        {profile.email && (
          <div className="sticky top-[48px] z-30 bg-black -mx-6 px-6 mb-4">
            <div className="flex max-w-5xl mx-auto bg-zinc-900/50 p-1">
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest transition-colors ${
                  activeTab === 'chat'
                    ? 'text-white bg-white/10'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setActiveTab('timeline')}
                className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest transition-colors ${
                  activeTab === 'timeline'
                    ? 'text-white bg-white/10'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Timeline
              </button>
            </div>
          </div>
        )}

        {/* TAB CONTENT */}
        {profile.email && activeTab === 'chat' ? (
          /* CHAT TAB */
          <div className="min-h-[60vh] -mx-6">
            <DJProfileChatPanel
              chatUsernameNormalized={normalizeUsername(profile.chatUsername)}
              djUserId={profile.uid}
              djUsername={profile.chatUsername}
              djEmail={profile.email}
              isAuthenticated={isAuthenticated}
              username={chatUsername || undefined}
              userId={user?.uid}
              profileLoading={profileLoading}
              onSetUsername={setChatUsername}
              isOwner={user?.uid === profile.uid}
            />
          </div>
        ) : (
          /* TIMELINE TAB (default, or when no email) */
          <>

        {/* SECTION: UPCOMING SHOWS (unified: online + IRL events) */}
        {(upcomingShows.length > 0) && (
          <section className="mb-6">
            <div className="space-y-3">
              {upcomingShows.map((item) => {
                if (item.feedType === "event") {
                  const event = item as ChannelEvent & { feedType: "event"; feedStatus: "upcoming" };
                  return (
                    <div
                      key={event.id}
                      className="bg-zinc-900/50 border border-white/10 rounded-lg overflow-hidden hover:bg-zinc-800/50 transition-colors"
                    >
                      {/* Header bar */}
                      <div className="grid grid-cols-3 items-center px-4 py-2 bg-black/40">
                        <span className="text-zinc-400 text-xs">
                          {new Date(event.date).toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        <span className="text-zinc-400 text-xs uppercase tracking-wider flex items-center justify-center gap-1">
                          <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2L8 8h2v3H8l-4 6h5v5h2v-5h5l-4-6h-2V8h2L12 2z" />
                          </svg>
                          IRL
                        </span>
                        <span className="text-zinc-400 text-xs text-right">
                          {event.location || ""}
                        </span>
                      </div>
                      {/* Body */}
                      <div className="p-4">
                        <div className="flex items-start gap-4">
                          {event.photo ? (
                            <Image
                              src={event.photo}
                              alt={event.name}
                              width={64}
                              height={64}
                              className="w-16 h-16 object-cover flex-shrink-0"
                              unoptimized
                            />
                          ) : (
                            <div className="w-16 h-16 bg-zinc-800 flex items-center justify-center flex-shrink-0">
                              <svg className="w-6 h-6 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                              </svg>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-medium mb-1">{event.name}</p>
                            {(event.linkedVenues?.length || event.venueName) && (
                              <p className="text-zinc-500 text-xs mb-1">
                                <svg className="inline-block w-2.5 h-2.5 -mt-0.5 mr-0.5" viewBox="0 0 24 36" fill="none">
                                  <circle cx="12" cy="12" r="10" fill="#ef4444" />
                                  <line x1="12" y1="22" x2="12" y2="35" stroke="#6b7280" strokeWidth="3" strokeLinecap="round" />
                                </svg>
                                {event.linkedVenues && event.linkedVenues.length > 0
                                  ? event.linkedVenues.map((v: EventVenueRef, vi: number) => (
                                      <span key={v.venueId}>
                                        <Link href={`/venue/${generateSlug(v.venueName)}`} className="hover:text-white transition-colors">{v.venueName}</Link>
                                        {vi < event.linkedVenues!.length - 1 && ", "}
                                      </span>
                                    ))
                                  : event.venueName
                                }
                              </p>
                            )}
                            {(event.djs.length > 0 || (event.linkedCollectives && event.linkedCollectives.length > 0)) && (
                              <div className="flex flex-wrap gap-1.5">
                                {event.djs.map((dj: EventDJRef, i: number) => (
                                  dj.djUsername ? (
                                    <Link
                                      key={`dj-${i}`}
                                      href={`/dj/${dj.djUsername}`}
                                      className="text-xs text-zinc-400 hover:text-white transition-colors"
                                    >
                                      {dj.djName}
                                      {(i < event.djs.length - 1 || (event.linkedCollectives && event.linkedCollectives.length > 0)) ? "," : ""}
                                    </Link>
                                  ) : (
                                    <span key={`dj-${i}`} className="text-xs text-zinc-400">
                                      {dj.djName}
                                      {(i < event.djs.length - 1 || (event.linkedCollectives && event.linkedCollectives.length > 0)) ? "," : ""}
                                    </span>
                                  )
                                ))}
                                {event.linkedCollectives?.map((coll: CollectiveRef, i: number) => (
                                  coll.collectiveSlug ? (
                                    <Link
                                      key={`coll-${coll.collectiveId}`}
                                      href={`/collective/${coll.collectiveSlug}`}
                                      className="text-xs text-zinc-400 hover:text-white transition-colors"
                                    >
                                      {coll.collectiveName}
                                      {i < (event.linkedCollectives?.length || 0) - 1 ? "," : ""}
                                    </Link>
                                  ) : (
                                    <span key={`coll-${coll.collectiveId}`} className="text-xs text-zinc-400">
                                      {coll.collectiveName}
                                      {i < (event.linkedCollectives?.length || 0) - 1 ? "," : ""}
                                    </span>
                                  )
                                ))}
                              </div>
                            )}
                          </div>
                          {event.ticketLink && (
                            <a
                              href={event.ticketLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-black text-xs font-medium rounded-full hover:bg-zinc-200 transition-colors flex-shrink-0"
                            >
                              Tickets
                              <ExternalLinkIcon size={10} />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
                if (item.feedType === "radio") {
                  const broadcast = item as UpcomingShow & { feedType: "radio"; feedStatus: "upcoming" };
                  const showAsShow = upcomingShowToShow(broadcast);
                  const isFavorited = isShowFavorited(showAsShow);
                  const isToggling = togglingFavoriteId === broadcast.id;
                  const stationAccentColor = getStationById(broadcast.stationId)?.accentColor;

                  // Format date and time for header
                  const showDate = new Date(broadcast.startTime);
                  const dateStr = showDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  const timeStr = showDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

                  return (
                    <div
                      key={broadcast.id}
                      className="bg-zinc-900/50 border border-white/10 rounded-lg overflow-hidden"
                    >
                      {/* Header bar */}
                      <div className="grid grid-cols-3 items-center px-4 py-2 bg-black/40">
                        <span className="text-zinc-400 text-xs">
                          {dateStr} · {timeStr}
                        </span>
                        <span className="text-zinc-400 text-xs uppercase tracking-wider flex items-center justify-center gap-1">
                          <svg className="w-3 h-3 text-sky-300" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
                          </svg>
                          Online
                        </span>
                        <span className="text-zinc-400 text-xs text-right">
                          {broadcast.stationName}
                        </span>
                      </div>

                      {/* Body */}
                      <div className="p-4 space-y-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-white font-medium">{broadcast.showName}</h3>
                            {broadcast.djName && (
                              <p className="text-zinc-400 text-sm mt-0.5">{broadcast.djName}</p>
                            )}
                          </div>
                          {broadcast.stationId === "broadcast" && (
                            <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm px-2 py-1 rounded-sm flex-shrink-0">
                              {broadcast.broadcastType === "restream" ? (
                                <>
                                  <span className="relative flex h-3 w-3">
                                    <svg className="animate-ping absolute inset-0 w-3 h-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                      <path d="M3 3v5h5" />
                                    </svg>
                                    <svg className="relative w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                      <path d="M3 3v5h5" />
                                    </svg>
                                  </span>
                                  <span className="text-[10px] font-mono text-gray-400 uppercase tracking-tighter font-bold">Restream</span>
                                </>
                              ) : (
                                <>
                                  <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
                                  </span>
                                  <span className="text-[10px] font-mono text-red-500 uppercase tracking-tighter font-bold">Live</span>
                                </>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Time Bar */}
                        <div className="space-y-1">
                          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full w-0"
                              style={{
                                backgroundColor: stationAccentColor || '#D94099'
                              }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] text-zinc-500">
                            <span>{new Date(broadcast.startTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                            <span>{new Date(broadcast.endTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                        </div>

                        {/* Action Button */}
                        <button
                          onClick={(e) => handleToggleFavorite(broadcast, e)}
                          disabled={isToggling}
                          className="w-full py-3 px-4 rounded text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center gap-2"
                        >
                          {isToggling ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill={isFavorited ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                              </svg>
                              {isFavorited ? "Reminded" : "Remind Me"}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                }

                if (item.feedType === "dj-radio") {
                  const radioShow = item as RadioShow & { feedType: "dj-radio"; feedStatus: "upcoming"; id: string };
                  const showTz = radioShow.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
                  // Parse date+time in the show's timezone to get the correct UTC instant
                  let showStartUtc: number | null = null;
                  let showEndUtc: number | null = null;
                  if (radioShow.date && radioShow.time) {
                    const naiveUtc = new Date(`${radioShow.date}T${radioShow.time}:00Z`).getTime();
                    const parts = new Intl.DateTimeFormat("en-US", {
                      timeZone: showTz, year: "numeric", month: "2-digit", day: "2-digit",
                      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
                    }).formatToParts(new Date(naiveUtc));
                    const get = (t: string) => parts.find((p) => p.type === t)?.value || "0";
                    const tzLocal = new Date(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`).getTime();
                    const offsetMs = tzLocal - naiveUtc;
                    showStartUtc = naiveUtc - offsetMs;
                    const durationHours = parseFloat(radioShow.duration || "1") || 1;
                    showEndUtc = showStartUtc + durationHours * 3600000;
                  }
                  // Display date/time in the viewer's local timezone from the correct UTC instant
                  const dateStr = showStartUtc !== null
                    ? new Date(showStartUtc).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    : radioShow.date
                      ? new Date(radioShow.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                      : "TBA";
                  const timeStr = showStartUtc !== null
                    ? new Date(showStartUtc).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                    : "";

                  // Check if show is currently live
                  const nowMs = Date.now();
                  const isLive = showStartUtc !== null && showEndUtc !== null && nowMs >= showStartUtc && nowMs < showEndUtc;

                  // Check favorite status for this radio show
                  const showAsShow = radioShowToShow(radioShow);
                  const isFavorited = isShowFavorited(showAsShow);
                  const isToggling = togglingFavoriteId === radioShow.id;

                  return (
                    <div
                      key={radioShow.id}
                      className="bg-zinc-900/50 border border-white/10 rounded-lg overflow-hidden"
                    >
                      {/* Header bar */}
                      <div className="grid grid-cols-3 items-center px-4 py-2 bg-black/40">
                        <span className="text-zinc-400 text-xs">
                          {dateStr}{timeStr ? ` · ${timeStr}` : ""}
                        </span>
                        <span className="text-zinc-400 text-xs uppercase tracking-wider flex items-center justify-center gap-1">
                          <svg className="w-3 h-3 text-sky-300" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
                          </svg>
                          Online
                        </span>
                        <span className="text-zinc-400 text-xs text-right">
                          {radioShow.radioName || "Radio"}
                        </span>
                      </div>

                      {/* Body */}
                      <div className="p-4 space-y-4">
                        <div>
                          <h3 className="text-white font-medium">
                            {radioShow.name || `On ${radioShow.radioName}`}
                          </h3>
                        </div>

                        {/* Time Bar - show when time and duration available */}
                        {showStartUtc !== null && showEndUtc !== null && (() => {
                          return (
                            <div className="space-y-1">
                              <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full"
                                  style={{
                                    width: isLive ? `${Math.min(100, Math.max(0, (nowMs - showStartUtc) / (showEndUtc - showStartUtc) * 100))}%` : '0%',
                                    backgroundColor: '#D94099'
                                  }}
                                />
                              </div>
                              <div className="flex justify-between text-[10px] text-zinc-500">
                                <span>{new Date(showStartUtc).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                                <span>{new Date(showEndUtc).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Action Buttons - Join Stream + Add to Favorites if live, otherwise Remind Me */}
                        {isLive && radioShow.url ? (
                          <div className="flex gap-2">
                            <a
                              href={radioShow.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 min-w-0 py-3 px-2 sm:px-4 rounded text-sm font-semibold bg-accent hover:bg-accent/80 text-white transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                            >
                              <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                              Join Stream
                            </a>
                            <button
                              onClick={(e) => handleToggleRadioShowFavorite(radioShow, e)}
                              disabled={isToggling}
                              className="flex-1 min-w-0 py-3 px-2 sm:px-4 rounded text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                            >
                              {isToggling ? (
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <>
                                  <svg className="w-4 h-4 shrink-0" fill={isFavorited ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                  </svg>
                                  {isFavorited ? "Reminded" : "Remind Me"}
                                </>
                              )}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => handleToggleRadioShowFavorite(radioShow, e)}
                            disabled={isToggling}
                            className="w-full py-3 px-4 rounded text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center gap-2"
                          >
                            {isToggling ? (
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill={isFavorited ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                </svg>
                                {isFavorited ? "Reminded" : "Remind Me"}
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }

                return null;
              })}
            </div>
          </section>
        )}

        {/* SECTION: PAST ACTIVITIES */}
        {pastActivities.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[10px] uppercase tracking-[0.5em] text-zinc-500 mb-3 border-b border-white/10 pb-2">
              Past Activities
            </h2>

            <div className="space-y-3">
              {pastActivities.map((item) => {
                if (item.feedType === "event") {
                  const event = item as ChannelEvent & { feedType: "event"; feedStatus: "past" };
                  return (
                    <div
                      key={event.id}
                      className="bg-zinc-900/50 border border-white/10 rounded-lg overflow-hidden hover:bg-zinc-800/50 transition-colors"
                    >
                      {/* Header bar */}
                      <div className="grid grid-cols-3 items-center px-4 py-2 bg-black/40">
                        <span className="text-zinc-400 text-xs">
                          {new Date(event.date).toLocaleDateString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        <span className="text-zinc-400 text-xs uppercase tracking-wider flex items-center justify-center gap-1">
                          <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2L8 8h2v3H8l-4 6h5v5h2v-5h5l-4-6h-2V8h2L12 2z" />
                          </svg>
                          IRL
                        </span>
                        <span className="text-zinc-400 text-xs text-right">
                          {event.location || ""}
                        </span>
                      </div>
                      {/* Body */}
                      <div className="p-4">
                        <div className="flex items-start gap-4">
                          {event.photo ? (
                            <Image
                              src={event.photo}
                              alt={event.name}
                              width={64}
                              height={64}
                              className="w-16 h-16 object-cover flex-shrink-0"
                              unoptimized
                            />
                          ) : (
                            <div className="w-16 h-16 bg-zinc-800 flex items-center justify-center flex-shrink-0">
                              <svg className="w-6 h-6 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                              </svg>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-medium mb-1">{event.name}</p>
                            {(event.linkedVenues?.length || event.venueName) && (
                              <p className="text-zinc-500 text-xs mb-1">
                                <svg className="inline-block w-2.5 h-2.5 -mt-0.5 mr-0.5" viewBox="0 0 24 36" fill="none">
                                  <circle cx="12" cy="12" r="10" fill="#ef4444" />
                                  <line x1="12" y1="22" x2="12" y2="35" stroke="#6b7280" strokeWidth="3" strokeLinecap="round" />
                                </svg>
                                {event.linkedVenues && event.linkedVenues.length > 0
                                  ? event.linkedVenues.map((v: EventVenueRef, vi: number) => (
                                      <span key={v.venueId}>
                                        <Link href={`/venue/${generateSlug(v.venueName)}`} className="hover:text-white transition-colors">{v.venueName}</Link>
                                        {vi < event.linkedVenues!.length - 1 && ", "}
                                      </span>
                                    ))
                                  : event.venueName
                                }
                              </p>
                            )}
                            {(event.djs.length > 0 || (event.linkedCollectives && event.linkedCollectives.length > 0)) && (
                              <div className="flex flex-wrap gap-1.5">
                                {event.djs.map((dj: EventDJRef, i: number) => (
                                  dj.djUsername ? (
                                    <Link
                                      key={`dj-${i}`}
                                      href={`/dj/${dj.djUsername}`}
                                      className="text-xs text-zinc-400 hover:text-white transition-colors"
                                    >
                                      {dj.djName}
                                      {(i < event.djs.length - 1 || (event.linkedCollectives && event.linkedCollectives.length > 0)) ? "," : ""}
                                    </Link>
                                  ) : (
                                    <span key={`dj-${i}`} className="text-xs text-zinc-400">
                                      {dj.djName}
                                      {(i < event.djs.length - 1 || (event.linkedCollectives && event.linkedCollectives.length > 0)) ? "," : ""}
                                    </span>
                                  )
                                ))}
                                {event.linkedCollectives?.map((coll: CollectiveRef, i: number) => (
                                  coll.collectiveSlug ? (
                                    <Link
                                      key={`coll-${coll.collectiveId}`}
                                      href={`/collective/${coll.collectiveSlug}`}
                                      className="text-xs text-zinc-400 hover:text-white transition-colors"
                                    >
                                      {coll.collectiveName}
                                      {i < (event.linkedCollectives?.length || 0) - 1 ? "," : ""}
                                    </Link>
                                  ) : (
                                    <span key={`coll-${coll.collectiveId}`} className="text-xs text-zinc-400">
                                      {coll.collectiveName}
                                      {i < (event.linkedCollectives?.length || 0) - 1 ? "," : ""}
                                    </span>
                                  )
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                if (item.feedType === "dj-radio") {
                  const radioShow = item as RadioShow & { feedType: "dj-radio"; feedStatus: "past"; id: string };
                  const showName = radioShow.name || `On ${radioShow.radioName}`;
                  const isWatching = isInWatchlist(showName);
                  const isToggling = togglingFavoriteId === radioShow.id;
                  const dateStr = radioShow.date
                    ? new Date(radioShow.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    : "TBA";
                  return (
                    <div key={radioShow.id} className="bg-zinc-900/50 border border-white/10 rounded-lg overflow-hidden">
                      {/* Header bar */}
                      <div className="grid grid-cols-3 items-center px-4 py-2 bg-black/40">
                        <span className="text-zinc-400 text-xs">
                          {dateStr}
                        </span>
                        <span className="text-zinc-400 text-xs uppercase tracking-wider flex items-center justify-center gap-1">
                          <svg className="w-3 h-3 text-sky-300" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
                          </svg>
                          Online
                        </span>
                        <span className="text-zinc-400 text-xs text-right">
                          {radioShow.radioName || "Radio"}
                        </span>
                      </div>
                      {/* Body */}
                      <div className="p-4 space-y-4">
                        <p className="text-white font-medium">{showName}</p>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!user) {
                              setShowAuthModal(true);
                              return;
                            }
                            setTogglingFavoriteId(radioShow.id);
                            await addToWatchlist(showName);
                            setTogglingFavoriteId(null);
                          }}
                          disabled={isToggling || isWatching}
                          className={`w-full py-3 px-4 rounded text-sm font-semibold transition-colors flex items-center justify-center gap-1 disabled:opacity-50 ${
                            isWatching ? 'bg-white/10 text-gray-400 cursor-default' : 'bg-white/10 hover:bg-white/20 text-white'
                          }`}
                        >
                          {isToggling ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : isWatching ? (
                            <><svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg> Watchlist</>
                          ) : (
                            <><svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg> Watchlist</>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                }

                if (item.feedType === "recording") {
                  const archive = item as Archive & { feedType: "recording"; feedStatus: "past" };
                  const isPlaying = playingId === archive.id;
                  const currentTime = currentTimes[archive.id] || 0;
                  const showImage = archive.showImageUrl;
                  const recordingDate = new Date(archive.recordedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  const stationName = getStationById(archive.stationId)?.name || "Channel Radio";

                  return (
                    <div key={archive.id} className="bg-zinc-900/50 border border-white/10 rounded-lg overflow-hidden">
                      {/* Header bar */}
                      <div className="grid grid-cols-3 items-center px-4 py-2 bg-black/40">
                        <span className="text-zinc-400 text-xs">
                          {recordingDate}
                        </span>
                        <span className="text-zinc-400 text-xs uppercase tracking-wider flex items-center justify-center gap-1">
                          <svg className="w-3 h-3 text-sky-300" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
                          </svg>
                          Online
                        </span>
                        <span className="text-zinc-400 text-xs text-right">
                          {stationName}
                        </span>
                      </div>
                      {/* Body */}
                      <div className="p-4">
                        <div className="flex items-start gap-4">
                          {showImage && (
                            <div className="w-16 h-16 rounded bg-zinc-800 flex-shrink-0 overflow-hidden">
                              <Image
                                src={showImage}
                                alt={archive.showName}
                                width={64}
                                height={64}
                                className="w-full h-full object-cover"
                                unoptimized
                              />
                            </div>
                          )}
                          <div className="flex-1 min-w-0 flex flex-col justify-between" style={showImage ? { minHeight: '64px' } : undefined}>
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-white font-medium">{archive.showName}</p>
                                <div className="relative flex-shrink-0">
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const archiveUrl = `${window.location.origin}/archives/${archive.slug}`;
                                      await navigator.clipboard.writeText(archiveUrl);
                                      setCopiedArchiveId(archive.id);
                                      setTimeout(() => setCopiedArchiveId(null), 2000);
                                    }}
                                    className="w-7 h-7 rounded-full flex items-center justify-center transition-all text-xs bg-white/10 hover:bg-white/20 text-white"
                                    title="Copy archive link"
                                  >
                                    {copiedArchiveId === archive.id ? (
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    ) : (
                                      <ShareIcon size={14} />
                                    )}
                                  </button>
                                  {copiedArchiveId === archive.id && (
                                    <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 bg-black text-white text-xs px-2 py-0.5 rounded whitespace-nowrap z-10">
                                      Copied!
                                    </div>
                                  )}
                                </div>
                              </div>
                              {archive.djs && archive.djs.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                  {archive.djs.map((dj, i) => (
                                    dj.username ? (
                                      <Link
                                        key={`dj-${i}`}
                                        href={`/dj/${dj.username}`}
                                        className="text-xs text-zinc-400 hover:text-white transition-colors"
                                      >
                                        {dj.name}
                                        {i < archive.djs.length - 1 ? "," : ""}
                                      </Link>
                                    ) : (
                                      <span key={`dj-${i}`} className="text-xs text-zinc-400">
                                        {dj.name}
                                        {i < archive.djs.length - 1 ? "," : ""}
                                      </span>
                                    )
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Player — aligned with bottom of image */}
                            <div className="flex items-center gap-2 mt-1">
                              <button
                                onClick={() => handlePlayPause(archive.id)}
                                className="w-7 h-7 rounded bg-white flex items-center justify-center hover:bg-gray-100 transition-colors flex-shrink-0 text-black"
                              >
                                {isPlaying ? (
                                  <PauseIcon size={12} />
                                ) : (
                                  <svg className="w-3 h-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                  </svg>
                                )}
                              </button>
                              <div className="flex-1 min-w-0 space-y-0.5">
                                <input
                                  type="range"
                                  min={0}
                                  max={archive.duration || 100}
                                  value={currentTime}
                                  onChange={(e) => handleSeek(archive.id, parseFloat(e.target.value))}
                                  className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                />
                                <div className="flex justify-between text-[10px] text-zinc-500">
                                  <span>{formatDuration(currentTime)}</span>
                                  <span>{formatDuration(archive.duration)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <audio
                        ref={(el) => { audioRefs.current[archive.id] = el; }}
                        src={archive.recordingUrl}
                        preload="none"
                        onTimeUpdate={() => handleTimeUpdate(archive.id)}
                        onEnded={() => handleEnded(archive.id)}
                      />
                    </div>
                  );
                }

                if (item.feedType === "show") {
                  const pastShow = item as PastShow & { feedType: "show"; feedStatus: "past" };
                  const isWatching = isInWatchlist(pastShow.showName);
                  const isToggling = togglingFavoriteId === pastShow.id;
                  const stationAccentColor = getStationById(pastShow.stationId)?.accentColor;

                  // Format date for header
                  const showDate = new Date(pastShow.startTime);
                  const dateStr = showDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

                  return (
                    <div
                      key={pastShow.id}
                      className="bg-zinc-900/50 border border-white/10 rounded-lg overflow-hidden"
                    >
                      {/* Header bar */}
                      <div className="grid grid-cols-3 items-center px-4 py-2 bg-black/40">
                        <span className="text-zinc-400 text-xs">
                          {dateStr}
                        </span>
                        <span className="text-zinc-400 text-xs uppercase tracking-wider flex items-center justify-center gap-1">
                          <svg className="w-3 h-3 text-sky-300" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
                          </svg>
                          Online
                        </span>
                        <span className="text-zinc-400 text-xs text-right">
                          {pastShow.stationName}
                        </span>
                      </div>

                      {/* Body */}
                      <div className="p-4 space-y-4">
                        <div>
                          <h3 className="text-white font-medium">{pastShow.showName}</h3>
                        </div>

                        {/* Action Button: Add to watchlist */}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!user) {
                              setShowAuthModal(true);
                              return;
                            }
                            setTogglingFavoriteId(pastShow.id);
                            await addToWatchlist(pastShow.showName);
                            setTogglingFavoriteId(null);
                          }}
                          disabled={isToggling || isWatching}
                          className={`w-full py-3 px-4 rounded text-sm font-semibold transition-colors flex items-center justify-center gap-1 disabled:opacity-50 ${
                            isWatching ? 'bg-white/10 text-gray-400 cursor-default' : 'bg-white/10 hover:bg-white/20 text-white'
                          }`}
                          style={stationAccentColor ? { borderColor: stationAccentColor } : undefined}
                        >
                          {isToggling ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : isWatching ? (
                            <><svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg> Watchlist</>
                          ) : (
                            <><svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg> Watchlist</>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                }

                return null;
              })}
            </div>
          </section>
        )}

        {/* SECTION G: ARTIST SELECTS (MY RECS) */}
        {artistSelects.length > 0 && (
          <section className="mb-6 bg-zinc-900/30 p-4 border border-white/5">
            <h2 className="text-[10px] uppercase tracking-[0.5em] text-zinc-500 mb-3">Artist Selects</h2>
            <div className="space-y-2">
              {artistSelects.map((rec, idx) => (
                <a
                  key={idx}
                  href={rec.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between group border-b border-white/5 pb-2"
                >
                  <div className="flex items-center gap-3">
                    {rec.imageUrl && (
                      <Image
                        src={rec.imageUrl}
                        alt={rec.label}
                        width={40}
                        height={40}
                        className="rounded object-cover w-10 h-10 flex-shrink-0"
                      />
                    )}
                    <span className="text-base font-light group-hover:pl-2 transition-all">{rec.label}</span>
                  </div>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity"><ExternalLinkIcon size={14} /></span>
                </a>
              ))}
            </div>
          </section>
        )}
          </>
        )}

        {/* FOOTER: SOCIALS */}
        <footer className="border-t border-white/10 pt-6 flex flex-col items-center">
          {/* Social Grid - Icons Only */}
          <div className="flex flex-wrap justify-center gap-6 max-w-md mb-4">
            {socialLinks.instagram && (
              <a
                href={`https://instagram.com/${socialLinks.instagram.replace("@", "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 hover:text-white transition-colors"
                title="Instagram"
              >
                <InstagramIcon size={20} />
              </a>
            )}
            {socialLinks.soundcloud && (
              <a
                href={socialLinks.soundcloud}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 hover:text-white transition-colors"
                title="SoundCloud"
              >
                <SoundCloudIcon size={20} />
              </a>
            )}
            {socialLinks.mixcloud && (
              <a
                href={socialLinks.mixcloud}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 hover:text-white transition-colors"
                title="Mixcloud"
              >
                <MixcloudIcon size={20} />
              </a>
            )}
            {socialLinks.bandcamp && (
              <a
                href={socialLinks.bandcamp}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 hover:text-white transition-colors"
                title="Bandcamp"
              >
                <BandcampIcon size={20} />
              </a>
            )}
            {socialLinks.youtube && (
              <a
                href={socialLinks.youtube}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 hover:text-white transition-colors"
                title="YouTube"
              >
                <YouTubeIcon size={20} />
              </a>
            )}
            {socialLinks.residentAdvisor && (
              <a
                href={socialLinks.residentAdvisor}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 hover:text-white transition-colors text-sm font-bold"
                title="Resident Advisor"
              >
                RA
              </a>
            )}
            {socialLinks.website && (
              <a
                href={socialLinks.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 hover:text-white transition-colors"
                title={isTwitterLink(socialLinks.website) ? "Twitter" : "Website"}
              >
                {isTwitterLink(socialLinks.website) ? <TwitterIcon size={20} /> : <GlobeIcon size={20} />}
              </a>
            )}
            {socialLinks.bookingEmail && (
              <a
                href={`mailto:${socialLinks.bookingEmail}`}
                className="text-zinc-400 hover:text-white transition-colors"
                title="Booking Email"
              >
                <MailIcon size={20} />
              </a>
            )}
          </div>
        </footer>

        {/* Auto-profile banner - at bottom */}
        {isAutoProfile && (
          <div className="mt-8 bg-zinc-900/50 border border-zinc-800 p-3 text-center">
            <p className="text-zinc-400 text-xs uppercase tracking-widest">
              Auto-generated profile based on radio schedules
            </p>
            {autoSources.length > 0 && (
              <p className="text-zinc-500 text-xs mt-1">
                Seen on: {Array.from(new Set(autoSources.map(s => {
                  const station = getStationById(s.stationId);
                  return station?.name || s.stationId;
                }))).join(", ")}
              </p>
            )}
            <p className="text-zinc-600 text-xs mt-2">
              Contact info@channel-app.com for any question or claim about this profile
            </p>
          </div>
        )}
      </main>

      {/* Fixed Action Bar at Bottom - always visible */}
      <div className="fixed bottom-0 left-0 right-0 z-50 px-4 py-3 bg-black/80 backdrop-blur-lg border-t border-white/10 overflow-hidden">
        <div className="flex gap-2 mx-auto" style={{ maxWidth: 'calc(100vw - 2rem)' }}>
          <button
            onClick={handleSubscribe}
            disabled={subscribing || favoritesLoading}
            className={`flex-1 min-w-0 py-3 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 whitespace-nowrap ${
              isSubscribed
                ? "bg-zinc-900 text-gray-400 border border-white/10 cursor-default"
                : "bg-white text-black hover:bg-gray-100"
            }`}
          >
            {subscribing ? "..." : isSubscribed ? (<><svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg> Added to watchlist</>) : (<><svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg> Add to watchlist</>)}
          </button>
          {profile.email && (
            <div className="flex-1 min-w-0 relative">
              <button className="w-full bg-white py-3 text-xs font-bold uppercase tracking-wider text-black flex items-center justify-center gap-1.5 hover:bg-gray-100 transition-colors">
                <svg className="w-4 h-4 shrink-0 text-green-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
                </svg>
                Support
              </button>
              <TipButton
                djUserId={profile.uid}
                djEmail={profile.email}
                djUsername={profile.chatUsername}
                broadcastSlotId=""
                showName={`Support ${profile.chatUsername}`}
                tipperUserId={user?.uid}
                tipperUsername={chatUsername || undefined}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
            </div>
          )}
        </div>
      </div>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
