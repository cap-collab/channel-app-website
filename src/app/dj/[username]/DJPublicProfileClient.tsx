"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { collection, query, where, getDocs, orderBy, Timestamp } from "firebase/firestore";
import { Header } from "@/components/Header";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { useUserProfile } from "@/hooks/useUserProfile";
import { AuthModal } from "@/components/AuthModal";
import { TipButton } from "@/components/channel/TipButton";
import { Show } from "@/types";
import { Archive } from "@/types/broadcast";
import { getStationById } from "@/lib/stations";
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

const CalendarIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
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

// Truncated bio component for mobile
const TruncatedBio = ({ bio }: { bio: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [truncatedText, setTruncatedText] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const calculateTruncation = () => {
      // Only apply truncation on mobile (< 768px)
      const isMobile = window.innerWidth < 768;
      if (!isMobile || !containerRef.current || !measureRef.current) {
        setTruncatedText(null);
        return;
      }

      const container = containerRef.current;
      const measure = measureRef.current;
      const containerWidth = container.offsetWidth;

      // Get actual computed line height (text-base leading-relaxed = 16px * 1.625 = 26px)
      const computedStyle = window.getComputedStyle(measure);
      const lineHeight = parseFloat(computedStyle.lineHeight) || 26;
      const maxHeight = lineHeight * 3 + 2; // 3 lines with small tolerance

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
  }, [bio]);

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
            className="md:hidden inline text-zinc-400 hover:text-white transition-colors"
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
}

interface Props {
  username: string;
}

// Activity feed item type
type ActivityFeedItem =
  | (UpcomingShow & { feedType: "radio"; feedStatus: "upcoming" | "live" })
  | (IrlShow & { feedType: "irl"; feedStatus: "upcoming" | "past"; id: string })
  | (Archive & { feedType: "recording"; feedStatus: "past" })
  | (PastShow & { feedType: "show"; feedStatus: "past" });

