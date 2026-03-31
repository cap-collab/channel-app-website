"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";

import { Header } from "@/components/Header";
import { doc, onSnapshot, updateDoc, collection, query, where, orderBy, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUserRole, isDJ } from "@/hooks/useUserRole";
import { AuthModal } from "@/components/AuthModal";
import { BroadcastSlotSerialized, ArchiveSerialized } from "@/types/broadcast";
import { uploadDJPhoto, deleteDJPhoto, validatePhoto } from "@/lib/photo-upload";
import { useBPM } from "@/contexts/BPMContext";


interface DJProfile {
  bio: string | null;
  photoUrl: string | null;
}

export function DJProfileClient() {
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);
  const { stationBPM } = useBPM();
  const broadcastBPM = stationBPM['broadcast']?.bpm ?? null;
  const [showAuthModal, setShowAuthModal] = useState(false);


  // Profile data
  const [chatUsername, setChatUsername] = useState<string | null>(null);
  const [djProfile, setDjProfile] = useState<DJProfile>({
    bio: null,
    photoUrl: null,
  });

  // Photo upload state
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);


  // Form state - About section
  const [bioInput, setBioInput] = useState("");
  const [savingAbout, setSavingAbout] = useState(false);
  const [saveAboutSuccess, setSaveAboutSuccess] = useState(false);

  // Upcoming broadcasts
  const [upcomingBroadcasts, setUpcomingBroadcasts] = useState<BroadcastSlotSerialized[]>([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(true);

  // My recordings
  const [myRecordings, setMyRecordings] = useState<ArchiveSerialized[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(true);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  // Upgrade to DJ state
  const [agreedToDJTerms, setAgreedToDJTerms] = useState(false);
  const [upgradingToDJ, setUpgradingToDJ] = useState(false);
  const [upgradeError, setUpgradeError] = useState("");

  // Auto-save debounce refs
  const bioDebounceRef = useRef<NodeJS.Timeout | null>(null);
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
            photoUrl: data.djProfile.photoUrl || null,
          });
          // Only set input values on initial load to avoid overwriting user edits
          if (initialLoadRef.current) {
            setBioInput(data.djProfile.bio || "");
            initialLoadRef.current = false;
          }
        }
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Load upcoming broadcasts for this DJ
  useEffect(() => {
    if (!user || !db || !user.email) {
      setLoadingBroadcasts(false);
      return;
    }

    const now = new Date();
    const slotsRef = collection(db, "broadcast-slots");

    // Query for broadcasts where the DJ email matches and end time is in the future
    const q = query(
      slotsRef,
      where("endTime", ">", Timestamp.fromDate(now)),
      orderBy("endTime", "asc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const slots: BroadcastSlotSerialized[] = [];
        console.log(`[DJ Profile] Found ${snapshot.size} upcoming broadcasts, checking for user email: ${user.email}`);
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          console.log(`[DJ Profile] Slot ${docSnap.id}: djEmail=${data.djEmail}, djName=${data.djName}, liveDjUserId=${data.liveDjUserId}`);
          // Filter client-side by DJ email or user ID
          const isMySlot =
            data.liveDjUserId === user.uid ||
            data.djEmail?.toLowerCase() === user.email?.toLowerCase();

          if (isMySlot) {
            console.log(`[DJ Profile] MATCH! Slot ${docSnap.id} belongs to this DJ`);
            slots.push({
              id: docSnap.id,
              stationId: data.stationId || "broadcast",
              showName: data.showName || "Broadcast",
              djName: data.djName,
              djEmail: data.djEmail,
              startTime: (data.startTime as Timestamp).toMillis(),
              endTime: (data.endTime as Timestamp).toMillis(),
              broadcastToken: data.broadcastToken,
              tokenExpiresAt: (data.tokenExpiresAt as Timestamp).toMillis(),
              createdAt: (data.createdAt as Timestamp).toMillis(),
              createdBy: data.createdBy,
              status: data.status,
              broadcastType: data.broadcastType,
            });
          }
        });
        setUpcomingBroadcasts(slots);
        setLoadingBroadcasts(false);
      },
      (err) => {
        console.error("Error loading broadcasts:", err);
        setLoadingBroadcasts(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Load DJ's recordings (both published and unpublished)
  useEffect(() => {
    if (!user) {
      setLoadingRecordings(false);
      return;
    }

    const fetchRecordings = async () => {
      try {
        // Fetch all archives and filter client-side for this DJ's recordings
        const res = await fetch('/api/archives?includePrivate=true');
        if (!res.ok) {
          console.error('Failed to fetch recordings');
          setLoadingRecordings(false);
          return;
        }

        const data = await res.json();
        const allArchives: ArchiveSerialized[] = data.archives || [];

        // Filter for recordings owned by this DJ
        const djRecordings = allArchives.filter((archive) => {
          // Check if this is the DJ's recording via the djs array
          const isOwner = archive.djs?.some(
            (dj) => dj.userId === user.uid || dj.email?.toLowerCase() === user.email?.toLowerCase()
          );
          // Only show recording-type archives (not live broadcasts)
          return isOwner && archive.sourceType === 'recording';
        });

        // Sort by recordedAt descending (most recent first)
        djRecordings.sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0));
        setMyRecordings(djRecordings);
      } catch (error) {
        console.error('Error fetching recordings:', error);
      } finally {
        setLoadingRecordings(false);
      }
    };

    fetchRecordings();
  }, [user]);

  // Handle publish/unpublish recording
  const handleTogglePublish = async (archiveId: string, currentlyPublic: boolean) => {
    if (!user) return;

    setPublishingId(archiveId);
    try {
      const method = currentlyPublic ? 'DELETE' : 'POST';
      const res = await fetch('/api/recording/publish', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archiveId, userId: user.uid }),
      });

      if (!res.ok) {
        const data = await res.json();
        console.error('Failed to toggle publish:', data.error);
        return;
      }

      // Update local state
      setMyRecordings((prev) =>
        prev.map((rec) =>
          rec.id === archiveId
            ? { ...rec, isPublic: !currentlyPublic, publishedAt: !currentlyPublic ? Date.now() : undefined }
            : rec
        )
      );
    } catch (error) {
      console.error('Error toggling publish:', error);
    } finally {
      setPublishingId(null);
    }
  };

  // Sync DJ profile data to broadcast slots
  const syncProfileToSlots = useCallback(async (bio?: string | null, photoUrl?: string | null) => {
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
      // Sync to broadcast slots
      await syncProfileToSlots(newBio, undefined);
      setSaveAboutSuccess(true);
      setTimeout(() => setSaveAboutSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving about:", error);
    } finally {
      setSavingAbout(false);
    }
  }, [user, syncProfileToSlots]);

  // Auto-save bio with debounce
  useEffect(() => {
    if (initialLoadRef.current) return;

    if (bioDebounceRef.current) {
      clearTimeout(bioDebounceRef.current);
    }

    bioDebounceRef.current = setTimeout(() => {
      saveAbout(bioInput);
    }, 1000);

    return () => {
      if (bioDebounceRef.current) {
        clearTimeout(bioDebounceRef.current);
      }
    };
  }, [bioInput, saveAbout]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !db) return;

    setPhotoError(null);

    // Validate before upload
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

      // Save URL to Firestore
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        "djProfile.photoUrl": result.url,
      });

      // Sync to broadcast slots
      await syncProfileToSlots(undefined, result.url);

      // Sync photo to collectives/venues
      fetch('/api/dj-profile/sync-photo-refs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, photoUrl: result.url }),
      }).catch(e => console.error("Error syncing photo refs:", e));
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
      // Delete from Storage
      await deleteDJPhoto(user.uid, djProfile.photoUrl);

      // Remove URL from Firestore
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        "djProfile.photoUrl": null,
      });

      // Sync to broadcast slots
      await syncProfileToSlots(undefined, null);

      // Sync photo removal to collectives/venues
      fetch('/api/dj-profile/sync-photo-refs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, photoUrl: null }),
      }).catch(e => console.error("Error syncing photo refs:", e));
    } catch (error) {
      console.error("Error removing photo:", error);
      setPhotoError('Failed to remove photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    return `${mins}m`;
  };

  const formatRecordingDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
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

  // Handle upgrade to DJ for logged-in non-DJ users
  const handleUpgradeToDJ = async () => {
    if (!user || !agreedToDJTerms) {
      setUpgradeError("Please accept the DJ Terms to continue");
      return;
    }

    setUpgradingToDJ(true);
    setUpgradeError("");

    try {
      const response = await fetch("/api/users/assign-dj-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });

      if (!response.ok) {
        throw new Error("Failed to upgrade to DJ");
      }

      // Force page reload to get updated role
      window.location.reload();
    } catch (error) {
      console.error("Failed to upgrade to DJ:", error);
      setUpgradeError("Failed to upgrade. Please try again.");
    } finally {
      setUpgradingToDJ(false);
    }
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
        <Header position="sticky" showSearch />
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
          includeDjTerms={true}
        />
      </div>
    );
  }

  // Not a DJ - show upgrade option
  if (!isDJ(role)) {
    return (
      <div className="min-h-screen bg-black">
        <Header position="sticky" showSearch />
        <main className="max-w-xl mx-auto p-4">
          <div className="py-8">
            <h1 className="text-2xl font-semibold text-white mb-2">Upgrade to DJ Profile</h1>
            <p className="text-gray-400 mb-6">
              You&apos;re logged in as {user?.email}. Accept the DJ Terms to unlock your DJ profile and start broadcasting on Channel.
            </p>

            <div className="bg-[#1a1a1a] rounded-lg p-6">
              <label className="flex items-start gap-3 cursor-pointer mb-4">
                <input
                  type="checkbox"
                  checked={agreedToDJTerms}
                  onChange={(e) => setAgreedToDJTerms(e.target.checked)}
                  className="mt-1 w-5 h-5 rounded border-gray-600 bg-gray-800 text-white focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-sm text-gray-300">
                  I have read and agree to the{" "}
                  <Link
                    href="/dj-terms"
                    target="_blank"
                    className="text-white underline hover:text-gray-300"
                  >
                    DJ Terms
                  </Link>
                </span>
              </label>

              {upgradeError && (
                <p className="text-red-400 text-sm mb-4">{upgradeError}</p>
              )}

              <button
                onClick={handleUpgradeToDJ}
                disabled={!agreedToDJTerms || upgradingToDJ}
                className="bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {upgradingToDJ ? (
                  <>
                    <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    Upgrading...
                  </>
                ) : (
                  "Upgrade to DJ"
                )}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <Header position="sticky" showSearch />

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
            </div>
          </section>

          {/* Profile Photo section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Profile Photo
            </h2>
            <div className="bg-[#1a1a1a] rounded-lg p-4">
              <div className="flex items-center gap-4">
                {/* Photo preview */}
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

                {/* Upload/Remove buttons */}
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

              {/* Error message */}
              {photoError && (
                <p className="text-red-400 text-sm mt-3">{photoError}</p>
              )}
            </div>
            <p className="text-gray-600 text-xs mt-2 px-1">
              JPG, PNG, GIF, or WebP. Max 5MB. Appears during your live broadcasts.
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
            <p className="text-gray-600 text-xs mt-2 px-1">
              Your bio appears on your DJ profile during broadcasts.
            </p>
          </section>

          {/* Upcoming Broadcasts section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Upcoming Broadcasts
            </h2>
            <div className="bg-[#1a1a1a] rounded-lg">
              {loadingBroadcasts ? (
                <div className="p-4 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
                </div>
              ) : upcomingBroadcasts.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="text-gray-500">No upcoming broadcasts scheduled</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {upcomingBroadcasts.map((broadcast) => (
                    <div key={broadcast.id} className="p-4">
                      <p className="text-white font-medium">{broadcast.showName}</p>
                      <p className="text-gray-400 text-sm">
                        {formatBroadcastTime(broadcast.startTime, broadcast.endTime)}
                      </p>
                      {broadcast.djEmail && (
                        <p className="text-gray-500 text-xs mt-1">
                          DJ: {broadcast.djEmail}
                        </p>
                      )}
                      {broadcast.status === "live" ? (
                        <span className="inline-flex items-center gap-1.5 mt-2 text-red-400 text-xs">
                          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                          <span className="font-bold uppercase">Live</span>
                          {broadcastBPM && (
                            <span className="text-[10px] font-mono text-red-500 uppercase tracking-tighter">
                              {broadcastBPM} BPM
                            </span>
                          )}
                        </span>
                      ) : broadcast.broadcastToken && (
                        <Link
                          href={`/broadcast/live?token=${broadcast.broadcastToken}`}
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

          {/* My Recordings section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-gray-500 text-xs uppercase tracking-wide">
                My Recordings
              </h2>
              <Link
                href="/record"
                className="text-blue-400 hover:text-blue-300 text-xs transition-colors"
              >
                Record New &rarr;
              </Link>
            </div>
            <div className="bg-[#1a1a1a] rounded-lg">
              {loadingRecordings ? (
                <div className="p-4 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
                </div>
              ) : myRecordings.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="text-gray-500 mb-3">No recordings yet</p>
                  <Link
                    href="/record"
                    className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" strokeWidth={2} />
                      <circle cx="12" cy="12" r="4" fill="currentColor" />
                    </svg>
                    Start Recording
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {myRecordings.map((recording) => (
                    <div key={recording.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-medium truncate">{recording.showName}</p>
                          <p className="text-gray-400 text-sm">
                            {formatRecordingDate(recording.recordedAt)} · {formatDuration(recording.duration)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* Publish toggle */}
                          <button
                            onClick={() => handleTogglePublish(recording.id, recording.isPublic === true)}
                            disabled={publishingId === recording.id}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              recording.isPublic
                                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            } disabled:opacity-50`}
                          >
                            {publishingId === recording.id ? (
                              <span className="flex items-center gap-1">
                                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                              </span>
                            ) : recording.isPublic ? (
                              'Published'
                            ) : (
                              'Publish'
                            )}
                          </button>
                          {/* Play link */}
                          <Link
                            href={`/archive/${recording.slug}`}
                            className="p-1.5 text-gray-400 hover:text-white transition-colors"
                            title="Play recording"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </Link>
                        </div>
                      </div>
                      {/* Status indicator */}
                      {recording.isPublic && (
                        <p className="text-green-400/70 text-xs mt-2">
                          Visible on your public profile
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-gray-600 text-xs mt-2 px-1">
              Recordings are private until published. Published recordings appear on your DJ profile.
            </p>
          </section>

          {/* Payments section */}
        </div>
      </main>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  );
}
