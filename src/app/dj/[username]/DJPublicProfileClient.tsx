"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { collection, query, where, getDocs, orderBy, Timestamp } from "firebase/firestore";
import { Header } from "@/components/Header";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { useFavorites } from "@/hooks/useFavorites";
import { useUserProfile } from "@/hooks/useUserProfile";
import { AuthModal } from "@/components/AuthModal";
import { TipButton } from "@/components/channel/TipButton";
import { Show } from "@/types";
import { Archive } from "@/types/broadcast";
import { getStationById } from "@/lib/stations";

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

// Past show without recording
interface PastShow {
  id: string;
  showName: string;
  startTime: number;
  endTime: number;
  showImageUrl?: string;
}

interface CustomLink {
  label: string;
  url: string;
}

interface IrlShow {
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

// Contains matching for DJ/show names (bidirectional - either contains the other)
function containsMatch(text: string, term: string): boolean {
  const textLower = text.toLowerCase();
  const termLower = term.toLowerCase();
  return textLower.includes(termLower) || termLower.includes(textLower);
}

export function DJPublicProfileClient({ username }: Props) {
  const { user, isAuthenticated } = useAuthContext();
  const { chatUsername } = useUserProfile(user?.uid);
  const { isInWatchlist, followDJ, removeFromWatchlist, toggleFavorite, isShowFavorited, loading: favoritesLoading } = useFavorites();

  const [djProfile, setDjProfile] = useState<DJProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Live status
  const [liveOnChannel, setLiveOnChannel] = useState(false);
  const [liveElsewhere, setLiveElsewhere] = useState<{ stationName: string; stationUrl: string } | null>(null);
  const [allShows, setAllShows] = useState<Show[]>([]);

  // Upcoming broadcasts
  const [upcomingBroadcasts, setUpcomingBroadcasts] = useState<UpcomingShow[]>([]);

  // Past recordings (archives with recordings)
  const [pastRecordings, setPastRecordings] = useState<Archive[]>([]);

  // Past shows (broadcast slots without recordings)
  const [pastShows, setPastShows] = useState<PastShow[]>([]);

  // Audio player state for recordings
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [currentTimes, setCurrentTimes] = useState<Record<string, number>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  // Subscribe state
  const [subscribing, setSubscribing] = useState(false);

  // Show popup state
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const [togglingFavoriteId, setTogglingFavoriteId] = useState<string | null>(null);

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
      });
      setLiveOnChannel(false);
    } else {
      setLiveOnChannel(false);
      setLiveElsewhere(null);
    }
  }, [djProfile, allShows]);

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

  // Format broadcast time
  const formatBroadcastTime = (startTime: number, endTime: number) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const dateStr = start.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const startStr = start.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    const endStr = end.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${dateStr}, ${startStr} - ${endStr}`;
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

  // Check if show is currently live
  const isShowLive = (broadcast: UpcomingShow): boolean => {
    const now = Date.now();
    return broadcast.startTime <= now && broadcast.endTime > now;
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

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-black">
        <Header position="sticky" />
        <main className="max-w-xl mx-auto p-4">
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">DJ not found</p>
            <p className="text-gray-600 text-sm">
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
    <div className="min-h-screen bg-black">
      <Header position="sticky" />

      <main className="px-4 py-4">
        <div className="space-y-8">
          {/* A) DJ Identity */}
          <section className="text-center">
            {/* Photo */}
            <div className="relative w-24 h-24 mx-auto mb-4">
              {profile.djProfile.photoUrl ? (
                <Image
                  src={profile.djProfile.photoUrl}
                  alt={profile.chatUsername}
                  fill
                  className="rounded-full object-cover"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gray-800 flex items-center justify-center">
                  <svg className="w-10 h-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              )}
            </div>

            {/* Name */}
            <h2 className="text-2xl font-bold text-white mb-2">{profile.chatUsername}</h2>

            {/* Watchlist Button */}
            <div className="flex flex-col items-center gap-2 mb-4">
              <div className="flex gap-3 justify-center">
                <button
                  onClick={handleSubscribe}
                  disabled={subscribing || favoritesLoading}
                  className={`px-6 py-2.5 rounded-xl font-medium transition-colors ${
                    isSubscribed
                      ? "bg-gray-800 text-white hover:bg-gray-700"
                      : "bg-white text-black hover:bg-gray-100"
                  } disabled:opacity-50`}
                >
                  {subscribing ? "..." : isSubscribed ? "Following" : "+ Follow"}
                </button>
              </div>
              <p className="text-gray-500 text-xs text-center max-w-2xl">
                Receive emails when this DJ is adding a new event or playing live on any stations
              </p>
            </div>

            {/* Location */}
            {profile.djProfile.location && (
              <p className="text-gray-400 text-sm mb-2">{profile.djProfile.location}</p>
            )}

            {/* Genres */}
            {profile.djProfile.genres.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 mb-4">
                {profile.djProfile.genres.map((genre, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-gray-800 rounded-full text-gray-300 text-xs"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            )}

            {/* Bio */}
            {profile.djProfile.bio && (
              <p className="text-gray-400 text-sm max-w-2xl mx-auto mb-4">
                {profile.djProfile.bio}
              </p>
            )}

            {/* Promo */}
            {profile.djProfile.promoText && (
              <div className="mb-4">
                {profile.djProfile.promoHyperlink ? (
                  <a
                    href={profile.djProfile.promoHyperlink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg text-white text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    {profile.djProfile.promoText}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                ) : (
                  <span className="inline-block px-4 py-2 bg-gray-800 rounded-lg text-gray-300 text-sm">
                    {profile.djProfile.promoText}
                  </span>
                )}
              </div>
            )}

            {/* Social Links with Tip Icon */}
            <div className="flex flex-wrap justify-center items-center gap-3 mb-6">
              {/* Tip Icon - only show when profile has an email */}
              {profile.email && (
                <TipButton
                  djUserId={profile.uid}
                  djEmail={profile.email}
                  djUsername={profile.chatUsername}
                  broadcastSlotId=""
                  showName={`Tip for ${profile.chatUsername}`}
                  tipperUserId={user?.uid}
                  tipperUsername={chatUsername || undefined}
                  size="small"
                />
              )}

              {/* Divider if there are social links and tip button is shown */}
              {profile.email && (socialLinks.website || socialLinks.instagram || socialLinks.soundcloud || socialLinks.bandcamp || socialLinks.youtube || socialLinks.mixcloud || socialLinks.residentAdvisor || socialLinks.bookingEmail) && (
                <span className="w-px h-5 bg-gray-700" />
              )}

              {/* Website link */}
              {socialLinks.website && (
                <a
                  href={socialLinks.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                  title="Website"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                </a>
              )}
              {socialLinks.instagram && (
                <a
                  href={`https://instagram.com/${socialLinks.instagram.replace("@", "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                  title="Instagram"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                  </svg>
                </a>
              )}
              {socialLinks.soundcloud && (
                <a
                  href={socialLinks.soundcloud}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                  title="SoundCloud"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.27-2.154c-.009-.06-.052-.1-.084-.1zm-.9 1.53c-.057 0-.097.045-.105.097l-.138 1.627.152 1.578c.008.058.048.097.105.097.05 0 .09-.039.098-.097l.168-1.578-.168-1.627c-.008-.052-.048-.097-.112-.097zm1.8-1.627c-.063 0-.112.047-.12.105l-.218 2.406.218 2.313c.008.063.057.112.12.112.058 0 .105-.049.12-.112l.24-2.313-.24-2.406c-.015-.058-.062-.105-.12-.105zm.9-.45c-.068 0-.12.052-.127.112l-.195 2.969.195 2.843c.007.063.059.112.127.112.063 0 .112-.049.127-.112l.217-2.843-.217-2.969c-.015-.06-.064-.112-.127-.112zm.9-.675c-.075 0-.135.06-.142.127l-.173 3.757.173 3.607c.007.068.067.127.142.127.068 0 .127-.059.135-.127l.195-3.607-.195-3.757c-.008-.067-.067-.127-.135-.127zm.9-.675c-.082 0-.142.067-.15.135l-.15 4.545.15 4.35c.008.075.068.135.15.135.075 0 .135-.06.15-.135l.165-4.35-.165-4.545c-.015-.068-.075-.135-.15-.135zm.9-.45c-.09 0-.157.068-.165.15l-.127 5.107.127 4.867c.008.082.075.15.165.15.082 0 .15-.068.157-.15l.142-4.867-.142-5.107c-.007-.082-.075-.15-.157-.15zm.9-.225c-.097 0-.172.075-.18.165l-.105 5.445.105 5.137c.008.09.083.165.18.165.09 0 .165-.075.172-.165l.12-5.137-.12-5.445c-.007-.09-.082-.165-.172-.165zm.9-.225c-.105 0-.18.082-.187.18l-.083 5.782.083 5.37c.007.098.082.18.187.18.097 0 .172-.082.18-.18l.09-5.37-.09-5.782c-.008-.098-.083-.18-.18-.18zm1.125-.225c-.112 0-.195.09-.202.195l-.068 6.12.068 5.602c.007.105.09.195.202.195.105 0 .187-.09.195-.195l.075-5.602-.075-6.12c-.008-.105-.09-.195-.195-.195zm.9 0c-.12 0-.21.097-.217.21l-.045 6.232.045 5.602c.007.112.097.21.217.21.113 0 .203-.098.21-.21l.053-5.602-.053-6.232c-.007-.113-.097-.21-.21-.21zm.9.225c-.127 0-.225.105-.232.225l-.023 6.12.023 5.602c.007.12.105.225.232.225.12 0 .218-.105.225-.225l.03-5.602-.03-6.12c-.007-.12-.105-.225-.225-.225zm1.125-.45c-.142 0-.255.112-.262.247l-.008 6.683.008 5.55c.007.135.12.247.262.247.135 0 .247-.112.255-.247l.015-5.55-.015-6.683c-.008-.135-.12-.247-.255-.247zm1.575-.225c-.15 0-.27.12-.285.27v.015l-.008 6.795.008 5.535c.015.15.135.27.285.27.142 0 .263-.12.277-.27l.015-5.535-.015-6.795c-.014-.15-.135-.27-.277-.285zm.9.225c-.157 0-.285.127-.3.285v6.75l.015 5.52c.015.157.143.285.285.285.15 0 .278-.128.285-.285l.015-5.52V6.915c-.007-.158-.135-.285-.3-.285zm.9-.225c-.165 0-.3.135-.307.3v6.75l.015 5.52c.007.165.142.3.307.3.157 0 .285-.135.3-.3l.015-5.52V6.69c-.015-.165-.143-.3-.33-.3zm4.95 1.35c-.375 0-.735.052-1.08.15-.232-2.61-2.437-4.65-5.137-4.65-.69 0-1.35.142-1.95.39-.232.098-.293.195-.3.39v9.36c.007.202.157.367.352.39h8.115c1.5 0 2.715-1.215 2.715-2.715s-1.215-2.715-2.715-2.715z"/>
                  </svg>
                </a>
              )}
              {socialLinks.mixcloud && (
                <a
                  href={socialLinks.mixcloud}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                  title="Mixcloud"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2.462 8.596l1.986 6.097 1.986-6.097h2.668l1.986 6.097 1.986-6.097h2.668l-3.307 9.808H9.767l-1.986-5.912-1.986 5.912H3.107L0 8.596h2.462zm19.552 0c1.099 0 1.986.896 1.986 1.999v5.81c0 1.103-.887 1.999-1.986 1.999-1.099 0-1.986-.896-1.986-1.999v-5.81c0-1.103.887-1.999 1.986-1.999zm-4.634 0c1.099 0 1.986.896 1.986 1.999v5.81c0 1.103-.887 1.999-1.986 1.999-1.099 0-1.986-.896-1.986-1.999v-5.81c0-1.103.887-1.999 1.986-1.999z"/>
                  </svg>
                </a>
              )}
              {socialLinks.bandcamp && (
                <a
                  href={socialLinks.bandcamp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                  title="Bandcamp"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M0 18.75l7.437-13.5H24l-7.438 13.5H0z"/>
                  </svg>
                </a>
              )}
              {socialLinks.youtube && (
                <a
                  href={socialLinks.youtube}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                  title="YouTube"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                </a>
              )}
              {socialLinks.residentAdvisor && (
                <a
                  href={socialLinks.residentAdvisor}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                  title="Resident Advisor"
                >
                  <span className="text-sm font-bold leading-none">RA</span>
                </a>
              )}
              {socialLinks.bookingEmail && (
                <a
                  href={`mailto:${socialLinks.bookingEmail}`}
                  className="text-gray-400 hover:text-white transition-colors"
                  title="Email"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </a>
              )}
            </div>

            {/* Custom Links */}
            {socialLinks.customLinks && socialLinks.customLinks.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 mb-6">
                {socialLinks.customLinks.map((link, i) => (
                  <a
                    key={i}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-300 text-sm transition-colors"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            )}
          </section>

          {/* Auto-profile banner */}
          {isAutoProfile && (
            <section>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <p className="text-gray-400 text-sm">
                  Auto-generated profile based on radio schedules
                </p>
                {autoSources.length > 0 && (
                  <p className="text-gray-500 text-xs mt-1">
                    Seen on: {Array.from(new Set(autoSources.map(s => {
                      const station = getStationById(s.stationId);
                      return station?.name || s.stationId;
                    }))).join(", ")}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* B) DJ Status */}
          {(liveOnChannel || liveElsewhere) && (
            <section>
              {liveOnChannel && (
                <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-red-400 font-medium">Live on Channel</span>
                  </div>
                  <Link
                    href="/channel"
                    className="block w-full py-3 bg-red-500 text-white rounded-lg font-medium text-center hover:bg-red-600 transition-colors"
                  >
                    Listen Now
                  </Link>
                </div>
              )}

              {liveElsewhere && (
                <div className="bg-blue-500/20 border border-blue-500/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
                    <span className="text-blue-400 font-medium">Live on {liveElsewhere.stationName}</span>
                  </div>
                  <a
                    href={liveElsewhere.stationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full py-3 bg-blue-500 text-white rounded-lg font-medium text-center hover:bg-blue-600 transition-colors"
                  >
                    Listen on {liveElsewhere.stationName}
                  </a>
                </div>
              )}
            </section>
          )}

          {/* D) Upcoming Shows */}
          {upcomingBroadcasts.length > 0 && (
            <section className="max-w-xl mx-auto">
              <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                Upcoming Shows
              </h2>
              <div className="bg-[#1a1a1a] rounded-lg divide-y divide-gray-800">
                {upcomingBroadcasts.map((broadcast) => {
                  const showAsShow = upcomingShowToShow(broadcast);
                  const isFavorited = isShowFavorited(showAsShow);
                  const isToggling = togglingFavoriteId === broadcast.id;
                  const isExpanded = expandedShowId === broadcast.id;
                  const isLive = isShowLive(broadcast);

                  return (
                    <div
                      key={broadcast.id}
                      className="p-4 relative cursor-pointer hover:bg-white/5 transition-colors"
                      onClick={() => setExpandedShowId(isExpanded ? null : broadcast.id)}
                    >
                      {/* Favorite star - top right */}
                      <button
                        onClick={(e) => handleToggleFavorite(broadcast, e)}
                        disabled={isToggling}
                        className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                        title={isFavorited ? "Remove from favorites" : "Add to favorites"}
                      >
                        {isToggling ? (
                          <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg
                            className="w-5 h-5"
                            fill={isFavorited ? "currentColor" : "none"}
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                            style={{ color: "#ef4444" }}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                            />
                          </svg>
                        )}
                      </button>

                      <div className="flex gap-3">
                        {/* Show image thumbnail */}
                        {broadcast.showImageUrl && (
                          <Image
                            src={broadcast.showImageUrl}
                            alt={broadcast.showName}
                            width={48}
                            height={48}
                            className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                            unoptimized
                          />
                        )}
                        <div className="flex-1 min-w-0 pr-8">
                          <p className="text-white font-medium">{broadcast.showName}</p>
                          <p className="text-gray-400 text-sm">
                            {formatBroadcastTime(broadcast.startTime, broadcast.endTime)}
                          </p>
                          <p className="text-gray-500 text-xs mt-1">{broadcast.stationName}</p>
                          {isLive && (
                            <span className="inline-flex items-center gap-1 mt-2 text-red-400 text-xs">
                              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                              Live Now
                            </span>
                          )}
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

                            {/* Show image + name header */}
                            <div className="flex items-start gap-3 mb-3">
                              {broadcast.showImageUrl && (
                                <Image
                                  src={broadcast.showImageUrl}
                                  alt={broadcast.showName}
                                  width={64}
                                  height={64}
                                  className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                                  unoptimized
                                />
                              )}
                              <div className="flex-1 min-w-0 pr-6">
                                <h3 className="text-white text-lg font-semibold mb-1">
                                  {broadcast.showName}
                                </h3>
                                {broadcast.djName && (
                                  <p className="text-gray-400 text-sm">
                                    by {broadcast.djName}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Station & time */}
                            <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
                              <span>{broadcast.stationName}</span>
                              <span>•</span>
                              <span>
                                {new Date(broadcast.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} - {new Date(broadcast.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                              </span>
                              {isLive && (
                                <>
                                  <span>•</span>
                                  <span className="text-red-500 font-medium">LIVE</span>
                                </>
                              )}
                            </div>

                            {/* DJ Photo and Bio */}
                            {(profile.djProfile.photoUrl || profile.djProfile.bio) && (
                              <div className="flex items-start gap-3 mb-4">
                                {profile.djProfile.photoUrl && (
                                  <Image
                                    src={profile.djProfile.photoUrl}
                                    alt={profile.chatUsername}
                                    width={48}
                                    height={48}
                                    className="rounded-full object-cover flex-shrink-0"
                                  />
                                )}
                                {profile.djProfile.bio && (
                                  <p className="text-gray-300 text-sm">{profile.djProfile.bio}</p>
                                )}
                              </div>
                            )}

                            {/* Description */}
                            {broadcast.description && (
                              <p className="text-gray-400 text-sm leading-relaxed mb-4">{broadcast.description}</p>
                            )}

                            {/* Actions - Favorite button only (no tip button as per requirements) */}
                            <div className="flex items-center gap-3 mt-5 pt-4 border-t border-gray-800">
                              {/* Favorite button */}
                              <button
                                onClick={(e) => handleToggleFavorite(broadcast, e)}
                                disabled={isToggling}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 transition-colors text-sm"
                                style={{ color: "#ef4444" }}
                              >
                                {isToggling ? (
                                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <svg
                                    className="w-4 h-4"
                                    fill={isFavorited ? "currentColor" : "none"}
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
                                <span className="text-white">{isFavorited ? "Favorited" : "Favorite"}</span>
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* E) IRL Shows */}
          {profile.djProfile.irlShows && profile.djProfile.irlShows.length > 0 && profile.djProfile.irlShows.some(show => show.url || show.venue || show.date) && (
            <section className="max-w-xl mx-auto">
              <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                IRL Shows
              </h2>
              <div className="bg-[#1a1a1a] rounded-lg divide-y divide-gray-800">
                {profile.djProfile.irlShows
                  .filter(show => show.url || show.venue || show.date)
                  .map((show, i) => (
                    <div key={i} className="p-4 flex items-center justify-between">
                      {show.date && (
                        <span className="text-gray-400 text-sm flex-shrink-0 mr-3">{show.date}</span>
                      )}
                      {show.url ? (
                        <a
                          href={show.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 text-sm transition-colors truncate flex-1 text-right"
                        >
                          {show.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      ) : show.venue ? (
                        <span className="text-white text-sm flex-1 text-right">{show.venue}</span>
                      ) : (
                        <span className="text-gray-500 text-sm flex-1 text-right">-</span>
                      )}
                    </div>
                  ))}
              </div>
            </section>
          )}

          {/* Past Recordings (with integrated audio player) */}
          {pastRecordings.length > 0 && (
            <section className="max-w-xl mx-auto">
              <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                Past Recordings
              </h2>
              <div className="space-y-3">
                {pastRecordings.map((archive) => {
                  const isPlaying = playingId === archive.id;
                  const currentTime = currentTimes[archive.id] || 0;

                  return (
                    <div key={archive.id} className="bg-[#1a1a1a] rounded-xl p-4">
                      {/* Top row: Image, title, link */}
                      <div className="flex items-start gap-4">
                        {/* Show Image */}
                        <div className="w-16 h-16 rounded-lg bg-gray-800 flex-shrink-0 overflow-hidden">
                          {archive.showImageUrl ? (
                            <Image
                              src={archive.showImageUrl}
                              alt={archive.showName}
                              width={64}
                              height={64}
                              className="w-full h-full object-cover"
                              unoptimized
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                              </svg>
                            </div>
                          )}
                        </div>

                        {/* Title column */}
                        <div className="flex-1 min-w-0">
                          <Link href={`/archives/${archive.slug}`} className="hover:underline">
                            <h3 className="text-white font-semibold">{archive.showName}</h3>
                          </Link>
                          <p className="text-gray-500 text-xs">
                            {new Date(archive.recordedAt).toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                      </div>

                      {/* Audio player */}
                      <div className="mt-3 flex items-center gap-4">
                        {/* Play/Pause button */}
                        <button
                          onClick={() => handlePlayPause(archive.id)}
                          className="w-12 h-12 rounded-full bg-white flex items-center justify-center hover:bg-gray-100 transition-colors flex-shrink-0"
                        >
                          {isPlaying ? (
                            <svg className="w-5 h-5 text-black" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5 text-black ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          )}
                        </button>

                        {/* Progress bar */}
                        <div className="flex-1">
                          <input
                            type="range"
                            min={0}
                            max={archive.duration || 100}
                            value={currentTime}
                            onChange={(e) => handleSeek(archive.id, parseFloat(e.target.value))}
                            className="w-full h-1 bg-gray-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                          />
                          <div className="flex justify-between text-xs text-gray-500 mt-1">
                            <span>{formatDuration(Math.floor(currentTime))}</span>
                            <span>{formatDuration(archive.duration)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Hidden audio element */}
                      <audio
                        ref={(el) => { audioRefs.current[archive.id] = el; }}
                        src={archive.recordingUrl}
                        preload="none"
                        onTimeUpdate={() => handleTimeUpdate(archive.id)}
                        onEnded={() => handleEnded(archive.id)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* F) My Recs */}
          {profile.djProfile.myRecs && (
            (profile.djProfile.myRecs.bandcampLinks && profile.djProfile.myRecs.bandcampLinks.length > 0) ||
            (profile.djProfile.myRecs.eventLinks && profile.djProfile.myRecs.eventLinks.length > 0)
          ) && (
            <section className="max-w-xl mx-auto">
              <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                My Recs
              </h2>
              <div className="space-y-4">
                {/* Bandcamp Recs */}
                {profile.djProfile.myRecs?.bandcampLinks && profile.djProfile.myRecs.bandcampLinks.length > 0 && (
                  <div className="bg-[#1a1a1a] rounded-lg p-4">
                    <h3 className="text-gray-400 text-sm mb-3 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M0 18.75l7.437-13.5H24l-7.438 13.5H0z"/>
                      </svg>
                      Bandcamp
                    </h3>
                    <div className="space-y-2">
                      {profile.djProfile.myRecs.bandcampLinks.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-blue-400 hover:text-blue-300 text-sm transition-colors truncate"
                        >
                          {url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Event Recs */}
                {profile.djProfile.myRecs?.eventLinks && profile.djProfile.myRecs.eventLinks.length > 0 && (
                  <div className="bg-[#1a1a1a] rounded-lg p-4">
                    <h3 className="text-gray-400 text-sm mb-3 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Events
                    </h3>
                    <div className="space-y-2">
                      {profile.djProfile.myRecs.eventLinks.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-blue-400 hover:text-blue-300 text-sm transition-colors truncate"
                        >
                          {url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Past Shows (without recordings) */}
          {pastShows.length > 0 && (
            <section className="max-w-xl mx-auto">
              <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                Past Shows
              </h2>
              <div className="bg-[#1a1a1a] rounded-lg divide-y divide-gray-800">
                {pastShows.map((show) => (
                  <div
                    key={show.id}
                    className="p-4 flex gap-3"
                  >
                    {show.showImageUrl && (
                      <Image
                        src={show.showImageUrl}
                        alt={show.showName}
                        width={48}
                        height={48}
                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                        unoptimized
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium">{show.showName}</p>
                      <p className="text-gray-400 text-sm">
                        {new Date(show.startTime).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                      <p className="text-gray-500 text-xs mt-1">
                        {Math.round((show.endTime - show.startTime) / 60000)} min
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