// Contains matching for DJ/show names (bidirectional - either contains the other)
function containsMatch(text: string, term: string): boolean {
  const textLower = text.toLowerCase();
  const termLower = term.toLowerCase();
  return textLower.includes(termLower) || termLower.includes(textLower);
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

export function DJPublicProfileClient({ username }: Props) {
  const { user, isAuthenticated } = useAuthContext();
  const { chatUsername } = useUserProfile(user?.uid);
  const { isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited, addToWatchlist, loading: favoritesLoading } = useFavorites();

  const [djProfile, setDjProfile] = useState<DJProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Live status
  const [liveOnChannel, setLiveOnChannel] = useState(false);
  const [liveElsewhere, setLiveElsewhere] = useState<{ stationName: string; stationUrl: string; stationAccentColor?: string } | null>(null);
  const [allShows, setAllShows] = useState<Show[]>([]);

  // Upcoming broadcasts
  const [upcomingBroadcasts, setUpcomingBroadcasts] = useState<UpcomingShow[]>([]);

  // Past recordings (archives with recordings)
  const [pastRecordings, setPastRecordings] = useState<Archive[]>([]);

  // Past shows (broadcast slots without recordings)
  const [pastShows, setPastShows] = useState<PastShow[]>([]);

  // Past external shows (from other stations like NTS, Subtle, etc.)
  const [pastExternalShows, setPastExternalShows] = useState<PastShow[]>([]);

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

        // Find the first pending profile (filter by status client-side)
        const pendingDoc = pendingSnapshot.docs.find(
          (doc) => doc.data().status === "pending"
        );

        if (pendingDoc) {
          const pendingData = pendingDoc.data();
          setDjProfile({
            chatUsername: pendingData.chatUsername,
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
          return;
        }

        // No pending profile found - check users collection
        // Query with role filter so Firestore rules can validate access
        const usersRef = collection(db, "users");
        const q = query(
          usersRef,
          where("chatUsernameNormalized", "==", normalized),
          where("role", "in", ["dj", "broadcaster", "admin"])
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        const doc = snapshot.docs[0];
        const data = doc.data();

        setDjProfile({
          chatUsername: data.chatUsername,
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
            myRecs: data.djProfile?.myRecs || {},
          },
          uid: doc.id,
        });
        setLoading(false);
      } catch (error) {
        console.error("Error fetching DJ profile:", error);
        setNotFound(true);
        setLoading(false);
      }
    }

    fetchDJProfile();
  }, [username]);

  // Fetch schedule to check live status
  useEffect(() => {
    async function fetchSchedule() {
      try {
        const res = await fetch("/api/schedule");
        if (res.ok) {
          const data = await res.json();
          setAllShows(data.shows || []);
        }
      } catch (error) {
        console.error("Error fetching schedule:", error);
      }
    }

    fetchSchedule();
  }, []);

  // Live show state (for the dedicated live card)
  const [currentLiveShow, setCurrentLiveShow] = useState<Show | null>(null);
  const [liveShowProgress, setLiveShowProgress] = useState(0);

  // Check if DJ is live on Channel or elsewhere
  useEffect(() => {
    if (!djProfile || allShows.length === 0) return;

    const now = Date.now();
    const djName = djProfile.chatUsername;

    // Check if live on Channel Broadcast
    const channelShow = allShows.find(
      (show) =>
        show.stationId === "broadcast" &&
        new Date(show.startTime).getTime() <= now &&
        new Date(show.endTime).getTime() > now &&
        (show.dj && containsMatch(show.dj, djName))
    );

    if (channelShow) {
      setLiveOnChannel(true);
      setLiveElsewhere(null);
      setCurrentLiveShow(channelShow);
      return;
    }

    // Check if live elsewhere
    const externalShow = allShows.find(
      (show) =>
        show.stationId !== "broadcast" &&
        new Date(show.startTime).getTime() <= now &&
        new Date(show.endTime).getTime() > now &&
        ((show.dj && containsMatch(show.dj, djName)) ||
          containsMatch(show.name, djName))
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
  }, [djProfile, allShows]);

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

      // 1. Fetch broadcast slots from Firebase (Channel Broadcast)
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
            const isMatch =
              (data.djUsername && containsMatch(data.djUsername, djProfile.chatUsername)) ||
              (data.djName && containsMatch(data.djName, djProfile.chatUsername)) ||
              (data.liveDjUsername && containsMatch(data.liveDjUsername, djProfile.chatUsername)) ||
              data.djUserId === djProfile.uid ||
              (data.djEmail && data.djEmail.toLowerCase() === djProfile.email.toLowerCase());

            if (isMatch) {
              const id = `broadcast-${docSnap.id}`;
              seenIds.add(id);
              upcomingShows.push({
                id,
                showName: data.showName || "Broadcast",
                djName: data.djName || djProfile.chatUsername,
                startTime: (data.startTime as Timestamp).toMillis(),
                endTime: (data.endTime as Timestamp).toMillis(),
                status: data.status,
                stationId: "broadcast",
                stationName: "Channel Broadcast",
                isExternal: false,
                showImageUrl: data.showImageUrl,
              });
            }
          });
        } catch (error) {
          console.error("Error fetching broadcast slots:", error);
        }
      }

      // 2. Filter external radio shows from allShows (already fetched from /api/schedule)
      // Use the same word-boundary matching as watchlist
      const djName = djProfile.chatUsername;

      allShows.forEach((show) => {
        // Skip broadcast shows (already handled above)
        if (show.stationId === "broadcast") return;

        // Skip shows that have already ended
        const endTime = new Date(show.endTime).getTime();
        if (endTime <= now) return;

        // Match by DJ name or show name containing the DJ name (same as watchlist)
        const djMatch = show.dj && containsMatch(show.dj, djName);
        const showNameMatch = containsMatch(show.name, djName);

        if (djMatch || showNameMatch) {
          const id = `external-${show.id}`;
          if (seenIds.has(id)) return;
          seenIds.add(id);

          const station = getStationById(show.stationId);
          upcomingShows.push({
            id,
            showName: show.name,
            djName: show.dj || djName,
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

          // Find archives that match this DJ's slots
          const djArchives = archives.filter((archive) =>
            pastSlotsMap.has(archive.broadcastSlotId) && archive.recordingUrl
          );
          setPastRecordings(djArchives);

          // Get slot IDs that have recordings
          const slotsWithRecordings = new Set(djArchives.map(a => a.broadcastSlotId));

          // Shows without recordings = slots that don't have a matching archive
          const showsWithoutRecordings: PastShow[] = [];
          pastSlotsMap.forEach((slot, slotId) => {
            if (!slotsWithRecordings.has(slotId)) {
              showsWithoutRecordings.push({
                id: slotId,
                showName: slot.showName,
                startTime: slot.startTime,
                endTime: slot.endTime,
                showImageUrl: slot.showImageUrl,
                stationId: "broadcast",
                stationName: "Channel Broadcast",
              });
            }
          });

          // Sort by most recent first
          showsWithoutRecordings.sort((a, b) => b.startTime - a.startTime);
          setPastShows(showsWithoutRecordings);
        }
      } catch (error) {
        console.error("Error fetching past shows:", error);
      }
    }
    fetchPastShowsAndRecordings();
  }, [djProfile]);

  // Fetch past external shows from Firebase (NTS, Subtle, dublab, etc.)
  useEffect(() => {
    async function fetchPastExternalShows() {
      if (!djProfile || !db) return;

      try {
        // Normalize username for matching
        const normalizedUsername = djProfile.chatUsername
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");

        // Query past-external-shows where djUsername matches
        // Note: This query requires a composite index on djUsername + endTime
        const externalShowsRef = collection(db, "past-external-shows");
        const q = query(
          externalShowsRef,
          where("djUsername", "==", normalizedUsername)
        );

        console.log("[DJ Profile] Querying past-external-shows for djUsername:", normalizedUsername);
        const snapshot = await getDocs(q);
        console.log("[DJ Profile] Found", snapshot.docs.length, "past external shows");

        const shows: PastShow[] = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            showName: data.showName,
            startTime: data.startTime?.toMillis?.() || data.startTime,
            endTime: data.endTime?.toMillis?.() || data.endTime,
            stationId: data.stationId,
            stationName: data.stationName,
          };
        });

        // Sort by endTime descending (newest first)
        shows.sort((a, b) => b.endTime - a.endTime);

        setPastExternalShows(shows);
      } catch (error) {
        console.error("[DJ Profile] Error fetching past external shows:", error);
      }
    }

    fetchPastExternalShows();
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

  // Share handler
  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${djProfile?.chatUsername} on Channel`,
          url,
        });
      } catch {
        // User cancelled or share failed, fallback to clipboard
        await navigator.clipboard.writeText(url);
      }
    } else {
      await navigator.clipboard.writeText(url);
    }
  };

  // Format date for activity feed
  const formatFeedDate = (timestamp: number | string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }).toUpperCase();
  };

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
      const isLive = show.startTime <= now && show.endTime > now;
      // Skip live shows - they're displayed in the dedicated live card above
      if (isLive) {
        return;
      }
      const item: ActivityFeedItem = {
        ...show,
        feedType: "radio",
        feedStatus: "upcoming",
      };
      upcoming.push(item);
    });

    // Add IRL shows - check if past or upcoming based on date
    if (djProfile?.djProfile.irlShows) {
      djProfile.djProfile.irlShows
        .filter((show) => show.url || show.venue || show.date)
        .forEach((show, i) => {
          const irlDate = show.date ? new Date(show.date) : null;
          const isPastIrl = irlDate && irlDate.getTime() < now;
          const item: ActivityFeedItem = {
            ...show,
            feedType: "irl",
            feedStatus: isPastIrl ? "past" : "upcoming",
            id: `irl-${i}`,
          };
          if (isPastIrl) {
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

    // Add past shows without recordings (Channel Broadcast)
    pastShows.forEach((show) => {
      past.push({
        ...show,
        feedType: "show",
        feedStatus: "past",
      });
    });

    // Add past external shows (NTS, Subtle, dublab, etc.)
    pastExternalShows.forEach((show) => {
      past.push({
        ...show,
        feedType: "show",
        feedStatus: "past",
      });
    });

    // Sort upcoming by start time ascending
    const sortUpcoming = (a: ActivityFeedItem, b: ActivityFeedItem) => {
      const aTime = "startTime" in a ? a.startTime : ("date" in a && a.date ? new Date(a.date).getTime() : 0);
      const bTime = "startTime" in b ? b.startTime : ("date" in b && b.date ? new Date(b.date).getTime() : 0);
      return aTime - bTime;
    };

    // Sort past by date descending
    const sortPast = (a: ActivityFeedItem, b: ActivityFeedItem) => {
      const aTime = "recordedAt" in a ? a.recordedAt : ("startTime" in a ? a.startTime : ("date" in a && a.date ? new Date(a.date).getTime() : 0));
      const bTime = "recordedAt" in b ? b.recordedAt : ("startTime" in b ? b.startTime : ("date" in b && b.date ? new Date(b.date).getTime() : 0));
      return bTime - aTime;
    };

    upcoming.sort(sortUpcoming);
    past.sort(sortPast);

    return { upcomingShows: upcoming, pastActivities: past };
  }, [upcomingBroadcasts, pastRecordings, pastShows, pastExternalShows, djProfile]);

  // Create Artist Selects (recommendations)
  const artistSelects = useMemo(() => {
    const selects: { label: string; url: string }[] = [];

    if (djProfile?.djProfile.myRecs?.bandcampLinks) {
      djProfile.djProfile.myRecs.bandcampLinks.forEach((url) => {
        const label = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
        selects.push({ label, url });
      });
    }

    if (djProfile?.djProfile.myRecs?.eventLinks) {
      djProfile.djProfile.myRecs.eventLinks.forEach((url) => {
        const label = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
        selects.push({ label, url });
      });
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
        <Header position="sticky" />
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
    <div className="min-h-screen text-white relative">
      <AnimatedBackground />
      {/* Site-wide Header */}
      <Header position="sticky" />

      {/* Contextual Sticky Nav */}
      <nav className="sticky top-0 z-40 flex justify-end items-center px-6 py-2 bg-surface-base/90 backdrop-blur-md border-b border-white/10">
        <div className="flex gap-4 items-center">
          <button
            onClick={handleShare}
            className="flex items-center gap-2 text-[10px] uppercase tracking-widest hover:text-accent transition"
          >
            <ShareIcon size={14} /> Share
          </button>
          <button
            onClick={handleSubscribe}
            disabled={subscribing || favoritesLoading}
            className={`px-4 py-1.5 rounded-lg text-[10px] uppercase font-black tracking-widest transition disabled:opacity-50 ${
              isSubscribed
                ? "bg-zinc-800 text-white hover:bg-zinc-700"
                : "bg-white text-black hover:bg-accent hover:text-white"
            }`}
          >
            {subscribing ? "..." : isSubscribed ? "Following" : "Follow"}
          </button>
          {profile.email && (
            <div className="group relative flex items-center gap-2 bg-accent hover:bg-white text-white hover:text-black px-4 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
              </svg>
              <span className="text-[10px] font-black uppercase tracking-widest">Support</span>
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
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-4">
        {/* SECTION A: IDENTITY */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-6 mb-6">
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

          <div className="md:col-span-8 flex flex-col justify-center">
            <h1 className="text-5xl sm:text-7xl md:text-8xl font-black uppercase tracking-tighter leading-none mb-2">
              {profile.chatUsername}
            </h1>
            {profile.djProfile.location && (
              <p className="text-zinc-500 text-sm uppercase tracking-[0.4em] mb-4">
                {profile.djProfile.location}
              </p>
            )}

            <div className="max-w-xl">
              {profile.djProfile.bio && (
                <TruncatedBio bio={profile.djProfile.bio} />
              )}
              {profile.djProfile.genres.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {profile.djProfile.genres.map((g, i) => (
                    <span
                      key={i}
                      className="text-[9px] uppercase tracking-widest border border-zinc-700 px-2 py-1 text-zinc-400"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* LIVE SHOW CARD - Shown outside timeline when DJ is live */}
        {currentLiveShow && (
          <section className="mb-6">
            <div className="bg-surface-card rounded-2xl overflow-hidden">
              {/* Header: LIVE badge and radio name */}
              <div className="flex items-center justify-between px-4 py-3 bg-black/40">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-red-500 text-xs font-bold uppercase tracking-wide">
                    Live
                  </span>
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
                  <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-1000 ease-linear"
                      style={{
                        width: `${liveShowProgress}%`,
                        backgroundColor: liveElsewhere?.stationAccentColor || 'var(--color-accent)'
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>{new Date(currentLiveShow.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                    <span>{new Date(currentLiveShow.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                  </div>
                </div>

                {/* Action Button */}
                {liveOnChannel ? (
                  <Link
                    href="/channel"
                    className="w-full py-3 px-4 rounded-xl text-sm font-semibold bg-accent hover:bg-accent/80 text-white transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Play
                  </Link>
                ) : liveElsewhere ? (
                  <a
                    href={liveElsewhere.stationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-3 px-4 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center gap-2"
                  >
                    Join Stream
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                ) : null}
              </div>
            </div>
          </section>
        )}

        {/* PROMO BOX */}
        {profile.djProfile.promoText && (
          <section className="mb-6">
            <div className="border-2 border-white p-6 flex flex-col justify-center gap-3">
              <p className="text-sm font-medium italic">&ldquo;{profile.djProfile.promoText}&rdquo;</p>
              {profile.djProfile.promoHyperlink && (
                <a
                  href={profile.djProfile.promoHyperlink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] uppercase font-black tracking-widest flex items-center gap-2 hover:text-accent"
                >
                  View Link <ExternalLinkIcon size={12} />
                </a>
              )}
            </div>
          </section>
        )}

        {/* SECTION: UPCOMING SHOWS */}
        {upcomingShows.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[10px] uppercase tracking-[0.5em] text-zinc-500 mb-3 border-b border-white/10 pb-2">
              Upcoming Shows
            </h2>

            <div className="space-y-3">
              {upcomingShows.map((item) => {
                if (item.feedType === "radio") {
                  const broadcast = item as UpcomingShow & { feedType: "radio"; feedStatus: "upcoming" };
                  const showAsShow = upcomingShowToShow(broadcast);
                  const isFavorited = isShowFavorited(showAsShow);
                  const isToggling = togglingFavoriteId === broadcast.id;
                  const stationAccentColor = getStationById(broadcast.stationId)?.accentColor;

                  // Format date and time for header
                  const showDate = new Date(broadcast.startTime);
                  const dateStr = showDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  const timeStr = showDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

                  return (
                    <div
                      key={broadcast.id}
                      className="bg-surface-card rounded-2xl overflow-hidden"
                    >
                      {/* Header: Date + Time and Station name */}
                      <div className="flex items-center justify-between px-4 py-3 bg-black/40">
                        <span className="text-zinc-400 text-xs">
                          {dateStr} · {timeStr}
                        </span>
                        <span className="text-zinc-400 text-xs">
                          {broadcast.stationName}
                        </span>
                      </div>

                      {/* Show Info */}
                      <div className="p-4 space-y-4">
                        <div>
                          <h3 className="text-white text-xl font-bold">{broadcast.showName}</h3>
                        </div>

                        {/* Time Bar */}
                        <div className="space-y-1">
                          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full w-0"
                              style={{
                                backgroundColor: stationAccentColor || 'var(--color-accent)'
                              }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] text-zinc-500">
                            <span>{new Date(broadcast.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                            <span>{new Date(broadcast.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                          </div>
                        </div>

                        {/* Action Button */}
                        <button
                          onClick={(e) => handleToggleFavorite(broadcast, e)}
                          disabled={isToggling}
                          className="w-full py-3 px-4 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center gap-2"
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

                if (item.feedType === "irl") {
                  const irlShow = item as IrlShow & { feedType: "irl"; feedStatus: "upcoming"; id: string };
                  return (
                    <div key={irlShow.id} className="bg-surface-card rounded-xl p-4">
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          {irlShow.url && (
                            <div className="float-right ml-3">
                              <a
                                href={irlShow.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-3 h-8 rounded-full flex items-center justify-center gap-1.5 transition-all text-xs bg-accent hover:bg-accent/80 text-white font-medium"
                              >
                                <CalendarIcon size={14} />
                                <span className="hidden sm:inline">Tickets</span>
                              </a>
                            </div>
                          )}

                          <h3 className="text-white font-semibold">
                            {irlShow.name || irlShow.venue || irlShow.url?.replace(/^https?:\/\//, "").split("/")[0] || "Event"}
                          </h3>
                          <p className="text-gray-400 text-sm">{irlShow.location || "Upcoming IRL Event"}</p>
                          <p className="text-gray-500 text-xs">{irlShow.date || "TBA"}</p>
                        </div>
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
                if (item.feedType === "irl") {
                  const irlShow = item as IrlShow & { feedType: "irl"; feedStatus: "past"; id: string };
                  return (
                    <div key={irlShow.id} className="bg-surface-card rounded-xl p-4 opacity-60">
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-gray-400 font-semibold">
                            {irlShow.name || irlShow.venue || irlShow.url?.replace(/^https?:\/\//, "").split("/")[0] || "Event"}
                          </h3>
                          <p className="text-gray-500 text-sm">{irlShow.location || "Past IRL Event"}</p>
                          <p className="text-gray-600 text-xs">{irlShow.date || "TBA"}</p>
                        </div>
                      </div>
                    </div>
                  );
                }

                if (item.feedType === "recording") {
                  const archive = item as Archive & { feedType: "recording"; feedStatus: "past" };
                  const isPlaying = playingId === archive.id;
                  const currentTime = currentTimes[archive.id] || 0;
                  const showImage = archive.showImageUrl;

                  return (
                    <div key={archive.id} className="bg-surface-card rounded-xl p-3">
                      <div className="flex items-center gap-3">
                        {showImage && (
                          <div className="w-12 h-12 rounded-lg bg-gray-800 flex-shrink-0 overflow-hidden">
                            <Image
                              src={showImage}
                              alt={archive.showName}
                              width={48}
                              height={48}
                              className="w-full h-full object-cover"
                              unoptimized
                            />
                          </div>
                        )}

                        <button
                          onClick={() => handlePlayPause(archive.id)}
                          className="w-10 h-10 rounded-full bg-white flex items-center justify-center hover:bg-gray-100 transition-colors flex-shrink-0 text-black"
                        >
                          {isPlaying ? (
                            <PauseIcon size={16} />
                          ) : (
                            <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="text-white font-semibold text-sm truncate">{archive.showName}</h3>
                              <p className="text-gray-500 text-xs">{formatFeedDate(archive.recordedAt)} · {formatDuration(archive.duration)}</p>
                            </div>
                            <div className="relative flex-shrink-0">
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const archiveUrl = `${window.location.origin}/archives/${archive.slug}`;
                                  await navigator.clipboard.writeText(archiveUrl);
                                  setCopiedArchiveId(archive.id);
                                  setTimeout(() => setCopiedArchiveId(null), 2000);
                                }}
                                className="w-7 h-7 rounded-full flex items-center justify-center transition-all text-xs bg-accent/10 hover:bg-accent/20 text-accent"
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
                          <input
                            type="range"
                            min={0}
                            max={archive.duration || 100}
                            value={currentTime}
                            onChange={(e) => handleSeek(archive.id, parseFloat(e.target.value))}
                            className="w-full h-1 bg-gray-700 rounded-full appearance-none cursor-pointer mt-1.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                          />
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

                  // Format date and time for header
                  const showDate = new Date(pastShow.startTime);
                  const dateStr = showDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  const timeStr = showDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

                  return (
                    <div
                      key={pastShow.id}
                      className="bg-surface-card rounded-2xl overflow-hidden"
                    >
                      {/* Header: Date + Time and Station name */}
                      <div className="flex items-center justify-between px-4 py-3 bg-black/40">
                        <span className="text-zinc-400 text-xs">
                          {dateStr} · {timeStr}
                        </span>
                        <span className="text-zinc-400 text-xs">
                          {pastShow.stationName}
                        </span>
                      </div>

                      {/* Show Info */}
                      <div className="p-4 space-y-4">
                        <div>
                          <h3 className="text-white text-xl font-bold">{pastShow.showName}</h3>
                        </div>

                        {/* Action Button: Get notified */}
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
                          className="w-full py-3 px-4 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                          style={stationAccentColor ? { borderColor: stationAccentColor } : undefined}
                        >
                          {isToggling ? (
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill={isWatching ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                              </svg>
                              {isWatching ? "Notifying" : "Get notified"}
                            </>
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
                  <span className="text-base font-light group-hover:pl-2 transition-all">{rec.label}</span>
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity"><ExternalLinkIcon size={14} /></span>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* FOOTER: SUPPORT & SOCIALS */}
        <footer className="border-t border-white/10 pt-6 flex flex-col items-center">
          {/* Support The Artist Button (Tip) */}
          {profile.email && (
            <div className="group relative mb-6 flex items-center gap-3 bg-accent hover:bg-white text-white hover:text-black px-6 py-3 transition-all duration-300 cursor-pointer whitespace-nowrap">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
              </svg>
              <span className="text-sm font-black uppercase tracking-wider">Support The Artist</span>
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

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
