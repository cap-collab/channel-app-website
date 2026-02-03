"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { doc, onSnapshot, updateDoc, collection, query, where, orderBy, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUserRole, isDJ } from "@/hooks/useUserRole";
import { AuthModal } from "@/components/AuthModal";
import { Header } from "@/components/Header";
import { usePendingPayout } from "@/hooks/usePendingPayout";
import { normalizeUrl } from "@/lib/url";
import { uploadDJPhoto, deleteDJPhoto, validatePhoto } from "@/lib/photo-upload";
import { Show } from "@/types";
import { getStationById } from "@/lib/stations";

// Contains matching for DJ/show names (unidirectional - text must contain term)
// e.g. watchlist "skee mask" matches show "Skee Mask Live" but NOT show "Skee"
function containsMatch(text: string, term: string): boolean {
  const textLower = text.toLowerCase();
  const termLower = term.toLowerCase();
  return textLower.includes(termLower);
}

interface UpcomingShow {
  id: string;
  showName: string;
  djName?: string;
  startTime: number;
  endTime: number;
  status: string;
  stationId: string;
  stationName: string;
  isExternal: boolean;
  broadcastToken?: string;
}

interface CustomLink {
  label: string;
  url: string;
}

interface IrlShow {
  name: string;
  location: string;
  url: string;
  date: string;
}

interface RadioShow {
  name: string;
  radioName: string;
  url: string;
  date: string;
  time: string;
  duration: string; // in hours, e.g. "1", "1.5", "2"
  timezone?: string; // IANA timezone the time was entered in
}

interface DJProfile {
  bio: string | null;
  promoText: string | null;
  promoHyperlink: string | null;
  stripeAccountId: string | null;
  thankYouMessage: string | null;
  photoUrl: string | null;
  location: string | null;
  genres: string[];
  socialLinks: {
    instagram?: string;
    soundcloud?: string;
    bandcamp?: string;
    youtube?: string;
    bookingEmail?: string;
    mixcloud?: string;
    residentAdvisor?: string;
    customLinks?: CustomLink[];
  };
  irlShows?: IrlShow[];
  radioShows?: RadioShow[];
  myRecs?: {
    bandcampLinks?: string[];
    eventLinks?: string[];
  };
}

