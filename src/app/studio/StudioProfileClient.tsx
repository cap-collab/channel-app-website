"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { doc, onSnapshot, updateDoc, collection, query, where, orderBy, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUserRole, isDJ } from "@/hooks/useUserRole";
import { AuthModal } from "@/components/AuthModal";
import { BroadcastSlotSerialized } from "@/types/broadcast";
import { usePendingPayout } from "@/hooks/usePendingPayout";
import { normalizeUrl } from "@/lib/url";
import { uploadDJPhoto, deleteDJPhoto, validatePhoto } from "@/lib/photo-upload";
import { Show } from "@/types";
import { getStationById } from "@/lib/stations";

// Helper: word boundary match (same as watchlist)
function matchesAsWord(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
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
  const [savingSocial, setSavingSocial] = useState(false);
  const [saveSocialSuccess, setSaveSocialSuccess] = useState(false);

  // Form state - Thank You Message section
  const [thankYouInput, setThankYouInput] = useState("");
  const [savingThankYou, setSavingThankYou] = useState(false);
  const [saveThankYouSuccess, setSaveThankYouSuccess] = useState(false);

  // Form state - Promo section
  const [promoTextInput, setPromoTextInput] = useState("");
  const [promoHyperlinkInput, setPromoHyperlinkInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Upcoming shows (broadcasts + external radio shows)
  const [upcomingShows, setUpcomingShows] = useState<UpcomingShow[]>([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(true);
  const [allShows, setAllShows] = useState<Show[]>([]);

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
          });
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

        // 1. Add broadcast slots from Firebase
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
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

            // Skip shows that have already ended
            const endTime = new Date(show.endTime).getTime();
            if (endTime <= nowMs) continue;

            // Match by DJ name or show name containing the DJ name (same as watchlist)
            const djMatch = show.dj && matchesAsWord(show.dj, chatUsername);
            const showNameMatch = matchesAsWord(show.name, chatUsername);

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

  // Sync DJ profile data to broadcast slots
  const syncProfileToSlots = async (bio?: string | null, photoUrl?: string | null) => {
    if (!user) return;
    try {
      await fetch('/api/dj-profile/sync-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          ...(bio !== undefined && { bio }),
          ...(photoUrl !== undefined && { photoUrl }),
        }),
      });
    } catch (error) {
      console.error("Error syncing profile to slots:", error);
    }
  };

  const handleSaveAbout = async () => {
    if (!user || !db) return;

    setSavingAbout(true);
    setSaveAboutSuccess(false);

    try {
      const userRef = doc(db, "users", user.uid);
      const newBio = bioInput.trim() || null;
      await updateDoc(userRef, {
        "djProfile.bio": newBio,
      });
      await syncProfileToSlots(newBio, undefined);
      setSaveAboutSuccess(true);
      setTimeout(() => setSaveAboutSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving about:", error);
    } finally {
      setSavingAbout(false);
    }
  };

  const handleSaveDetails = async () => {
    if (!user || !db) return;

    setSavingDetails(true);
    setSaveDetailsSuccess(false);

    try {
      const userRef = doc(db, "users", user.uid);
      const genresArray = genresInput
        .split(",")
        .map((g) => g.trim())
        .filter((g) => g.length > 0);

      await updateDoc(userRef, {
        "djProfile.location": locationInput.trim() || null,
        "djProfile.genres": genresArray,
      });
      setSaveDetailsSuccess(true);
      setTimeout(() => setSaveDetailsSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving details:", error);
    } finally {
      setSavingDetails(false);
    }
  };

  const handleSaveSocialLinks = async () => {
    if (!user || !db) return;

    setSavingSocial(true);
    setSaveSocialSuccess(false);

    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        "djProfile.socialLinks": {
          instagram: instagramInput.trim() || null,
          soundcloud: soundcloudInput.trim() ? normalizeUrl(soundcloudInput.trim()) : null,
          bandcamp: bandcampInput.trim() ? normalizeUrl(bandcampInput.trim()) : null,
          youtube: youtubeInput.trim() ? normalizeUrl(youtubeInput.trim()) : null,
          bookingEmail: bookingEmailInput.trim() || null,
        },
      });
      setSaveSocialSuccess(true);
      setTimeout(() => setSaveSocialSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving social links:", error);
    } finally {
      setSavingSocial(false);
    }
  };

  const handleSaveThankYou = async () => {
    if (!user || !db) return;

    setSavingThankYou(true);
    setSaveThankYouSuccess(false);

    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        "djProfile.thankYouMessage": thankYouInput.trim() || null,
      });
      setSaveThankYouSuccess(true);
      setTimeout(() => setSaveThankYouSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving thank you message:", error);
    } finally {
      setSavingThankYou(false);
    }
  };

  const handleSavePromo = async () => {
    if (!user || !db) return;

    setSaving(true);
    setSaveSuccess(false);

    try {
      const userRef = doc(db, "users", user.uid);
      const normalizedHyperlink = promoHyperlinkInput.trim() ? normalizeUrl(promoHyperlinkInput.trim()) : null;
      await updateDoc(userRef, {
        "djProfile.promoText": promoTextInput.trim() || null,
        "djProfile.promoHyperlink": normalizedHyperlink,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving promo:", error);
    } finally {
      setSaving(false);
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

      await syncProfileToSlots(undefined, result.url);
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

      await syncProfileToSlots(undefined, null);
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
        <header className="p-4 border-b border-gray-900">
          <div className="max-w-xl mx-auto flex items-center justify-between">
            <Link
              href="/channel"
              className="text-gray-600 hover:text-white text-sm transition-colors"
            >
              &larr; Back
            </Link>
            <h1 className="text-lg font-medium text-white">DJ Studio</h1>
            <div className="w-10" />
          </div>
        </header>
        <main className="max-w-xl mx-auto p-4">
          <div className="text-center py-12">
            <p className="text-gray-500 mb-6">
              Sign in to access your DJ profile
            </p>
            <button
              onClick={() => setShowAuthModal(true)}
              className="bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              Sign In
            </button>
          </div>
        </main>
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
        />
      </div>
    );
  }

  // Not a DJ
  if (!isDJ(role)) {
    return (
      <div className="min-h-screen bg-black">
        <header className="p-4 border-b border-gray-900">
          <div className="max-w-xl mx-auto flex items-center justify-between">
            <Link
              href="/channel"
              className="text-gray-600 hover:text-white text-sm transition-colors"
            >
              &larr; Back
            </Link>
            <h1 className="text-lg font-medium text-white">DJ Studio</h1>
            <div className="w-10" />
          </div>
        </header>
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
      {/* Header */}
      <header className="p-4 border-b border-gray-900">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <Link
            href="/channel"
            className="text-gray-600 hover:text-white text-sm transition-colors"
          >
            &larr; Back
          </Link>
          <h1 className="text-lg font-medium text-white">DJ Studio</h1>
          <div className="w-10" />
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4">
        <div className="space-y-8">
          {/* Profile section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Profile
            </h2>
            <div className="bg-[#1a1a1a] rounded-lg divide-y divide-gray-800">
              <div className="p-4 flex items-center justify-between">
                <span className="text-gray-400">Chat Username</span>
                <span className="text-white">
                  {chatUsername ? `@${chatUsername}` : "Not set"}
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
                    href={`/dj/${chatUsername}`}
                    className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
                  >
                    /dj/{chatUsername} &rarr;
                  </Link>
                </div>
              )}
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
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              About
            </h2>
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
                <p className="text-gray-600 text-xs mt-1 text-right">
                  {bioInput.length}/500
                </p>
              </div>
              <button
                onClick={handleSaveAbout}
                disabled={savingAbout}
                className={`w-full py-2 rounded-lg font-medium transition-colors ${
                  saveAboutSuccess
                    ? "bg-green-600 text-white"
                    : "bg-white text-black hover:bg-gray-100"
                } disabled:opacity-50`}
              >
                {savingAbout ? "Saving..." : saveAboutSuccess ? "Saved!" : "Save Bio"}
              </button>
            </div>
            <p className="text-gray-600 text-xs mt-2 px-1">
              Your bio appears on your public DJ profile and during broadcasts.
            </p>
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
                <p className="text-gray-600 text-xs mt-1">
                  Separate genres with commas
                </p>
              </div>
              <button
                onClick={handleSaveDetails}
                disabled={savingDetails}
                className={`w-full py-2 rounded-lg font-medium transition-colors ${
                  saveDetailsSuccess
                    ? "bg-green-600 text-white"
                    : "bg-white text-black hover:bg-gray-100"
                } disabled:opacity-50`}
              >
                {savingDetails ? "Saving..." : saveDetailsSuccess ? "Saved!" : "Save Details"}
              </button>
            </div>
          </section>

          {/* Social Links section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Social Links
            </h2>
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
              <button
                onClick={handleSaveSocialLinks}
                disabled={savingSocial}
                className={`w-full py-2 rounded-lg font-medium transition-colors ${
                  saveSocialSuccess
                    ? "bg-green-600 text-white"
                    : "bg-white text-black hover:bg-gray-100"
                } disabled:opacity-50`}
              >
                {savingSocial ? "Saving..." : saveSocialSuccess ? "Saved!" : "Save Social Links"}
              </button>
            </div>
            <p className="text-gray-600 text-xs mt-2 px-1">
              These links appear on your public DJ profile.
            </p>
          </section>

          {/* Thank You Message section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Thank You Message
            </h2>
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
                <p className="text-gray-600 text-xs mt-1 text-right">
                  {thankYouInput.length}/200
                </p>
              </div>
              <button
                onClick={handleSaveThankYou}
                disabled={savingThankYou}
                className={`w-full py-2 rounded-lg font-medium transition-colors ${
                  saveThankYouSuccess
                    ? "bg-green-600 text-white"
                    : "bg-white text-black hover:bg-gray-100"
                } disabled:opacity-50`}
              >
                {savingThankYou ? "Saving..." : saveThankYouSuccess ? "Saved!" : "Save Thank You Message"}
              </button>
            </div>
            <p className="text-gray-600 text-xs mt-2 px-1">
              This message shows to listeners after they tip you.
            </p>
          </section>

          {/* Promo section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Promo
            </h2>
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
              </div>
              <button
                onClick={handleSavePromo}
                disabled={saving}
                className={`w-full py-2 rounded-lg font-medium transition-colors ${
                  saveSuccess
                    ? "bg-green-600 text-white"
                    : "bg-white text-black hover:bg-gray-100"
                } disabled:opacity-50`}
              >
                {saving ? "Saving..." : saveSuccess ? "Saved!" : "Save Promo"}
              </button>
            </div>
            <p className="text-gray-600 text-xs mt-2 px-1">
              This appears in chat when you&apos;re live on Channel Broadcast.
            </p>
          </section>

          {/* Upcoming Shows section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Upcoming Shows
            </h2>
            <div className="bg-[#1a1a1a] rounded-lg">
              {loadingBroadcasts ? (
                <div className="p-4 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
                </div>
              ) : upcomingShows.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="text-gray-500">No upcoming shows scheduled</p>
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
      />
    </div>
  );
}