export function StudioProfileClient() {
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const searchParams = useSearchParams();

  // Profile data
  const [chatUsername, setChatUsername] = useState<string | null>(null);
  const [djProfile, setDjProfile] = useState<DJProfile>({
    bio: null,
    promoText: null,
    promoHyperlink: null,
    stripeAccountId: null,
    thankYouMessage: null,
    photoUrl: null,
    location: null,
    genres: [],
    socialLinks: {},
    irlShows: [],
    radioShows: [],
    myRecs: { bandcampLinks: [], eventLinks: [] },
  });

  // Photo upload state
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Stripe connect state
  const [connectingStripe, setConnectingStripe] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  // Check for Stripe success redirect
  useEffect(() => {
    const stripeParam = searchParams.get('stripe');
    if (stripeParam === 'success') {
      // User just returned from Stripe - the stripeAccountId will be in Firebase
    }
  }, [searchParams]);

  // Pending payout info
  const { pendingCents, pendingCount, transferredCents, loading: payoutLoading } = usePendingPayout({
    djUserId: user?.uid || '',
  });

  // Form state - About section
  const [bioInput, setBioInput] = useState("");
  const [savingAbout, setSavingAbout] = useState(false);
  const [saveAboutSuccess, setSaveAboutSuccess] = useState(false);

  // Form state - Location & Genres section
  const [locationInput, setLocationInput] = useState("");
  const [genresInput, setGenresInput] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [saveDetailsSuccess, setSaveDetailsSuccess] = useState(false);

  // Form state - Social Links section
  const [instagramInput, setInstagramInput] = useState("");
  const [soundcloudInput, setSoundcloudInput] = useState("");
  const [bandcampInput, setBandcampInput] = useState("");
  const [youtubeInput, setYoutubeInput] = useState("");
  const [bookingEmailInput, setBookingEmailInput] = useState("");
  const [mixcloudInput, setMixcloudInput] = useState("");
  const [residentAdvisorInput, setResidentAdvisorInput] = useState("");
  const [customLinksInput, setCustomLinksInput] = useState<CustomLink[]>([]);
  const [savingSocial, setSavingSocial] = useState(false);
  const [saveSocialSuccess, setSaveSocialSuccess] = useState(false);

  // Form state - IRL Shows section
  const [irlShowsInput, setIrlShowsInput] = useState<IrlShow[]>([{ name: "", location: "", url: "", date: "" }, { name: "", location: "", url: "", date: "" }]);
  const [savingIrlShows, setSavingIrlShows] = useState(false);
  const [saveIrlShowsSuccess, setSaveIrlShowsSuccess] = useState(false);

  // Form state - Radio Shows section
  const [radioShowsInput, setRadioShowsInput] = useState<RadioShow[]>([{ name: "", radioName: "", url: "", date: "", time: "", duration: "1" }, { name: "", radioName: "", url: "", date: "", time: "", duration: "1" }]);
  const [savingRadioShows, setSavingRadioShows] = useState(false);
  const [saveRadioShowsSuccess, setSaveRadioShowsSuccess] = useState(false);

  // Form state - My Recs section
  const [bandcampRecsInput, setBandcampRecsInput] = useState<string[]>([""]);
  const [eventRecsInput, setEventRecsInput] = useState<string[]>([""]);
  const [savingMyRecs, setSavingMyRecs] = useState(false);
  const [saveMyRecsSuccess, setSaveMyRecsSuccess] = useState(false);

  // Form state - Thank You Message section
  const [thankYouInput, setThankYouInput] = useState("");
  const [savingThankYou, setSavingThankYou] = useState(false);
  const [saveThankYouSuccess, setSaveThankYouSuccess] = useState(false);

  // Form state - Promo section
  const [promoTextInput, setPromoTextInput] = useState("");
  const [promoHyperlinkInput, setPromoHyperlinkInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // DJ Name setup state (for users without a chat username)
  const [djNameInput, setDjNameInput] = useState("");
  const [djNameAvailable, setDjNameAvailable] = useState<boolean | null>(null);
  const [djNameError, setDjNameError] = useState<string | null>(null);
  const [checkingDjName, setCheckingDjName] = useState(false);
  const [savingDjName, setSavingDjName] = useState(false);

  // Upcoming shows (broadcasts + external radio shows)
  const [upcomingShows, setUpcomingShows] = useState<UpcomingShow[]>([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(true);
  const [allShows, setAllShows] = useState<Show[]>([]);

  // My recordings state
  interface Recording {
    id: string;
    showName: string;
    djName?: string;
    createdAt: number;
    duration: number;
    isPublic: boolean;
    slug: string;
    audioUrl?: string;
  }
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(true);
  const [publishingRecording, setPublishingRecording] = useState<string | null>(null);
  const [deletingRecording, setDeletingRecording] = useState<string | null>(null);

  // Auto-save debounce refs
  const bioDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const promoDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const detailsDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const thankYouDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const socialDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const irlShowsDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const radioShowsDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const myRecsDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadRef = useRef(true);

  // Load user profile and DJ profile data
  useEffect(() => {
    if (!user || !db) return;

    const userRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      const data = snapshot.data();
      if (data) {
        setChatUsername(data.chatUsername || null);
        if (data.djProfile) {
          setDjProfile({
            bio: data.djProfile.bio || null,
            promoText: data.djProfile.promoText || null,
            promoHyperlink: data.djProfile.promoHyperlink || null,
            stripeAccountId: data.djProfile.stripeAccountId || null,
            thankYouMessage: data.djProfile.thankYouMessage || null,
            photoUrl: data.djProfile.photoUrl || null,
            location: data.djProfile.location || null,
            genres: data.djProfile.genres || [],
            socialLinks: data.djProfile.socialLinks || {},
            irlShows: data.djProfile.irlShows || [],
            radioShows: data.djProfile.radioShows || [],
            myRecs: data.djProfile.myRecs || { bandcampLinks: [], eventLinks: [] },
          });
          // Only set input values on initial load to avoid overwriting user edits
          if (initialLoadRef.current) {
            setBioInput(data.djProfile.bio || "");
            setPromoTextInput(data.djProfile.promoText || "");
            setPromoHyperlinkInput(data.djProfile.promoHyperlink || "");
            setThankYouInput(data.djProfile.thankYouMessage || "");
            setLocationInput(data.djProfile.location || "");
            setGenresInput((data.djProfile.genres || []).join(", "));
            setInstagramInput(data.djProfile.socialLinks?.instagram || "");
            setSoundcloudInput(data.djProfile.socialLinks?.soundcloud || "");
            setBandcampInput(data.djProfile.socialLinks?.bandcamp || "");
            setYoutubeInput(data.djProfile.socialLinks?.youtube || "");
            setBookingEmailInput(data.djProfile.socialLinks?.bookingEmail || "");
            setMixcloudInput(data.djProfile.socialLinks?.mixcloud || "");
            setResidentAdvisorInput(data.djProfile.socialLinks?.residentAdvisor || "");
            setCustomLinksInput(data.djProfile.socialLinks?.customLinks || []);
            // IRL Shows - ensure we always have 2 fields with all properties
            const irlShows = data.djProfile.irlShows || [];
            setIrlShowsInput([
              { name: "", location: "", url: "", date: "", ...irlShows[0] },
              { name: "", location: "", url: "", date: "", ...irlShows[1] },
            ]);
            // Radio Shows - ensure we always have 2 fields with all properties
            const radioShows = data.djProfile.radioShows || [];
            setRadioShowsInput([
              { name: "", radioName: "", url: "", date: "", time: "", duration: "1", ...radioShows[0] },
              { name: "", radioName: "", url: "", date: "", time: "", duration: "1", ...radioShows[1] },
            ]);
            // My Recs - ensure at least one empty field
            const bandcampRecs = data.djProfile.myRecs?.bandcampLinks || [];
            setBandcampRecsInput(bandcampRecs.length > 0 ? bandcampRecs : [""]);
            const eventRecs = data.djProfile.myRecs?.eventLinks || [];
            setEventRecsInput(eventRecs.length > 0 ? eventRecs : [""]);
            initialLoadRef.current = false;
          }
        }
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Fetch schedule to get shows from all stations
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

  // Load upcoming shows for this DJ (broadcast slots + external radio shows)
  useEffect(() => {
    if (!user || !db || !user.email) {
      setLoadingBroadcasts(false);
      return;
    }

    const now = new Date();
    const slotsRef = collection(db, "broadcast-slots");

    const q = query(
      slotsRef,
      where("endTime", ">", Timestamp.fromDate(now)),
      orderBy("endTime", "asc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const shows: UpcomingShow[] = [];
        const seenIds = new Set<string>();

        // 1. Add broadcast slots from Firebase (exclude recordings)
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();

          // Skip recording slots - they are not live broadcasts
          if (data.broadcastType === "recording") return;

          const isMySlot =
            data.liveDjUserId === user.uid ||
            data.djUserId === user.uid ||
            data.djEmail?.toLowerCase() === user.email?.toLowerCase();

          if (isMySlot) {
            const id = `broadcast-${docSnap.id}`;
            seenIds.add(id);
            shows.push({
              id,
              stationId: data.stationId || "broadcast",
              stationName: "Channel Broadcast",
              showName: data.showName || "Broadcast",
              djName: data.djName,
              startTime: (data.startTime as Timestamp).toMillis(),
              endTime: (data.endTime as Timestamp).toMillis(),
              status: data.status,
              isExternal: false,
              broadcastToken: data.broadcastToken,
            });
          }
        });

        // 2. Add external radio shows that match by DJ name (using watchlist strategy)
        if (chatUsername) {
          const nowMs = Date.now();
          for (const show of allShows) {
            // Skip broadcast shows (already handled above)
            if (show.stationId === "broadcast") continue;
            // Skip manually entered DJ radio shows
            if (show.stationId === "dj-radio") continue;
            // Skip IRL shows
            if (show.stationId === "irl") continue;

            // Skip shows that have already ended
            const endTime = new Date(show.endTime).getTime();
            if (endTime <= nowMs) continue;

            // Match by DJ name or show name containing the DJ name (same as watchlist)
            const djMatch = show.dj && containsMatch(show.dj, chatUsername);
            const showNameMatch = containsMatch(show.name, chatUsername);

            if (djMatch || showNameMatch) {
              const id = `external-${show.id}`;
              if (seenIds.has(id)) continue;
              seenIds.add(id);

              const station = getStationById(show.stationId);
              const startTime = new Date(show.startTime).getTime();
              shows.push({
                id,
                showName: show.name,
                djName: show.dj || chatUsername,
                startTime: startTime,
                endTime: endTime,
                status: startTime <= nowMs && endTime > nowMs ? "live" : "scheduled",
                stationId: show.stationId,
                stationName: station?.name || show.stationId,
                isExternal: true,
              });
            }
          }
        }

        // Sort by start time
        shows.sort((a, b) => a.startTime - b.startTime);

        setUpcomingShows(shows);
        setLoadingBroadcasts(false);
      },
      (err) => {
        console.error("Error loading broadcasts:", err);
        setLoadingBroadcasts(false);
      }
    );

    return () => unsubscribe();
  }, [user, chatUsername, allShows]);

  // Load my recordings (broadcast-slots with broadcastType: 'recording' and recordingStatus: 'ready')
  useEffect(() => {
    if (!user || !db) {
      setLoadingRecordings(false);
      return;
    }

    const slotsRef = collection(db, "broadcast-slots");

    // Query for recording slots owned by this user
    // Use simple query to avoid needing composite index, filter client-side
    const q = query(
      slotsRef,
      where("djUserId", "==", user.uid),
      where("broadcastType", "==", "recording")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const recs: Recording[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          // Only include recordings that are ready (filter client-side)
          if (data.recordingStatus === 'ready') {
            recs.push({
              id: docSnap.id,
              showName: data.showName || 'Untitled Recording',
              djName: data.liveDjUsername || data.djUsername,
              createdAt: data.createdAt?.toMillis?.() || data.createdAt || Date.now(),
              duration: data.recordingDuration || 0,
              isPublic: data.isPublic || false,
              slug: docSnap.id,
              audioUrl: data.recordingUrl,
            });
          }
        });
        // Sort by createdAt descending (client-side)
        recs.sort((a, b) => b.createdAt - a.createdAt);
        setRecordings(recs);
        setLoadingRecordings(false);
      },
      (err) => {
        console.error("Error loading recordings:", err);
        setLoadingRecordings(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Handle publish/unpublish recording
  const handlePublishRecording = useCallback(async (recordingId: string, publish: boolean) => {
    if (!user) return;
    setPublishingRecording(recordingId);
    try {
      const res = await fetch('/api/recording/publish', {
        method: publish ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archiveId: recordingId, userId: user.uid }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error('Failed to update recording:', data.error);
      }
    } catch (error) {
      console.error('Error updating recording:', error);
    } finally {
      setPublishingRecording(null);
    }
  }, [user]);

  // Handle delete recording
  const handleDeleteRecording = useCallback(async (recordingId: string) => {
    if (!user) return;
    if (!confirm('Are you sure you want to delete this recording? This cannot be undone.')) {
      return;
    }
    setDeletingRecording(recordingId);
    try {
      const res = await fetch('/api/recording/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archiveId: recordingId, userId: user.uid }),
      });
      if (!res.ok) {
        const data = await res.json();
        console.error('Failed to delete recording:', data.error);
      }
    } catch (error) {
      console.error('Error deleting recording:', error);
    } finally {
      setDeletingRecording(null);
    }
  }, [user]);

  // Sync DJ profile data to broadcast slots
  const syncProfileToSlots = useCallback(async (updates: {
    bio?: string | null;
    photoUrl?: string | null;
    promoText?: string | null;
    promoHyperlink?: string | null;
    thankYouMessage?: string | null;
  }) => {
    if (!user) return;
    try {
      await fetch('/api/dj-profile/sync-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          ...updates,
        }),
      });
    } catch (error) {
      console.error("Error syncing profile to slots:", error);
    }
  }, [user]);

  const saveAbout = useCallback(async (bio: string) => {
    if (!user || !db) return;

    setSavingAbout(true);
    setSaveAboutSuccess(false);

    try {
      const userRef = doc(db, "users", user.uid);
      const newBio = bio.trim() || null;
      await updateDoc(userRef, {
        "djProfile.bio": newBio,
      });
      await syncProfileToSlots({ bio: newBio });
      setSaveAboutSuccess(true);
      setTimeout(() => setSaveAboutSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving about:", error);
    } finally {
      setSavingAbout(false);
    }
  }, [user, syncProfileToSlots]);

  const saveDetails = useCallback(async (location: string, genres: string) => {
    if (!user || !db) return;

    setSavingDetails(true);
    setSaveDetailsSuccess(false);

    try {
      const userRef = doc(db, "users", user.uid);
      const genresArray = genres
        .split(",")
        .map((g) => g.trim())
        .filter((g) => g.length > 0);

      await updateDoc(userRef, {
        "djProfile.location": location.trim() || null,
        "djProfile.genres": genresArray,
      });
      setSaveDetailsSuccess(true);
      setTimeout(() => setSaveDetailsSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving details:", error);
    } finally {
      setSavingDetails(false);
    }
  }, [user]);

  const saveSocialLinks = useCallback(async (
    instagram: string,
    soundcloud: string,
    bandcamp: string,
    youtube: string,
    bookingEmail: string,
    mixcloud: string,
    residentAdvisor: string,
    customLinks: CustomLink[]
  ) => {
    if (!user || !db) return;

    setSavingSocial(true);
    setSaveSocialSuccess(false);

    try {
      const userRef = doc(db, "users", user.uid);
      // Filter out empty custom links
      const validCustomLinks = customLinks.filter(
        (link) => link.label.trim() && link.url.trim()
      ).map((link) => ({
        label: link.label.trim(),
        url: normalizeUrl(link.url.trim()),
      }));

      await updateDoc(userRef, {
        "djProfile.socialLinks": {
          instagram: instagram.trim() || null,
          soundcloud: soundcloud.trim() ? normalizeUrl(soundcloud.trim()) : null,
          bandcamp: bandcamp.trim() ? normalizeUrl(bandcamp.trim()) : null,
          youtube: youtube.trim() ? normalizeUrl(youtube.trim()) : null,
          bookingEmail: bookingEmail.trim() || null,
          mixcloud: mixcloud.trim() ? normalizeUrl(mixcloud.trim()) : null,
          residentAdvisor: residentAdvisor.trim() ? normalizeUrl(residentAdvisor.trim()) : null,
          customLinks: validCustomLinks.length > 0 ? validCustomLinks : null,
        },
      });
      setSaveSocialSuccess(true);
      setTimeout(() => setSaveSocialSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving social links:", error);
    } finally {
      setSavingSocial(false);
    }
  }, [user]);

  const saveIrlShows = useCallback(async (shows: IrlShow[]) => {
    if (!user || !db) return;

    setSavingIrlShows(true);
    setSaveIrlShowsSuccess(false);

    try {
      const userRef = doc(db, "users", user.uid);
      // Filter out empty shows but always save the array structure
      const validShows = shows.filter(
        (show) => (show.url || "").trim() || (show.date || "").trim() || (show.name || "").trim() || (show.location || "").trim()
      ).map((show) => ({
        name: (show.name || "").trim(),
        location: (show.location || "").trim(),
        url: (show.url || "").trim() ? normalizeUrl((show.url || "").trim()) : "",
        date: (show.date || "").trim(),
      }));

      await updateDoc(userRef, {
        "djProfile.irlShows": validShows,
      });
      setSaveIrlShowsSuccess(true);
      setTimeout(() => setSaveIrlShowsSuccess(false), 2000);

      // Sync IRL shows to followers
      if (validShows.length > 0) {
        try {
          await fetch('/api/dj/sync-shows-to-followers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              djUserId: user.uid,
              djUsername: chatUsername?.replace(/\s+/g, "").toLowerCase() || "",
              djName: chatUsername || "",
              djPhotoUrl: djProfile.photoUrl || undefined,
              irlShows: validShows,
              radioShows: [],
            }),
          });
        } catch (syncError) {
          console.error("Failed to sync IRL shows to followers:", syncError);
        }
      }
    } catch (error) {
      console.error("Error saving IRL shows:", error);
    } finally {
      setSavingIrlShows(false);
    }
  }, [user, chatUsername, djProfile.photoUrl]);

  const saveRadioShows = useCallback(async (shows: RadioShow[]) => {
    if (!user || !db) return;

    setSavingRadioShows(true);
    setSaveRadioShowsSuccess(false);

    // Capture the user's timezone when saving
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    try {
      const userRef = doc(db, "users", user.uid);
      // Filter out empty shows but always save the array structure
      const validShows = shows.filter(
        (show) => (show.url || "").trim() || (show.date || "").trim() || (show.name || "").trim() || (show.radioName || "").trim()
      ).map((show) => ({
        name: (show.name || "").trim(),
        radioName: (show.radioName || "").trim(),
        url: (show.url || "").trim() ? normalizeUrl((show.url || "").trim()) : "",
        date: (show.date || "").trim(),
        time: (show.time || "").trim(),
        duration: (show.duration || "1").trim(),
        timezone: userTimezone, // Store the timezone the time was entered in
      }));

      await updateDoc(userRef, {
        "djProfile.radioShows": validShows,
      });
      setSaveRadioShowsSuccess(true);
      setTimeout(() => setSaveRadioShowsSuccess(false), 2000);

      // Sync radio shows to followers
      if (validShows.length > 0) {
        try {
          await fetch('/api/dj/sync-shows-to-followers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              djUserId: user.uid,
              djUsername: chatUsername?.replace(/\s+/g, "").toLowerCase() || "",
              djName: chatUsername || "",
              djPhotoUrl: djProfile.photoUrl || undefined,
              irlShows: [],
              radioShows: validShows,
            }),
          });
        } catch (syncError) {
          console.error("Failed to sync radio shows to followers:", syncError);
        }
      }
    } catch (error) {
      console.error("Error saving radio shows:", error);
    } finally {
      setSavingRadioShows(false);
    }
  }, [user, chatUsername, djProfile.photoUrl]);

  const saveMyRecs = useCallback(async (bandcampRecs: string[], eventRecs: string[]) => {
    if (!user || !db) return;

    setSavingMyRecs(true);
    setSaveMyRecsSuccess(false);

    try {
      const userRef = doc(db, "users", user.uid);
      // Filter out empty links and normalize URLs
      const validBandcampLinks = bandcampRecs
        .filter((url) => url.trim())
        .map((url) => normalizeUrl(url.trim()));
      const validEventLinks = eventRecs
        .filter((url) => url.trim())
        .map((url) => normalizeUrl(url.trim()));

      await updateDoc(userRef, {
        "djProfile.myRecs": {
          bandcampLinks: validBandcampLinks.length > 0 ? validBandcampLinks : null,
          eventLinks: validEventLinks.length > 0 ? validEventLinks : null,
        },
      });
      setSaveMyRecsSuccess(true);
      setTimeout(() => setSaveMyRecsSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving my recs:", error);
    } finally {
      setSavingMyRecs(false);
    }
  }, [user]);

  const saveThankYou = useCallback(async (message: string) => {
    if (!user || !db) return;

    setSavingThankYou(true);
    setSaveThankYouSuccess(false);

    try {
      const userRef = doc(db, "users", user.uid);
      const newThankYouMessage = message.trim() || null;
      await updateDoc(userRef, {
        "djProfile.thankYouMessage": newThankYouMessage,
      });
      await syncProfileToSlots({ thankYouMessage: newThankYouMessage });
      setSaveThankYouSuccess(true);
      setTimeout(() => setSaveThankYouSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving thank you message:", error);
    } finally {
      setSavingThankYou(false);
    }
  }, [user, syncProfileToSlots]);

  const savePromo = useCallback(async (promoText: string, promoHyperlink: string) => {
    if (!user || !db) return;

    setSaving(true);
    setSaveSuccess(false);

    try {
      const userRef = doc(db, "users", user.uid);
      const newPromoText = promoText.trim() || null;
      const newPromoHyperlink = promoHyperlink.trim() ? normalizeUrl(promoHyperlink.trim()) : null;
      await updateDoc(userRef, {
        "djProfile.promoText": newPromoText,
        "djProfile.promoHyperlink": newPromoHyperlink,
      });
      await syncProfileToSlots({ promoText: newPromoText, promoHyperlink: newPromoHyperlink });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving promo:", error);
    } finally {
      setSaving(false);
    }
  }, [user, syncProfileToSlots]);

  // Auto-save bio with debounce
  useEffect(() => {
    if (initialLoadRef.current) return;
    if (bioDebounceRef.current) clearTimeout(bioDebounceRef.current);
    bioDebounceRef.current = setTimeout(() => saveAbout(bioInput), 1000);
    return () => { if (bioDebounceRef.current) clearTimeout(bioDebounceRef.current); };
  }, [bioInput, saveAbout]);

  // Auto-save promo with debounce
  useEffect(() => {
    if (initialLoadRef.current) return;
    if (promoDebounceRef.current) clearTimeout(promoDebounceRef.current);
    promoDebounceRef.current = setTimeout(() => savePromo(promoTextInput, promoHyperlinkInput), 1000);
    return () => { if (promoDebounceRef.current) clearTimeout(promoDebounceRef.current); };
  }, [promoTextInput, promoHyperlinkInput, savePromo]);

  // Auto-save details with debounce
  useEffect(() => {
    if (initialLoadRef.current) return;
    if (detailsDebounceRef.current) clearTimeout(detailsDebounceRef.current);
    detailsDebounceRef.current = setTimeout(() => saveDetails(locationInput, genresInput), 1000);
    return () => { if (detailsDebounceRef.current) clearTimeout(detailsDebounceRef.current); };
  }, [locationInput, genresInput, saveDetails]);

  // Auto-save thank you with debounce
  useEffect(() => {
    if (initialLoadRef.current) return;
    if (thankYouDebounceRef.current) clearTimeout(thankYouDebounceRef.current);
    thankYouDebounceRef.current = setTimeout(() => saveThankYou(thankYouInput), 1000);
    return () => { if (thankYouDebounceRef.current) clearTimeout(thankYouDebounceRef.current); };
  }, [thankYouInput, saveThankYou]);

  // Auto-save social links with debounce
  useEffect(() => {
    if (initialLoadRef.current) return;
    if (socialDebounceRef.current) clearTimeout(socialDebounceRef.current);
    socialDebounceRef.current = setTimeout(() => saveSocialLinks(
      instagramInput, soundcloudInput, bandcampInput, youtubeInput,
      bookingEmailInput, mixcloudInput, residentAdvisorInput, customLinksInput
    ), 1000);
    return () => { if (socialDebounceRef.current) clearTimeout(socialDebounceRef.current); };
  }, [instagramInput, soundcloudInput, bandcampInput, youtubeInput, bookingEmailInput, mixcloudInput, residentAdvisorInput, customLinksInput, saveSocialLinks]);

  // Auto-save IRL shows with debounce
  useEffect(() => {
    if (initialLoadRef.current) return;
    if (irlShowsDebounceRef.current) clearTimeout(irlShowsDebounceRef.current);
    irlShowsDebounceRef.current = setTimeout(() => saveIrlShows(irlShowsInput), 1000);
    return () => { if (irlShowsDebounceRef.current) clearTimeout(irlShowsDebounceRef.current); };
  }, [irlShowsInput, saveIrlShows]);

  // Auto-save radio shows with debounce
  useEffect(() => {
    if (initialLoadRef.current) return;
    if (radioShowsDebounceRef.current) clearTimeout(radioShowsDebounceRef.current);
    radioShowsDebounceRef.current = setTimeout(() => saveRadioShows(radioShowsInput), 1000);
    return () => { if (radioShowsDebounceRef.current) clearTimeout(radioShowsDebounceRef.current); };
  }, [radioShowsInput, saveRadioShows]);

  // Auto-save my recs with debounce
  useEffect(() => {
    if (initialLoadRef.current) return;
    if (myRecsDebounceRef.current) clearTimeout(myRecsDebounceRef.current);
    myRecsDebounceRef.current = setTimeout(() => saveMyRecs(bandcampRecsInput, eventRecsInput), 1000);
    return () => { if (myRecsDebounceRef.current) clearTimeout(myRecsDebounceRef.current); };
  }, [bandcampRecsInput, eventRecsInput, saveMyRecs]);

  // Check DJ name availability with debounce
  const checkDjNameAvailability = async (name: string) => {
    if (!user) return;

    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setDjNameAvailable(null);
      setDjNameError(trimmed.length > 0 ? "DJ name must be at least 2 characters" : null);
      return;
    }

    setCheckingDjName(true);
    setDjNameError(null);

    try {
      const res = await fetch(`/api/chat/check-username?username=${encodeURIComponent(trimmed)}&userId=${user.uid}`);
      const data = await res.json();

      if (data.available) {
        setDjNameAvailable(true);
        setDjNameError(null);
      } else {
        setDjNameAvailable(false);
        setDjNameError(data.reason || "Name not available");
      }
    } catch {
      setDjNameError("Failed to check availability");
      setDjNameAvailable(null);
    } finally {
      setCheckingDjName(false);
    }
  };

  // Save DJ name (registers as chat username)
  const handleSaveDjName = async () => {
    if (!user || !djNameInput.trim() || !djNameAvailable) return;

    setSavingDjName(true);
    setDjNameError(null);

    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/chat/register-username', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ username: djNameInput.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setDjNameError(data.error || "Failed to save DJ name");
        return;
      }

      // Success - chatUsername will be updated via Firestore listener
      setDjNameInput("");
      setDjNameAvailable(null);
    } catch {
      setDjNameError("Failed to save DJ name");
    } finally {
      setSavingDjName(false);
    }
  };

  const handleConnectStripe = async () => {
    if (!user) return;

    setConnectingStripe(true);
    setStripeError(null);

    try {
      const createRes = await fetch('/api/stripe/connect/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, email: user.email }),
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createData.error || 'Failed to create account');
      }

      const linkRes = await fetch('/api/stripe/connect/account-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid }),
      });

      const linkData = await linkRes.json();
      if (!linkRes.ok) {
        throw new Error(linkData.error || 'Failed to create onboarding link');
      }

      window.location.href = linkData.url;
    } catch (err) {
      setStripeError(err instanceof Error ? err.message : 'Something went wrong');
      setConnectingStripe(false);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !db) return;

    setPhotoError(null);

    const validation = validatePhoto(file);
    if (!validation.valid) {
      setPhotoError(validation.error || 'Invalid file');
      return;
    }

    setUploadingPhoto(true);

    try {
      const result = await uploadDJPhoto(user.uid, file);

      if (!result.success) {
        setPhotoError(result.error || 'Upload failed');
        return;
      }

      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        "djProfile.photoUrl": result.url,
      });

      await syncProfileToSlots({ photoUrl: result.url });
    } catch (error) {
      console.error("Error uploading photo:", error);
      setPhotoError('Failed to upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!user || !db || !djProfile.photoUrl) return;

    setUploadingPhoto(true);
    setPhotoError(null);

    try {
      await deleteDJPhoto(user.uid, djProfile.photoUrl);

      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        "djProfile.photoUrl": null,
      });

      await syncProfileToSlots({ photoUrl: null });
    } catch (error) {
      console.error("Error removing photo:", error);
      setPhotoError('Failed to remove photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

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

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const formatRecordingDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-black">
        <Header currentPage="studio" position="sticky" />
        <main className="p-4 md:p-8">
          <div className="max-w-2xl mx-auto">
            {/* Hero Section */}
            <div className="mb-12">
              <h1 className="text-3xl font-bold mb-4">DJ Studio</h1>
              <p className="text-xl text-gray-300 mb-6">Create your DJ profile on Channel</p>

              <p className="text-gray-400 leading-relaxed mb-8">
                Think of Channel as SoundCloud + Linktree + live radio — built for DJs and their communities.
              </p>

              <h2 className="text-lg font-semibold mb-4">What you get when you sign up</h2>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="w-6 h-6 flex-shrink-0 mt-0.5">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium">A public DJ profile</p>
                    <p className="text-gray-400 text-sm">
                      Your own DJ page with links, shows, and sets (example →{' '}
                      <Link href="/dj/djcap" className="text-white underline hover:text-gray-300">channel-app.com/dj/djcap</Link>)
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-6 h-6 flex-shrink-0 mt-0.5">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium">Live or recorded sets</p>
                    <p className="text-gray-400 text-sm">Livestream or record sets from home or directly from a venue</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-6 h-6 flex-shrink-0 mt-0.5">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium">Automatic fan notifications</p>
                    <p className="text-gray-400 text-sm">Fans get notified every time you play — live on Channel, on any radio, when you promote a new event, or release a new record</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-6 h-6 flex-shrink-0 mt-0.5">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium">Chat &amp; tips</p>
                    <p className="text-gray-400 text-sm">Talk to listeners, receive tips, and reward your community</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Sign Up Section */}
            <div className="border-t border-gray-800 pt-12">
              <h2 className="text-2xl font-semibold mb-6">Sign up</h2>
              <div className="max-w-sm">
                <AuthModal
                  isOpen={true}
                  onClose={() => {}}
                  message="Create your DJ profile"
                  inline
                  includeDjTerms
                />
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Not a DJ
  if (!isDJ(role)) {
    return (
      <div className="min-h-screen bg-black">
        <Header currentPage="studio" position="sticky" />
        <main className="max-w-xl mx-auto p-4">
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">
              DJ Studio is only available to approved DJs.
            </p>
            <p className="text-gray-600 text-sm mb-6">
              Want to broadcast on Channel?
            </p>
            <Link
              href="/studio/join"
              className="bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors inline-block"
            >
              Apply to DJ
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <Header currentPage="studio" position="sticky" />

      <main className="max-w-xl mx-auto p-4">
        {/* DJ Name Setup Banner - shown when chatUsername is not set */}
        {!chatUsername && (
          <div className="mb-6 bg-gradient-to-r from-purple-900/50 to-blue-900/50 border border-purple-500/30 rounded-lg p-4">
            <h2 className="text-white font-medium mb-1">Set Your DJ Name</h2>
            <p className="text-gray-400 text-sm mb-4">
              Choose a name for your profile and personal URL. This will also be your chat username.
            </p>
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={djNameInput}
                    onChange={(e) => {
                      setDjNameInput(e.target.value);
                      // Debounce the availability check
                      const value = e.target.value;
                      setTimeout(() => {
                        if (value === e.target.value) {
                          checkDjNameAvailability(value);
                        }
                      }, 300);
                    }}
                    placeholder="e.g., DJ Cool"
                    maxLength={20}
                    className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none"
                  />
                  {checkingDjName && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                  {!checkingDjName && djNameAvailable === true && djNameInput.trim() && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                  {!checkingDjName && djNameAvailable === false && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleSaveDjName}
                  disabled={savingDjName || !djNameAvailable || !djNameInput.trim()}
                  className="bg-white text-black px-4 py-2 rounded-lg font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingDjName ? "Saving..." : "Save"}
                </button>
              </div>
              {djNameError && (
                <p className="text-red-400 text-sm">{djNameError}</p>
              )}
              {djNameAvailable && djNameInput.trim() && (
                <p className="text-gray-500 text-sm">
                  Your profile URL will be: <span className="text-purple-400">/dj/{djNameInput.trim().replace(/\s+/g, '').toLowerCase()}</span>
                </p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-8">
          {/* Profile section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Profile
            </h2>
            <div className="bg-[#1a1a1a] rounded-lg divide-y divide-gray-800">
              <div className="p-4 flex items-center justify-between">
                <span className="text-gray-400">DJ Name</span>
                <span className="text-white">
                  {chatUsername || <span className="text-gray-600">Not set</span>}
                </span>
              </div>
              <div className="p-4 flex items-center justify-between">
                <span className="text-gray-400">Email</span>
                <span className="text-white text-sm">{user?.email}</span>
              </div>
              {chatUsername && (
                <div className="p-4 flex items-center justify-between">
                  <span className="text-gray-400">Public Profile</span>
                  <Link
                    href={`/dj/${chatUsername.replace(/\s+/g, '').toLowerCase()}`}
                    className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
                  >
                    /dj/{chatUsername.replace(/\s+/g, '').toLowerCase()} &rarr;
                  </Link>
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-col sm:flex-row gap-3">
              <Link
                href="/studio/join"
                className="flex-1 block bg-white text-black text-center py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors"
              >
                Request a live stream slot
              </Link>
              <Link
                href="/record"
                className="flex-1 block bg-gray-800 text-white text-center py-3 rounded-lg font-medium hover:bg-gray-700 transition-colors border border-gray-700"
              >
                Record my set
              </Link>
            </div>
          </section>

          {/* Profile Photo section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Profile Photo
            </h2>
            <div className="bg-[#1a1a1a] rounded-lg p-4">
              <div className="flex items-center gap-4">
                <div className="relative w-20 h-20 flex-shrink-0">
                  {djProfile.photoUrl ? (
                    <Image
                      src={djProfile.photoUrl}
                      alt="Profile photo"
                      fill
                      className="rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-gray-800 flex items-center justify-center">
                      <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                  )}
                  {uploadingPhoto && (
                    <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-2">
                  <label className="block">
                    <span className="sr-only">Choose photo</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      onChange={handlePhotoChange}
                      disabled={uploadingPhoto}
                      className="block w-full text-sm text-gray-400
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-lg file:border-0
                        file:text-sm file:font-medium
                        file:bg-white file:text-black
                        file:cursor-pointer file:hover:bg-gray-100
                        file:disabled:opacity-50 file:disabled:cursor-not-allowed
                        cursor-pointer"
                    />
                  </label>
                  {djProfile.photoUrl && (
                    <button
                      onClick={handleRemovePhoto}
                      disabled={uploadingPhoto}
                      className="text-red-400 hover:text-red-300 text-sm transition-colors disabled:opacity-50"
                    >
                      Remove photo
                    </button>
                  )}
                </div>
              </div>

              {photoError && (
                <p className="text-red-400 text-sm mt-3">{photoError}</p>
              )}
            </div>
            <p className="text-gray-600 text-xs mt-2 px-1">
              JPG, PNG, GIF, or WebP. Max 5MB. Appears during your live broadcasts and on your public profile.
            </p>
          </section>

          {/* About section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-1">
              About
            </h2>
            <p className="text-gray-600 text-xs mb-3 px-1">
              Your bio appears on your public DJ profile and during broadcasts.
            </p>
            <div className="bg-[#1a1a1a] rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Bio
                </label>
                <textarea
                  value={bioInput}
                  onChange={(e) => setBioInput(e.target.value)}
                  placeholder="Tell listeners about yourself..."
                  rows={3}
                  maxLength={500}
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none resize-none"
                />
                <div className="flex justify-between items-center mt-1">
                  <span className="text-gray-600 text-xs">
                    {savingAbout ? "Saving..." : saveAboutSuccess ? "Saved" : ""}
                  </span>
                  <span className="text-gray-600 text-xs">
                    {bioInput.length}/500
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Promo section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-1">
              Promo
            </h2>
            <p className="text-gray-600 text-xs mb-3 px-1">
              This appears in chat when you&apos;re live on Channel Broadcast.
            </p>
            <div className="bg-[#1a1a1a] rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Promo Text
                </label>
                <input
                  type="text"
                  value={promoTextInput}
                  onChange={(e) => setPromoTextInput(e.target.value)}
                  placeholder="e.g., New album out now!"
                  maxLength={200}
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
                <p className="text-gray-600 text-xs mt-1 text-right">
                  {promoTextInput.length}/200
                </p>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Promo Hyperlink (optional)
                </label>
                <input
                  type="text"
                  value={promoHyperlinkInput}
                  onChange={(e) => setPromoHyperlinkInput(e.target.value)}
                  placeholder="bandcamp.com/your-album"
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
                <p className="text-gray-600 text-xs mt-1">
                  {saving ? "Saving..." : saveSuccess ? "Saved" : ""}
                </p>
              </div>
            </div>
          </section>

          {/* Location & Genres section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Location & Genres
            </h2>
            <div className="bg-[#1a1a1a] rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Location (City)
                </label>
                <input
                  type="text"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  placeholder="e.g., Los Angeles"
                  maxLength={100}
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Genres / Vibes
                </label>
                <input
                  type="text"
                  value={genresInput}
                  onChange={(e) => setGenresInput(e.target.value)}
                  placeholder="e.g., House, Techno, Ambient"
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
                <div className="flex justify-between items-center mt-1">
                  <span className="text-gray-600 text-xs">
                    {savingDetails ? "Saving..." : saveDetailsSuccess ? "Saved" : ""}
                  </span>
                  <span className="text-gray-600 text-xs">
                    Separate genres with commas
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Thank You Message section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-1">
              Thank You Message
            </h2>
            <p className="text-gray-600 text-xs mb-3 px-1">
              This message shows to listeners after they tip you.
            </p>
            <div className="bg-[#1a1a1a] rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Message for Tippers
                </label>
                <textarea
                  value={thankYouInput}
                  onChange={(e) => setThankYouInput(e.target.value)}
                  placeholder="Thanks for the tip!"
                  rows={2}
                  maxLength={200}
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none resize-none"
                />
                <div className="flex justify-between items-center mt-1">
                  <span className="text-gray-600 text-xs">
                    {savingThankYou ? "Saving..." : saveThankYouSuccess ? "Saved" : ""}
                  </span>
                  <span className="text-gray-600 text-xs">
                    {thankYouInput.length}/200
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Social Links section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-1">
              Social Links
            </h2>
            <p className="text-gray-600 text-xs mb-3 px-1">
              These links appear on your public DJ profile.
            </p>
            <div className="bg-[#1a1a1a] rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Instagram
                </label>
                <input
                  type="text"
                  value={instagramInput}
                  onChange={(e) => setInstagramInput(e.target.value)}
                  placeholder="@yourhandle"
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  SoundCloud
                </label>
                <input
                  type="text"
                  value={soundcloudInput}
                  onChange={(e) => setSoundcloudInput(e.target.value)}
                  placeholder="https://soundcloud.com/yourname"
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Bandcamp
                </label>
                <input
                  type="text"
                  value={bandcampInput}
                  onChange={(e) => setBandcampInput(e.target.value)}
                  placeholder="https://yourname.bandcamp.com"
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  YouTube
                </label>
                <input
                  type="text"
                  value={youtubeInput}
                  onChange={(e) => setYoutubeInput(e.target.value)}
                  placeholder="https://youtube.com/@yourname"
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Mixcloud
                </label>
                <input
                  type="text"
                  value={mixcloudInput}
                  onChange={(e) => setMixcloudInput(e.target.value)}
                  placeholder="https://mixcloud.com/yourname"
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Resident Advisor
                </label>
                <input
                  type="text"
                  value={residentAdvisorInput}
                  onChange={(e) => setResidentAdvisorInput(e.target.value)}
                  placeholder="https://ra.co/dj/yourname"
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Booking Email
                </label>
                <input
                  type="email"
                  value={bookingEmailInput}
                  onChange={(e) => setBookingEmailInput(e.target.value)}
                  placeholder="booking@yourdomain.com"
                  className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
              </div>

              {/* Custom Links */}
              <div className="border-t border-gray-800 pt-4">
                <label className="block text-gray-400 text-sm mb-2">
                  Other Links
                </label>
                <div className="space-y-3">
                  {customLinksInput.map((link, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={link.label}
                        onChange={(e) => {
                          const updated = [...customLinksInput];
                          updated[index] = { ...updated[index], label: e.target.value };
                          setCustomLinksInput(updated);
                        }}
                        placeholder="Label"
                        className="w-1/3 bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={link.url}
                        onChange={(e) => {
                          const updated = [...customLinksInput];
                          updated[index] = { ...updated[index], url: e.target.value };
                          setCustomLinksInput(updated);
                        }}
                        placeholder="URL"
                        className="flex-1 bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                      />
                      <button
                        onClick={() => {
                          const updated = customLinksInput.filter((_, i) => i !== index);
                          setCustomLinksInput(updated);
                        }}
                        className="px-3 py-2 text-gray-500 hover:text-red-400 transition-colors"
                        aria-label="Remove link"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setCustomLinksInput([...customLinksInput, { label: "", url: "" }])}
                    className="text-gray-400 hover:text-white text-sm transition-colors flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Link
                  </button>
                </div>
                <p className="text-gray-600 text-xs mt-2">
                  {savingSocial ? "Saving..." : saveSocialSuccess ? "Saved" : ""}
                </p>
              </div>
            </div>
          </section>

          {/* My Recordings section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-1">
              My Recordings
            </h2>
            <p className="text-gray-600 text-xs mb-3 px-1">
              Manage your recorded sets. Publish them to your profile or delete them.
            </p>
            <div className="bg-[#1a1a1a] rounded-lg">
              {loadingRecordings ? (
                <div className="p-4 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
                </div>
              ) : recordings.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="text-gray-500">No recordings yet</p>
                  <Link
                    href="/record"
                    className="inline-block mt-2 text-blue-400 hover:text-blue-300 text-sm transition-colors"
                  >
                    Start recording &rarr;
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {recordings.map((recording) => (
                    <div key={recording.id} className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium truncate">{recording.showName}</p>
                          <p className="text-gray-400 text-sm">
                            {formatRecordingDate(recording.createdAt)} · {formatDuration(recording.duration)}
                          </p>
                          {recording.isPublic ? (
                            <Link
                              href={`/archive/${recording.slug}`}
                              className="inline-flex items-center gap-1 mt-1 text-green-400 text-xs"
                            >
                              <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                              Published
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-1 mt-1 text-gray-500 text-xs">
                              <span className="w-1.5 h-1.5 bg-gray-500 rounded-full" />
                              Private
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handlePublishRecording(recording.id, !recording.isPublic)}
                            disabled={publishingRecording === recording.id}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              recording.isPublic
                                ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                : 'bg-green-600 text-white hover:bg-green-500'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            {publishingRecording === recording.id ? (
                              <span className="flex items-center gap-1">
                                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                              </span>
                            ) : recording.isPublic ? (
                              'Unpublish'
                            ) : (
                              'Publish'
                            )}
                          </button>
                          <button
                            onClick={() => handleDeleteRecording(recording.id)}
                            disabled={deletingRecording === recording.id}
                            className="p-1.5 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="Delete recording"
                          >
                            {deletingRecording === recording.id ? (
                              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin inline-block" />
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* IRL Shows section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-1">
              IRL Shows
            </h2>
            <p className="text-gray-600 text-xs mb-3 px-1">
              Promote your upcoming in-person gigs.
            </p>
            <div className="bg-[#1a1a1a] rounded-lg p-4 space-y-4">
              {irlShowsInput.map((show, index) => (
                <div key={index} className="space-y-2">
                  <label className="block text-gray-400 text-sm">
                    Show {index + 1}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={show.name}
                      onChange={(e) => {
                        const updated = [...irlShowsInput];
                        updated[index] = { ...updated[index], name: e.target.value };
                        setIrlShowsInput(updated);
                      }}
                      placeholder="Event Name"
                      className="flex-1 bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={show.location}
                      onChange={(e) => {
                        const updated = [...irlShowsInput];
                        updated[index] = { ...updated[index], location: e.target.value };
                        setIrlShowsInput(updated);
                      }}
                      placeholder="City"
                      className="w-32 bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={show.url}
                      onChange={(e) => {
                        const updated = [...irlShowsInput];
                        updated[index] = { ...updated[index], url: e.target.value };
                        setIrlShowsInput(updated);
                      }}
                      placeholder="Event URL (e.g., ra.co/events/...)"
                      className="flex-1 bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                    />
                    <input
                      type="date"
                      value={show.date}
                      onChange={(e) => {
                        const updated = [...irlShowsInput];
                        updated[index] = { ...updated[index], date: e.target.value };
                        setIrlShowsInput(updated);
                      }}
                      className="w-36 bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none [color-scheme:dark]"
                    />
                  </div>
                </div>
              ))}
              <p className="text-gray-600 text-xs">
                {savingIrlShows ? "Saving..." : saveIrlShowsSuccess ? "Saved" : ""}
              </p>
            </div>
          </section>

          {/* Automatically detected shows section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Automatically Detected Shows
            </h2>
            <div className="bg-[#1a1a1a] rounded-lg">
              {loadingBroadcasts ? (
                <div className="p-4 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
                </div>
              ) : upcomingShows.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="text-gray-500">No upcoming shows detected</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {upcomingShows.map((show) => (
                    <div key={show.id} className="p-4">
                      <p className="text-white font-medium">{show.showName}</p>
                      <p className="text-gray-400 text-sm">
                        {formatBroadcastTime(show.startTime, show.endTime)}
                      </p>
                      <p className="text-gray-500 text-xs mt-1">{show.stationName}</p>
                      {show.status === "live" ? (
                        <span className="inline-flex items-center gap-1 mt-2 text-red-400 text-xs">
                          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                          Live Now
                        </span>
                      ) : !show.isExternal && show.broadcastToken && (
                        <Link
                          href={`/broadcast/live?token=${show.broadcastToken}`}
                          className="inline-flex items-center gap-1 mt-2 text-blue-400 hover:text-blue-300 text-sm transition-colors"
                        >
                          Go Live &rarr;
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Radio Shows section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-1">
              Radio Shows
            </h2>
            <p className="text-gray-600 text-xs mb-3 px-1">
              Promote your upcoming radio appearances on other stations.
            </p>
            <div className="bg-[#1a1a1a] rounded-lg p-4 space-y-4">
              {radioShowsInput.map((show, index) => (
                <div key={index} className="space-y-2">
                  <label className="block text-gray-400 text-sm">
                    Show {index + 1}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={show.name}
                      onChange={(e) => {
                        const updated = [...radioShowsInput];
                        updated[index] = { ...updated[index], name: e.target.value };
                        setRadioShowsInput(updated);
                      }}
                      placeholder="Show Name"
                      className="flex-1 bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={show.radioName}
                      onChange={(e) => {
                        const updated = [...radioShowsInput];
                        updated[index] = { ...updated[index], radioName: e.target.value };
                        setRadioShowsInput(updated);
                      }}
                      placeholder="Radio Name"
                      className="w-32 bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={show.date}
                      onChange={(e) => {
                        const updated = [...radioShowsInput];
                        updated[index] = { ...updated[index], date: e.target.value };
                        setRadioShowsInput(updated);
                      }}
                      className="flex-1 bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none [color-scheme:dark]"
                    />
                    <select
                      value={show.time}
                      onChange={(e) => {
                        const updated = [...radioShowsInput];
                        updated[index] = { ...updated[index], time: e.target.value };
                        setRadioShowsInput(updated);
                      }}
                      className="w-24 bg-black border border-gray-800 rounded-lg px-2 py-2 text-white focus:border-gray-600 focus:outline-none"
                    >
                      <option value="">Time</option>
                      {Array.from({ length: 48 }, (_, i) => {
                        const hour = Math.floor(i / 2);
                        const minute = i % 2 === 0 ? "00" : "30";
                        const value = `${hour.toString().padStart(2, "0")}:${minute}`;
                        const label = `${hour.toString().padStart(2, "0")}:${minute}`;
                        return <option key={value} value={value}>{label}</option>;
                      })}
                    </select>
                    <select
                      value={show.duration || "1"}
                      onChange={(e) => {
                        const updated = [...radioShowsInput];
                        updated[index] = { ...updated[index], duration: e.target.value };
                        setRadioShowsInput(updated);
                      }}
                      className="w-20 bg-black border border-gray-800 rounded-lg px-2 py-2 text-white focus:border-gray-600 focus:outline-none"
                    >
                      <option value="0.5">0.5h</option>
                      <option value="1">1h</option>
                      <option value="1.5">1.5h</option>
                      <option value="2">2h</option>
                      <option value="2.5">2.5h</option>
                      <option value="3">3h</option>
                      <option value="3.5">3.5h</option>
                      <option value="4">4h</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    value={show.url}
                    onChange={(e) => {
                      const updated = [...radioShowsInput];
                      updated[index] = { ...updated[index], url: e.target.value };
                      setRadioShowsInput(updated);
                    }}
                    placeholder="Radio URL (e.g., nts.live/shows/...)"
                    className="w-full bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                  />
                </div>
              ))}
              {/* Timezone confirmation */}
              <div className="flex items-center gap-2 text-gray-500 text-xs pt-2 border-t border-gray-800">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  Times are in your local timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                </span>
              </div>
              <p className="text-gray-600 text-xs">
                {savingRadioShows ? "Saving..." : saveRadioShowsSuccess ? "Saved" : ""}
              </p>
            </div>
          </section>

          {/* My Recs section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-1">
              My Recs
            </h2>
            <p className="text-gray-600 text-xs mb-3 px-1">
              Share music and events you recommend with your listeners.
            </p>
            <div className="bg-[#1a1a1a] rounded-lg p-4 space-y-6">
              {/* Bandcamp subsection */}
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Bandcamp
                </label>
                <div className="space-y-2">
                  {bandcampRecsInput.map((url, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={url}
                        onChange={(e) => {
                          const updated = [...bandcampRecsInput];
                          updated[index] = e.target.value;
                          setBandcampRecsInput(updated);
                        }}
                        placeholder="https://artist.bandcamp.com/album"
                        className="flex-1 bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                      />
                      {bandcampRecsInput.length > 1 && (
                        <button
                          onClick={() => {
                            const updated = bandcampRecsInput.filter((_, i) => i !== index);
                            setBandcampRecsInput(updated);
                          }}
                          className="px-3 py-2 text-gray-500 hover:text-red-400 transition-colors"
                          aria-label="Remove link"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setBandcampRecsInput([...bandcampRecsInput, ""])}
                    className="text-gray-400 hover:text-white text-sm transition-colors flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Bandcamp Link
                  </button>
                </div>
              </div>

              {/* Events subsection */}
              <div className="border-t border-gray-800 pt-4">
                <label className="block text-gray-400 text-sm mb-2">
                  Events
                </label>
                <div className="space-y-2">
                  {eventRecsInput.map((url, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={url}
                        onChange={(e) => {
                          const updated = [...eventRecsInput];
                          updated[index] = e.target.value;
                          setEventRecsInput(updated);
                        }}
                        placeholder="https://ra.co/events/..."
                        className="flex-1 bg-black border border-gray-800 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                      />
                      {eventRecsInput.length > 1 && (
                        <button
                          onClick={() => {
                            const updated = eventRecsInput.filter((_, i) => i !== index);
                            setEventRecsInput(updated);
                          }}
                          className="px-3 py-2 text-gray-500 hover:text-red-400 transition-colors"
                          aria-label="Remove link"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setEventRecsInput([...eventRecsInput, ""])}
                    className="text-gray-400 hover:text-white text-sm transition-colors flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Event Link
                  </button>
                </div>
                <p className="text-gray-600 text-xs mt-2">
                  {savingMyRecs ? "Saving..." : saveMyRecsSuccess ? "Saved" : ""}
                </p>
              </div>
            </div>
          </section>

          {/* Payments section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Payments
            </h2>
            <div className="bg-[#1a1a1a] rounded-lg p-4 space-y-4">
              {stripeError && (
                <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {stripeError}
                </div>
              )}

              {djProfile.stripeAccountId ? (
                <>
                  <div className="p-3 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 text-sm">
                    Stripe connected! Tips are automatically transferred to your bank.
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-500/20">
                      <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-white font-medium">Stripe Connected</p>
                      <p className="text-gray-500 text-sm">View payouts and manage your account</p>
                    </div>
                    <a
                      href="https://dashboard.stripe.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-100 transition-colors"
                    >
                      Manage
                    </a>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gray-800">
                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-medium">Connect Stripe</p>
                    <p className="text-gray-500 text-sm">Set up to receive tips from listeners</p>
                  </div>
                  <button
                    onClick={handleConnectStripe}
                    disabled={connectingStripe}
                    className="px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
                  >
                    {connectingStripe ? 'Connecting...' : 'Connect'}
                  </button>
                </div>
              )}

              {!payoutLoading && (pendingCents > 0 || transferredCents > 0) && (
                <div className="border-t border-gray-800 pt-4">
                  <h3 className="text-gray-400 text-sm mb-3">Earnings</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {pendingCents > 0 && (
                      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                        <p className="text-yellow-400 text-lg font-medium">
                          ${(pendingCents / 100).toFixed(2)}
                        </p>
                        <p className="text-gray-500 text-xs">
                          {pendingCount} pending {pendingCount === 1 ? 'tip' : 'tips'}
                        </p>
                      </div>
                    )}
                    {transferredCents > 0 && (
                      <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                        <p className="text-green-400 text-lg font-medium">
                          ${(transferredCents / 100).toFixed(2)}
                        </p>
                        <p className="text-gray-500 text-xs">
                          Transferred
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!djProfile.stripeAccountId && pendingCents > 0 && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <p className="text-yellow-400 text-sm">
                    You have ${(pendingCents / 100).toFixed(2)} in pending tips. Connect Stripe to receive them!
                  </p>
                </div>
              )}
            </div>
            <p className="text-gray-600 text-xs mt-2 px-1">
              Listeners can tip you during broadcasts. Tips are transferred to your bank within 2 days.
            </p>
          </section>
        </div>
      </main>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        includeDjTerms
      />
    </div>
  );
}
