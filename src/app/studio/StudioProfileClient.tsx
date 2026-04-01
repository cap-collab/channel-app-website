"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { doc, onSnapshot, updateDoc, collection, query, where, orderBy, Timestamp, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { useSchedule } from "@/contexts/ScheduleContext";
import { useUserRole, isDJ } from "@/hooks/useUserRole";
import { AuthModal } from "@/components/AuthModal";
import { Header } from "@/components/Header";
import { normalizeUrl } from "@/lib/url";
import { uploadDJPhoto, deleteDJPhoto, validatePhoto, uploadRecImage, uploadEventPhoto } from "@/lib/photo-upload";
import { wordBoundaryMatch } from "@/lib/dj-matching";
import { getStationById } from "@/lib/stations";

// Word boundary matching for DJ/show names
// e.g. "PAC" matches "PAC" or "Night PAC" but NOT "pace" or "space"
function containsMatch(text: string, term: string): boolean {
  return wordBoundaryMatch(text, term);
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

interface DJEvent {
  id?: string; // undefined = new event, string = existing event
  name: string;
  date: string; // YYYY-MM-DD for form input
  location: string;
  ticketLink: string;
  photo: string | null;
  linkedVenues: { venueId: string; venueName: string }[];
  linkedCollectives: { collectiveId: string; collectiveName: string }[];
  djs: { djName: string; djUserId?: string; djUsername?: string; djPhotoUrl?: string }[];
  saving?: boolean;
}

interface RadioShow {
  name: string;
  radioName: string;
  url: string;
  date: string;
  time: string;
  duration: string; // in hours, e.g. "1", "1.5", "2"
  timezone?: string; // IANA timezone the time was entered in
  addedAt?: string;
}

interface DJProfile {
  bio: string | null;
  tipButtonLink: string | null;
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
  radioShows?: RadioShow[];
  myRecs?: RecItem[];
}

interface RecItem {
  type: 'music' | 'irl' | 'online';
  title: string;
  url: string;
  imageUrl?: string;
  addedAt?: string;
}

export function StudioProfileClient() {
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // DJ upgrade state
  const [agreedToDJTerms, setAgreedToDJTerms] = useState(false);
  const [upgradingToDJ, setUpgradingToDJ] = useState(false);
  const [upgradeError, setUpgradeError] = useState("");

  // Track when inline sign-in flow completes (role assignment done)
  const [signInFlowComplete, setSignInFlowComplete] = useState(false);
  // Keep showing inline auth UI until sign-in flow is fully done
  const [signingInInline, setSigningInInline] = useState(false);

  // If user signed in via the inline AuthModal with DJ terms,
  // we know they have the DJ role — skip the upgrade screen while role propagates
  const djTermsJustAccepted = signInFlowComplete || (typeof window !== 'undefined' && sessionStorage.getItem('djTermsJustAccepted') === 'true');
  // Clear the flag once role is confirmed
  useEffect(() => {
    if (isDJ(role) && typeof window !== 'undefined') {
      sessionStorage.removeItem('djTermsJustAccepted');
      setSignInFlowComplete(false);
      setSigningInInline(false);
    }
  }, [role]);

  // Safety: if stuck on loading screen for >5s, reload to re-fetch role
  // This handles edge cases where onSnapshot misses the role update
  useEffect(() => {
    if (!isDJ(role) && djTermsJustAccepted && isAuthenticated) {
      const timer = setTimeout(() => {
        window.location.reload();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [role, djTermsJustAccepted, isAuthenticated]);


  // Profile data
  const [chatUsername, setChatUsername] = useState<string | null>(null);
  const [djProfile, setDjProfile] = useState<DJProfile>({
    bio: null,
    tipButtonLink: null,
    photoUrl: null,
    location: null,
    genres: [],
    socialLinks: {},
    radioShows: [],
    myRecs: [],
  });

  // Photo upload state
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

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

  // Form state - IRL Events section
  const [djEvents, setDjEvents] = useState<DJEvent[]>([]);
  const [loadingDjEvents, setLoadingDjEvents] = useState(true);
  const [newEvent, setNewEvent] = useState<DJEvent>({ name: "", date: "", location: "", ticketLink: "", photo: null, linkedVenues: [], linkedCollectives: [], djs: [] });
  const [showNewEventForm, setShowNewEventForm] = useState(false);
  const [savingNewEvent, setSavingNewEvent] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [uploadingEventPhoto, setUploadingEventPhoto] = useState(false);
  const [venueOptions, setVenueOptions] = useState<{ id: string; name: string }[]>([]);
  const [collectiveOptions, setCollectiveOptions] = useState<{ id: string; name: string }[]>([]);
  const [djOptions, setDjOptions] = useState<{ label: string; djName: string; djUserId?: string; djUsername?: string; djPhotoUrl?: string }[]>([]);

  // Form state - Radio Shows section
  const [radioShowsInput, setRadioShowsInput] = useState<RadioShow[]>([{ name: "", radioName: "", url: "", date: "", time: "", duration: "1" }, { name: "", radioName: "", url: "", date: "", time: "", duration: "1" }]);
  const [savingRadioShows, setSavingRadioShows] = useState(false);
  const [saveRadioShowsSuccess, setSaveRadioShowsSuccess] = useState(false);

  // Form state - My Recs section
  const [recsInput, setRecsInput] = useState<RecItem[]>([{ type: "music", title: "", url: "" }]);
  const [savingMyRecs, setSavingMyRecs] = useState(false);
  const [saveMyRecsSuccess, setSaveMyRecsSuccess] = useState(false);
  const [uploadingRecImage, setUploadingRecImage] = useState<number | null>(null);

  // Form state - Support Button Link
  const [tipButtonLinkInput, setTipButtonLinkInput] = useState("");
  const [savingTipButtonLink, setSavingTipButtonLink] = useState(false);
  const [saveTipButtonLinkSuccess, setSaveTipButtonLinkSuccess] = useState(false);

  // DJ Name setup state (for users without a chat username)
  const [djNameInput, setDjNameInput] = useState("");
  const [djNameAvailable, setDjNameAvailable] = useState<boolean | null>(null);
  const [djNameError, setDjNameError] = useState<string | null>(null);
  const [checkingDjName, setCheckingDjName] = useState(false);
  const [savingDjName, setSavingDjName] = useState(false);

  // Upcoming shows (broadcasts + external radio shows)
  const [upcomingShows, setUpcomingShows] = useState<UpcomingShow[]>([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(true);
  const { shows: allShows } = useSchedule();

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
    sourceType?: string;
    source?: 'archive' | 'session'; // which collection this came from
  }
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(true);
  const [publishingRecording, setPublishingRecording] = useState<string | null>(null);
  const [deletingRecording, setDeletingRecording] = useState<string | null>(null);
  const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);
  const [recordingCurrentTime, setRecordingCurrentTime] = useState<Record<string, number>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  // Pre-recording upload state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadShowName, setUploadShowName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDuration, setUploadDuration] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [detectingDuration, setDetectingDuration] = useState(false);
  const [uploadQuotaRemaining, setUploadQuotaRemaining] = useState<number | null>(null);
  const [uploadTermsConfirmed, setUploadTermsConfirmed] = useState(false);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // Detect audio file duration
  const detectAudioDuration = useCallback((file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      const objectUrl = URL.createObjectURL(file);
      audio.src = objectUrl;

      const cleanup = () => URL.revokeObjectURL(objectUrl);

      audio.onloadedmetadata = () => {
        if (audio.duration === Infinity || isNaN(audio.duration)) {
          // Some browsers report Infinity for WAV — seek to force duration calculation
          audio.currentTime = Number.MAX_SAFE_INTEGER;
          audio.ontimeupdate = () => {
            audio.ontimeupdate = null;
            cleanup();
            resolve(Math.ceil(audio.duration));
            audio.currentTime = 0;
          };
        } else {
          cleanup();
          resolve(Math.ceil(audio.duration));
        }
      };

      audio.onerror = () => {
        cleanup();
        reject(new Error('Could not read this audio file. Please try a different format.'));
      };

      // Timeout after 10 seconds
      setTimeout(() => {
        cleanup();
        reject(new Error('Could not read this audio file. Please try a different format.'));
      }, 10000);
    });
  }, []);

  // Handle file selection for upload
  const handleUploadFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError('');
    setUploadFile(file);
    setUploadDuration(null);

    // Validate file size
    if (file.size > 500 * 1024 * 1024) {
      setUploadError('File is too large. Maximum size is 500MB.');
      return;
    }

    // Detect duration
    setDetectingDuration(true);
    try {
      const duration = await detectAudioDuration(file);
      setUploadDuration(duration);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Could not read this audio file. Please try a different format.');
      setUploadFile(null);
    } finally {
      setDetectingDuration(false);
    }
  }, [detectAudioDuration]);

  // Handle upload submission
  const handleUpload = useCallback(async () => {
    if (!user || !uploadFile || !uploadDuration || !uploadShowName.trim()) return;

    setUploading(true);
    setUploadError('');
    setUploadProgress(0);

    try {
      // Step 1: Initiate upload — get presigned URL and create broadcast slot
      const initRes = await fetch('/api/recording/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          showName: uploadShowName.trim(),
          duration: uploadDuration,
          fileType: uploadFile.type,
          fileSize: uploadFile.size,
        }),
      });

      const initData = await initRes.json();

      if (!initRes.ok) {
        setUploadError(initData.error || 'Failed to start upload. Please try again.');
        setUploading(false);
        return;
      }

      const { presignedUrl, archiveId } = initData;

      // Step 2: Upload file directly to R2 via XHR (for progress tracking)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          xhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error('Upload failed — check your internet connection and try again.'));
          }
        };

        xhr.onerror = () => {
          xhrRef.current = null;
          reject(new Error('Upload failed — check your internet connection and try again.'));
        };

        xhr.ontimeout = () => {
          xhrRef.current = null;
          reject(new Error('Upload timed out. Please try again with a smaller file or faster connection.'));
        };

        xhr.open('PUT', presignedUrl);
        xhr.setRequestHeader('Content-Type', uploadFile.type);
        xhr.timeout = 900000; // 15 minutes
        xhr.send(uploadFile);
      });

      // Step 3: Complete upload — verify file and finalize archive
      const completeRes = await fetch('/api/recording/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archiveId, userId: user.uid }),
      });

      const completeData = await completeRes.json();

      if (!completeRes.ok) {
        setUploadError(completeData.error || 'Upload finished but we couldn\'t save it. Please try again or contact support.');
        setUploading(false);
        return;
      }

      // Success — close modal and reset state
      setShowUploadModal(false);
      setUploadShowName('');
      setUploadFile(null);
      setUploadDuration(null);
      setUploadProgress(0);
      setUploadError('');
      setUploadTermsConfirmed(false);
      // Recording will appear automatically via onSnapshot listener

    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [user, uploadFile, uploadDuration, uploadShowName]);

  // Close upload modal and reset state
  const closeUploadModal = useCallback(() => {
    if (uploading && xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setShowUploadModal(false);
    setUploadShowName('');
    setUploadFile(null);
    setUploadDuration(null);
    setUploadProgress(0);
    setUploadError('');
    setUploading(false);
    setUploadTermsConfirmed(false);
  }, [uploading]);

  // Fetch quota when upload modal opens
  useEffect(() => {
    if (!showUploadModal || !user) return;
    setUploadQuotaRemaining(null);
    fetch(`/api/recording/start?userId=${user.uid}`)
      .then(res => res.json())
      .then(data => {
        if (data.quota) {
          setUploadQuotaRemaining(data.quota.remainingSeconds);
        }
      })
      .catch(() => {});
  }, [showUploadModal, user]);

  // Auto-save debounce refs
  const bioDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const detailsDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const socialDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const radioShowsDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const myRecsDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const tipButtonLinkDebounceRef = useRef<NodeJS.Timeout | null>(null);
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
            tipButtonLink: data.djProfile.tipButtonLink || null,
            photoUrl: data.djProfile.photoUrl || null,
            location: data.djProfile.location || null,
            genres: data.djProfile.genres || [],
            socialLinks: data.djProfile.socialLinks || {},
            radioShows: data.djProfile.radioShows || [],
            myRecs: Array.isArray(data.djProfile.myRecs) ? data.djProfile.myRecs : [],
          });
          // Only set input values on initial load to avoid overwriting user edits
          if (initialLoadRef.current) {
            setBioInput(data.djProfile.bio || "");
            setTipButtonLinkInput(data.djProfile.tipButtonLink || "");
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
            // Radio Shows - load all saved shows plus one empty slot
            const radioShows = (data.djProfile.radioShows || []).map((s: Partial<RadioShow>) => ({ name: "", radioName: "", url: "", date: "", time: "", duration: "1", ...s }));
            setRadioShowsInput([...radioShows, { name: "", radioName: "", url: "", date: "", time: "", duration: "1" }]);
            // My Recs - migrate old format or load new format
            const rawRecs = data.djProfile.myRecs;
            if (Array.isArray(rawRecs) && rawRecs.length > 0) {
              setRecsInput(rawRecs);
            } else if (rawRecs && !Array.isArray(rawRecs)) {
              // Backward compat: migrate old bandcampLinks/eventLinks format
              const migrated: RecItem[] = [];
              for (const url of (rawRecs.bandcampLinks || [])) {
                if (url) migrated.push({ type: "music", title: "", url });
              }
              for (const url of (rawRecs.eventLinks || [])) {
                if (url) migrated.push({ type: "irl", title: "", url });
              }
              setRecsInput(migrated.length > 0 ? migrated : [{ type: "music", title: "", url: "" }]);
            } else {
              setRecsInput([{ type: "music", title: "", url: "" }]);
            }
            initialLoadRef.current = false;
          }
        }
      }
    });

    return () => unsubscribe();
  }, [user]);


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
              stationName: "Channel Radio",
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

  // Load my recordings from archives collection + fallback to studio-sessions
  // Studio-sessions may have recordings that never got an archive doc (e.g. webhook failed)
  useEffect(() => {
    if (!user || !db) {
      setLoadingRecordings(false);
      return;
    }

    let archiveRecs: Recording[] = [];
    let sessionRecs: Recording[] = [];
    let archiveSlotIds = new Set<string>();
    let archivesLoaded = false;
    let sessionsLoaded = false;

    const mergeAndSet = () => {
      if (!archivesLoaded || !sessionsLoaded) return;
      // Deduplicate: only include studio-sessions that don't already have an archive
      const filtered = sessionRecs.filter(r => !archiveSlotIds.has(r.id));
      const merged = [...archiveRecs, ...filtered];
      merged.sort((a, b) => b.createdAt - a.createdAt);
      setRecordings(merged);
      setLoadingRecordings(false);
    };

    // Query 1: archives collection (primary source)
    const archivesQ = query(
      collection(db, "archives"),
      where("sourceType", "==", "recording"),
      where("uploadedBy", "==", user.uid)
    );

    const unsubArchives = onSnapshot(
      archivesQ,
      (snapshot) => {
        archiveRecs = [];
        archiveSlotIds = new Set();
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.uploadStatus === 'uploading') return;
          if (data.broadcastSlotId) archiveSlotIds.add(data.broadcastSlotId);
          archiveRecs.push({
            id: docSnap.id,
            showName: data.showName || 'Untitled Recording',
            djName: data.djs?.[0]?.name,
            createdAt: data.recordedAt || data.createdAt || Date.now(),
            duration: data.duration || 0,
            isPublic: data.isPublic !== false,
            slug: data.slug || docSnap.id,
            audioUrl: data.recordingUrl,
            sourceType: data.sourceType,
            source: 'archive',
          });
        });
        archivesLoaded = true;
        mergeAndSet();
      },
      (err) => {
        console.error("Error loading archives:", err);
        archivesLoaded = true;
        mergeAndSet();
      }
    );

    // Query 2: studio-sessions fallback (catches recordings without archive docs)
    const sessionsQ = query(
      collection(db, "studio-sessions"),
      where("broadcastType", "==", "recording"),
      where("djUserId", "==", user.uid)
    );

    const unsubSessions = onSnapshot(
      sessionsQ,
      (snapshot) => {
        sessionRecs = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          // Only include sessions that have a ready recording
          const readyRecording = data.recordings?.find((r: { status: string; url?: string }) => r.status === 'ready' && r.url);
          const audioUrl = data.recordingUrl || readyRecording?.url;
          if (!audioUrl) return;
          const startTime = data.startTime;
          const createdAt = startTime?.toMillis ? startTime.toMillis() : (startTime || Date.now());
          sessionRecs.push({
            id: docSnap.id,
            showName: data.showName || 'Untitled Recording',
            djName: data.liveDjUsername,
            createdAt,
            duration: data.recordingDuration || readyRecording?.duration || 0,
            isPublic: data.isPublic !== false,
            slug: docSnap.id,
            audioUrl,
            sourceType: 'recording',
            source: 'session',
          });
        });
        sessionsLoaded = true;
        mergeAndSet();
      },
      (err) => {
        console.error("Error loading studio sessions:", err);
        sessionsLoaded = true;
        mergeAndSet();
      }
    );

    return () => {
      unsubArchives();
      unsubSessions();
    };
  }, [user]);

  // Handle publish/unpublish recording
  const handlePublishRecording = useCallback(async (recordingId: string, publish: boolean) => {
    if (!user || !db) return;
    setPublishingRecording(recordingId);
    try {
      const { doc: firestoreDoc, updateDoc } = await import('firebase/firestore');
      const archiveRef = firestoreDoc(db, 'archives', recordingId);
      await updateDoc(archiveRef, {
        isPublic: publish,
        ...(publish ? { publishedAt: Date.now() } : { publishedAt: null }),
      });
    } catch (error) {
      console.error('Error updating recording:', error);
    } finally {
      setPublishingRecording(null);
    }
  }, [user, db]);

  // Handle delete recording
  const handleDeleteRecording = useCallback(async (recordingId: string) => {
    if (!user || !db) return;
    if (!confirm('Are you sure you want to delete this recording? This cannot be undone.')) {
      return;
    }
    setDeletingRecording(recordingId);
    try {
      const { doc: firestoreDoc, deleteDoc, getDoc } = await import('firebase/firestore');
      const rec = recordings.find(r => r.id === recordingId);

      if (rec?.source === 'session') {
        // This recording only exists in studio-sessions (no archive doc)
        const sessionRef = firestoreDoc(db, 'studio-sessions', recordingId);
        await deleteDoc(sessionRef);
      } else {
        // Delete from archives + associated studio-session
        const archiveRef = firestoreDoc(db, 'archives', recordingId);
        const archiveSnap = await getDoc(archiveRef);
        const sessionId = archiveSnap.data()?.broadcastSlotId;
        if (sessionId) {
          const sessionRef = firestoreDoc(db, 'studio-sessions', sessionId);
          await deleteDoc(sessionRef).catch(() => {}); // ignore if already deleted
        }
        await deleteDoc(archiveRef);
      }
    } catch (error) {
      console.error('Error deleting recording:', error);
    } finally {
      setDeletingRecording(null);
    }
  }, [user, db, recordings]);

  // Handle recording playback
  const handlePlayPauseRecording = useCallback((recordingId: string) => {
    const audio = audioRefs.current[recordingId];
    if (!audio) return;

    if (playingRecordingId === recordingId) {
      // Pause current recording
      audio.pause();
      setPlayingRecordingId(null);
    } else {
      // Pause any other playing recording
      if (playingRecordingId && audioRefs.current[playingRecordingId]) {
        audioRefs.current[playingRecordingId]?.pause();
      }
      // Play this recording
      audio.play();
      setPlayingRecordingId(recordingId);
    }
  }, [playingRecordingId]);

  const handleRecordingTimeUpdate = useCallback((recordingId: string) => {
    const audio = audioRefs.current[recordingId];
    if (audio) {
      setRecordingCurrentTime(prev => ({ ...prev, [recordingId]: audio.currentTime }));
    }
  }, []);

  const handleRecordingSeek = useCallback((recordingId: string, time: number) => {
    const audio = audioRefs.current[recordingId];
    if (audio) {
      audio.currentTime = time;
      setRecordingCurrentTime(prev => ({ ...prev, [recordingId]: time }));
    }
  }, []);

  const handleRecordingEnded = useCallback((recordingId: string) => {
    setPlayingRecordingId(null);
    setRecordingCurrentTime(prev => ({ ...prev, [recordingId]: 0 }));
  }, []);

  // Sync DJ profile data to broadcast slots
  const syncProfileToSlots = useCallback(async (updates: {
    bio?: string | null;
    photoUrl?: string | null;
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

      const normalizedBandcamp = bandcamp.trim() ? normalizeUrl(bandcamp.trim()) : null;
      const updateData: Record<string, unknown> = {
        "djProfile.socialLinks": {
          instagram: instagram.trim() || null,
          soundcloud: soundcloud.trim() ? normalizeUrl(soundcloud.trim()) : null,
          bandcamp: normalizedBandcamp,
          youtube: youtube.trim() ? normalizeUrl(youtube.trim()) : null,
          bookingEmail: bookingEmail.trim() || null,
          mixcloud: mixcloud.trim() ? normalizeUrl(mixcloud.trim()) : null,
          residentAdvisor: residentAdvisor.trim() ? normalizeUrl(residentAdvisor.trim()) : null,
          customLinks: validCustomLinks.length > 0 ? validCustomLinks : null,
        },
      };
      // Auto-populate tipButtonLink from bandcamp if tipButtonLink is currently empty
      if (normalizedBandcamp && !tipButtonLinkInput.trim()) {
        updateData["djProfile.tipButtonLink"] = normalizedBandcamp;
        setTipButtonLinkInput(normalizedBandcamp);
      }
      await updateDoc(userRef, updateData);
      setSaveSocialSuccess(true);
      setTimeout(() => setSaveSocialSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving social links:", error);
    } finally {
      setSavingSocial(false);
    }
  }, [user]);

  // Fetch venue, collective, and DJ options for event selectors
  const fetchEventOptions = useCallback(async () => {
    if (!db) return;
    try {
      const venuesSnap = await getDocs(collection(db, "venues"));
      const venues: { id: string; name: string }[] = [];
      venuesSnap.forEach((d) => venues.push({ id: d.id, name: d.data().name }));
      venues.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      setVenueOptions(venues);

      const collectivesSnap = await getDocs(collection(db, "collectives"));
      const collectives: { id: string; name: string }[] = [];
      collectivesSnap.forEach((d) => collectives.push({ id: d.id, name: d.data().name }));
      collectives.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      setCollectiveOptions(collectives);

      // Fetch DJs: pending profiles + registered DJ users
      const options: { label: string; djName: string; djUserId?: string; djUsername?: string; djPhotoUrl?: string }[] = [];
      const seenUsernames = new Set<string>();

      const pendingSnap = await getDocs(collection(db, "pending-dj-profiles"));
      pendingSnap.forEach((d) => {
        const data = d.data();
        if (data.status !== "pending") return;
        const username = data.chatUsernameNormalized || "";
        if (username) seenUsernames.add(username);
        options.push({
          label: data.chatUsername || data.chatUsernameNormalized || "Unknown",
          djName: data.chatUsername || data.chatUsernameNormalized || "Unknown",
          djUsername: data.chatUsernameNormalized,
          djPhotoUrl: data.djProfile?.photoUrl || undefined,
        });
      });

      const djQuery = query(collection(db, "users"), where("role", "in", ["dj", "broadcaster", "admin"]));
      const usersSnap = await getDocs(djQuery);
      usersSnap.forEach((d) => {
        const data = d.data();
        const username = data.chatUsernameNormalized || "";
        if (username && seenUsernames.has(username)) return;
        options.push({
          label: data.chatUsername || data.displayName || "Unknown",
          djName: data.chatUsername || data.displayName || "Unknown",
          djUserId: d.id,
          djUsername: data.chatUsernameNormalized || data.chatUsername,
          djPhotoUrl: data.djProfile?.photoUrl || undefined,
        });
      });

      options.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
      setDjOptions(options);
    } catch (err) {
      console.error("Error fetching event options:", err);
    }
  }, []);

  // Fetch DJ's events from events collection
  const fetchDjEvents = useCallback(async () => {
    if (!db || !user) return;
    setLoadingDjEvents(true);
    try {
      const eventsSnap = await getDocs(collection(db, "events"));
      const events: DJEvent[] = [];
      eventsSnap.forEach((d) => {
        const data = d.data();
        if (data.createdBy === user.uid) {
          const dateObj = new Date(data.date);
          const dateStr = dateObj.toISOString().split("T")[0];
          events.push({
            id: d.id,
            name: data.name || "",
            date: dateStr,
            location: data.location || "",
            ticketLink: data.ticketLink || "",
            photo: data.photo || null,
            linkedVenues: data.linkedVenues || [],
            linkedCollectives: data.linkedCollectives || [],
            djs: data.djs || [],
          });
        }
      });
      events.sort((a, b) => a.date.localeCompare(b.date));
      setDjEvents(events);
    } catch (err) {
      console.error("Error fetching DJ events:", err);
    } finally {
      setLoadingDjEvents(false);
    }
  }, [user]);

  useEffect(() => {
    if (isDJ(role)) {
      fetchEventOptions();
      fetchDjEvents();
    }
  }, [role, fetchEventOptions, fetchDjEvents]);

  // Handle event photo upload for new event form
  const handleEventPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const validation = validatePhoto(file);
    if (!validation.valid) return;

    setUploadingEventPhoto(true);
    try {
      const tempId = `temp-${user.uid}-${Date.now()}`;
      const result = await uploadEventPhoto(tempId, file);
      if (result.success && result.url) {
        setNewEvent(prev => ({ ...prev, photo: result.url! }));
      }
    } catch (err) {
      console.error("Error uploading event photo:", err);
    } finally {
      setUploadingEventPhoto(false);
    }
  };

  // Create a new event via API
  const createEvent = async () => {
    if (!user || !newEvent.name.trim()) return;

    setSavingNewEvent(true);
    setEventError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newEvent.name.trim(),
          date: newEvent.date || undefined,
          location: newEvent.location.trim() || undefined,
          ticketLink: newEvent.ticketLink.trim() ? normalizeUrl(newEvent.ticketLink.trim()) : undefined,
          photo: newEvent.photo || undefined,
          linkedVenues: newEvent.linkedVenues.length > 0 ? newEvent.linkedVenues : undefined,
          linkedCollectives: newEvent.linkedCollectives.length > 0 ? newEvent.linkedCollectives : undefined,
          djs: newEvent.djs.filter(d => d.djName.trim()).length > 0 ? newEvent.djs.filter(d => d.djName.trim()) : undefined,
        }),
      });

      if (response.ok) {
        setNewEvent({ name: "", date: "", location: "", ticketLink: "", photo: null, linkedVenues: [], linkedCollectives: [], djs: [] });
        setShowNewEventForm(false);
        await fetchDjEvents();
      } else {
        const result = await response.json();
        setEventError(result.error || "Failed to create event");
      }
    } catch (err) {
      console.error("Error creating event:", err);
      setEventError("Failed to create event. Please try again.");
    } finally {
      setSavingNewEvent(false);
    }
  };

  // Start editing an existing event
  const startEditingEvent = (event: DJEvent) => {
    setEditingEventId(event.id || null);
    setNewEvent({ ...event });
    setShowNewEventForm(true);
    setEventError(null);
  };

  // Update an existing event via API
  const updateEvent = async () => {
    if (!user || !editingEventId || !newEvent.name.trim()) return;

    setSavingNewEvent(true);
    setEventError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/events", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          eventId: editingEventId,
          name: newEvent.name.trim(),
          date: newEvent.date || undefined,
          location: newEvent.location.trim() || null,
          ticketLink: newEvent.ticketLink.trim() ? normalizeUrl(newEvent.ticketLink.trim()) : null,
          photo: newEvent.photo || null,
          linkedVenues: newEvent.linkedVenues,
          linkedCollectives: newEvent.linkedCollectives,
          djs: newEvent.djs.filter(d => d.djName.trim()),
        }),
      });

      if (response.ok) {
        setNewEvent({ name: "", date: "", location: "", ticketLink: "", photo: null, linkedVenues: [], linkedCollectives: [], djs: [] });
        setShowNewEventForm(false);
        setEditingEventId(null);
        await fetchDjEvents();
      } else {
        const result = await response.json();
        setEventError(result.error || "Failed to update event");
      }
    } catch (err) {
      console.error("Error updating event:", err);
      setEventError("Failed to update event. Please try again.");
    } finally {
      setSavingNewEvent(false);
    }
  };

  // Delete an event via API
  const deleteEvent = async (eventId: string) => {
    if (!user) return;

    setDeletingEventId(eventId);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/events?eventId=${eventId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` },
      });

      if (response.ok) {
        setDjEvents(prev => prev.filter(e => e.id !== eventId));
      }
    } catch (err) {
      console.error("Error deleting event:", err);
    } finally {
      setDeletingEventId(null);
    }
  };

  const saveRadioShows = useCallback(async (shows: RadioShow[]) => {
    if (!user || !db) return;

    setSavingRadioShows(true);
    setSaveRadioShowsSuccess(false);

    // Capture the user's timezone when saving
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    try {
      const userRef = doc(db, "users", user.uid);
      // Filter out empty shows but always save the array structure
      const previousShows = (djProfile.radioShows || []) as RadioShow[];
      const validShows = shows.filter(
        (show) => (show.url || "").trim() || (show.date || "").trim() || (show.name || "").trim() || (show.radioName || "").trim()
      ).map((show) => {
        const name = (show.name || "").trim();
        const radioName = (show.radioName || "").trim();
        const date = (show.date || "").trim();
        // Preserve addedAt if this item existed before, otherwise set new timestamp
        const existingMatch = previousShows.find(
          (prev) => prev.name === name && prev.radioName === radioName && prev.date === date
        );
        return {
          name,
          radioName,
          url: (show.url || "").trim() ? normalizeUrl((show.url || "").trim()) : "",
          date,
          time: (show.time || "").trim(),
          duration: (show.duration || "1").trim(),
          timezone: userTimezone, // Store the timezone the time was entered in
          addedAt: existingMatch?.addedAt || show.addedAt || new Date().toISOString(),
        };
      });

      await updateDoc(userRef, {
        "djProfile.radioShows": validShows,
      });
      setSaveRadioShowsSuccess(true);
      setTimeout(() => setSaveRadioShowsSuccess(false), 2000);

      // Sync radio shows to followers (always call, even with 0 shows, to clean up deleted ones)
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
            previousIrlShows: [],
            previousRadioShows: djProfile.radioShows || [],
          }),
        });
      } catch (syncError) {
        console.error("Failed to sync radio shows to followers:", syncError);
      }
    } catch (error) {
      console.error("Error saving radio shows:", error);
    } finally {
      setSavingRadioShows(false);
    }
  }, [user, chatUsername, djProfile.photoUrl, djProfile.radioShows]);

  const saveMyRecs = useCallback(async (recs: RecItem[]) => {
    if (!user || !db) return;

    setSavingMyRecs(true);
    setSaveMyRecsSuccess(false);

    try {
      const userRef = doc(db, "users", user.uid);
      // Filter out recs with no title and no URL, normalize URLs
      const previousRecs = (djProfile.myRecs || []) as RecItem[];
      const validRecs = recs
        .filter((rec) => rec.title.trim() || rec.url.trim())
        .map((rec) => {
          const url = rec.url.trim() ? normalizeUrl(rec.url.trim()) : "";
          // Preserve addedAt if this rec existed before, otherwise set new timestamp
          const existingMatch = Array.isArray(previousRecs)
            ? previousRecs.find((prev) => prev.url === url)
            : undefined;
          return {
            type: rec.type,
            title: rec.title.trim(),
            url,
            ...(rec.imageUrl ? { imageUrl: rec.imageUrl } : {}),
            addedAt: existingMatch?.addedAt || rec.addedAt || new Date().toISOString(),
          };
        });

      await updateDoc(userRef, {
        "djProfile.myRecs": validRecs.length > 0 ? validRecs : null,
      });
      setSaveMyRecsSuccess(true);
      setTimeout(() => setSaveMyRecsSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving my recs:", error);
    } finally {
      setSavingMyRecs(false);
    }
  }, [user, djProfile.myRecs]);

  // Auto-save bio with debounce
  useEffect(() => {
    if (initialLoadRef.current) return;
    if (bioDebounceRef.current) clearTimeout(bioDebounceRef.current);
    bioDebounceRef.current = setTimeout(() => saveAbout(bioInput), 1000);
    return () => { if (bioDebounceRef.current) clearTimeout(bioDebounceRef.current); };
  }, [bioInput, saveAbout]);

  // Save tip button link
  const saveTipButtonLink = useCallback(async (link: string) => {
    if (!user || !db) return;
    setSavingTipButtonLink(true);
    setSaveTipButtonLinkSuccess(false);
    try {
      const userRef = doc(db, "users", user.uid);
      const newLink = link.trim() ? normalizeUrl(link.trim()) : null;
      await updateDoc(userRef, { "djProfile.tipButtonLink": newLink });
      setSaveTipButtonLinkSuccess(true);
      setTimeout(() => setSaveTipButtonLinkSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving tip button link:", error);
    } finally {
      setSavingTipButtonLink(false);
    }
  }, [user]);

  // Auto-save tip button link with debounce
  useEffect(() => {
    if (initialLoadRef.current) return;
    if (tipButtonLinkDebounceRef.current) clearTimeout(tipButtonLinkDebounceRef.current);
    tipButtonLinkDebounceRef.current = setTimeout(() => saveTipButtonLink(tipButtonLinkInput), 1000);
    return () => { if (tipButtonLinkDebounceRef.current) clearTimeout(tipButtonLinkDebounceRef.current); };
  }, [tipButtonLinkInput, saveTipButtonLink]);

  // Auto-save details with debounce
  useEffect(() => {
    if (initialLoadRef.current) return;
    if (detailsDebounceRef.current) clearTimeout(detailsDebounceRef.current);
    detailsDebounceRef.current = setTimeout(() => saveDetails(locationInput, genresInput), 1000);
    return () => { if (detailsDebounceRef.current) clearTimeout(detailsDebounceRef.current); };
  }, [locationInput, genresInput, saveDetails]);

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
    myRecsDebounceRef.current = setTimeout(() => saveMyRecs(recsInput), 1000);
    return () => { if (myRecsDebounceRef.current) clearTimeout(myRecsDebounceRef.current); };
  }, [recsInput, saveMyRecs]);

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
      await deleteDJPhoto(user.uid, djProfile.photoUrl);

      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        "djProfile.photoUrl": null,
      });

      await syncProfileToSlots({ photoUrl: null });

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
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatRecordingDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

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

      window.location.reload();
    } catch (error) {
      console.error("Failed to upgrade to DJ:", error);
      setUpgradeError("Failed to upgrade. Please try again.");
    } finally {
      setUpgradingToDJ(false);
    }
  };

  if ((authLoading || roleLoading) && !signingInInline) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  // Not authenticated, or sign-in is in progress (keep AuthModal mounted until flow completes)
  if (!isAuthenticated || (signingInInline && !signInFlowComplete)) {
    return (
      <div className="min-h-screen bg-black">
        <Header currentPage="studio" position="sticky" showSearch />
        <main className="max-w-xl mx-auto p-4">
          <div className="text-center py-12">
            <h1 className="text-2xl font-semibold text-white mb-2">Studio</h1>
            <p className="text-gray-400 mb-8">
              {signingInInline ? 'Setting up your account...' : 'Sign in to access your DJ profile'}
            </p>
            <div className="max-w-sm mx-auto">
              <AuthModal
                isOpen={true}
                onClose={() => {}}
                inline
                includeDjTerms
                onSignInStart={() => setSigningInInline(true)}
                onSignInComplete={() => setSignInFlowComplete(true)}
              />
            </div>
          </div>
        </main>
      </div>
    );
  }

  // DJ terms just accepted via inline sign-in — show loading while role propagates
  if (!isDJ(role) && djTermsJustAccepted) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Building your DJ profile...</p>
        </div>
      </div>
    );
  }

  // Not a DJ - show upgrade option
  if (!isDJ(role)) {
    return (
      <div className="min-h-screen bg-black">
        <Header currentPage="studio" position="sticky" showSearch />
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
      <Header currentPage="studio" position="sticky" showSearch />

      <main className="max-w-xl mx-auto p-4">
        {/* Curator Name Setup Banner - shown when chatUsername is not set */}
        {!chatUsername && (
          <div className="mb-6 bg-gradient-to-r from-purple-900/50 to-blue-900/50 border border-purple-500/30 rounded p-4">
            <h2 className="text-white font-medium mb-1">Set Your Curator Name</h2>
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
                    className="w-full bg-black border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none"
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
                  className="bg-white text-black px-4 py-2 rounded font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            <div className="bg-[#1a1a1a] rounded divide-y divide-gray-800">
              <div className="p-4 flex items-center justify-between">
                <span className="text-gray-400">Curator Name</span>
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
              <button
                onClick={() => setShowUploadModal(true)}
                className="flex-1 block bg-white text-black text-center py-3 rounded font-medium hover:bg-gray-100 transition-colors"
              >
                Upload a pre-recording
              </button>
              <Link
                href="/record"
                className="flex-1 block bg-gray-800 text-white text-center py-3 rounded font-medium hover:bg-gray-700 transition-colors border border-gray-700"
              >
                Record a set
              </Link>
              <Link
                href="/studio/livestream"
                className="flex-1 block bg-gray-800 text-white text-center py-3 rounded font-medium hover:bg-gray-700 transition-colors border border-gray-700"
              >
                Host a live show
              </Link>
            </div>
          </section>

          {/* Upcoming shows on Channel */}
          {(loadingBroadcasts || upcomingShows.length > 0) && (
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Upcoming Shows on Channel
            </h2>
            <div className="bg-[#1a1a1a] rounded">
              {loadingBroadcasts ? (
                <div className="p-4 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
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
                        <div className="flex items-center gap-3 mt-2">
                          <span className="inline-flex items-center gap-1 text-red-400 text-xs">
                            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                            Live Now
                          </span>
                          {!show.isExternal && show.broadcastToken && (
                            <Link
                              href={`/broadcast/live?token=${show.broadcastToken}`}
                              className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm transition-colors"
                            >
                              Go to Studio &rarr;
                            </Link>
                          )}
                        </div>
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
          )}

          {/* My Recordings section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-1">
              My Recordings
            </h2>
            <p className="text-gray-600 text-xs mb-3 px-1">
              Manage your recorded sets. Publish them to your profile or delete them.
            </p>
            <div className="bg-[#1a1a1a] rounded">
              {loadingRecordings ? (
                <div className="p-4 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
                </div>
              ) : recordings.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="text-gray-500">No recordings yet</p>
                </div>
              ) : (
                <div className="space-y-2 p-2">
                  {recordings.map((recording) => (
                    <div key={recording.id} className="bg-[#252525] rounded p-3">
                      <div className="flex items-center gap-3">
                        {/* Play button */}
                        <button
                          onClick={() => handlePlayPauseRecording(recording.id)}
                          disabled={!recording.audioUrl}
                          className="w-10 h-10 rounded-full bg-white flex items-center justify-center hover:bg-gray-100 transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {playingRecordingId === recording.id ? (
                            <svg className="w-4 h-4 text-black" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-black ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          )}
                        </button>

                        {/* Content and progress */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="text-white font-semibold text-sm truncate">{recording.showName}</h3>
                              <p className="text-gray-500 text-xs">
                                {formatRecordingDate(recording.createdAt)} · {formatDuration(recording.duration)}
                                {recording.isPublic ? (
                                  <span className="text-green-400 ml-2">· Published</span>
                                ) : (
                                  <span className="text-gray-500 ml-2">· Private</span>
                                )}
                              </p>
                            </div>
                            {/* Action buttons */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {/* Publish/Unpublish button */}
                              <button
                                onClick={() => handlePublishRecording(recording.id, !recording.isPublic)}
                                disabled={publishingRecording === recording.id}
                                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all text-xs ${
                                  recording.isPublic
                                    ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                    : 'bg-white/10 hover:bg-white/20 text-white'
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                                title={recording.isPublic ? 'Unpublish' : 'Publish to profile'}
                              >
                                {publishingRecording === recording.id ? (
                                  <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                ) : recording.isPublic ? (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                )}
                              </button>

                              {/* Delete button — hidden for live broadcast recordings */}
                              {recording.sourceType !== 'live' && (
                              <button
                                onClick={() => handleDeleteRecording(recording.id)}
                                disabled={deletingRecording === recording.id}
                                className="w-7 h-7 rounded-full flex items-center justify-center transition-all text-xs bg-white/10 hover:bg-red-500/20 text-white hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Delete recording"
                              >
                                {deletingRecording === recording.id ? (
                                  <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                )}
                              </button>
                              )}
                            </div>
                          </div>
                          {/* Progress bar */}
                          <input
                            type="range"
                            min={0}
                            max={recording.duration || 100}
                            value={recordingCurrentTime[recording.id] || 0}
                            onChange={(e) => handleRecordingSeek(recording.id, parseFloat(e.target.value))}
                            className="w-full h-1 bg-gray-700 rounded-full appearance-none cursor-pointer mt-1.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                          />
                        </div>
                      </div>

                      {/* Hidden audio element */}
                      {recording.audioUrl && (
                        <audio
                          ref={(el) => { audioRefs.current[recording.id] = el; }}
                          src={recording.audioUrl}
                          preload="none"
                          onTimeUpdate={() => handleRecordingTimeUpdate(recording.id)}
                          onEnded={() => handleRecordingEnded(recording.id)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Profile Photo section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Profile Photo
            </h2>
            <div className="bg-[#1a1a1a] rounded p-4">
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
                        file:rounded file:border-0
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

          {/* Location & Genres section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
              Location & Genres
            </h2>
            <div className="bg-[#1a1a1a] rounded p-4 space-y-4">
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
                  className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Genre tags
                </label>
                <input
                  type="text"
                  value={genresInput}
                  onChange={(e) => setGenresInput(e.target.value)}
                  placeholder="e.g., House, Techno, Ambient"
                  className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
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

          {/* About section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-1">
              About
            </h2>
            <p className="text-gray-600 text-xs mb-3 px-1">
              Your bio appears on your public DJ profile and during broadcasts.
            </p>
            <div className="bg-[#1a1a1a] rounded p-4 space-y-4">
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
                  className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none resize-none"
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

          {/* Support Button Link section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-1">
              Support Button Link
            </h2>
            <p className="text-gray-600 text-xs mb-3 px-1">
              Where listeners go when they click Support. Falls back to your Bandcamp link.
            </p>
            <div className="bg-[#1a1a1a] rounded p-4 space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Link URL
                </label>
                <input
                  type="text"
                  value={tipButtonLinkInput}
                  onChange={(e) => setTipButtonLinkInput(e.target.value)}
                  placeholder="https://ko-fi.com/yourname"
                  className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
                <div className="flex justify-between items-center mt-1">
                  <span className="text-gray-600 text-xs">
                    {savingTipButtonLink ? "Saving..." : saveTipButtonLinkSuccess ? "Saved" : ""}
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
            <div className="bg-[#1a1a1a] rounded p-4 space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Instagram
                </label>
                <input
                  type="text"
                  value={instagramInput}
                  onChange={(e) => setInstagramInput(e.target.value)}
                  placeholder="@yourhandle"
                  className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
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
                  className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
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
                  className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
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
                  className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
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
                  className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
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
                  className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
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
                  className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
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
                        className="w-1/3 bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
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
                        className="flex-1 bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
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

          {/* IRL Events section */}
          <section>
            <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-1">
              IRL Events
            </h2>
            <p className="text-gray-600 text-xs mb-3 px-1">
              Promote your upcoming in-person gigs. Events appear on your profile, /radio, and linked venue/collective pages.
            </p>
            <div className="bg-[#1a1a1a] rounded p-4 space-y-3">
              {/* Existing events */}
              {loadingDjEvents ? (
                <div className="flex items-center justify-center py-4">
                  <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
                </div>
              ) : djEvents.length > 0 ? (
                djEvents.map((event) => (
                  <div key={event.id} className="flex items-start gap-3 p-3 bg-black rounded-lg">
                    {event.photo ? (
                      <Image src={event.photo} alt={event.name} width={48} height={48} className="w-12 h-12 object-cover rounded flex-shrink-0" unoptimized />
                    ) : (
                      <div className="w-12 h-12 bg-gray-900 rounded flex items-center justify-center flex-shrink-0 text-gray-600">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{event.name}</p>
                      <p className="text-gray-500 text-xs">
                        {event.date && new Date(event.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {event.location && ` · ${event.location}`}
                        {event.linkedVenues.length > 0 && ` · ${event.linkedVenues.map(v => v.venueName).join(", ")}`}
                      </p>
                      {event.djs.length > 0 && (
                        <p className="text-gray-600 text-xs mt-0.5">
                          with {event.djs.map(d => d.djName).join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <button type="button" onClick={() => startEditingEvent(event)} className="text-gray-500 hover:text-white text-xs transition-colors">Edit</button>
                      <button type="button" onClick={() => event.id && deleteEvent(event.id)} disabled={deletingEventId === event.id} className="text-gray-600 hover:text-red-400 text-xs transition-colors">
                        {deletingEventId === event.id ? "..." : "Delete"}
                      </button>
                    </div>
                  </div>
                ))
              ) : !showNewEventForm ? (
                <p className="text-gray-600 text-xs text-center py-2">No events yet.</p>
              ) : null}

              {/* New event form */}
              {showNewEventForm && (
                <div className="space-y-2 p-3 bg-black rounded-lg border border-gray-800">
                  {/* Photo upload */}
                  <div className="flex items-start gap-3">
                    <div className="relative w-14 h-14 bg-gray-900 rounded overflow-hidden flex-shrink-0">
                      {newEvent.photo ? (
                        <Image src={newEvent.photo} alt="Event flyer" fill className="object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-600">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      {uploadingEventPhoto && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="cursor-pointer bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded px-2.5 py-1 text-xs text-white transition-colors">
                        {newEvent.photo ? "Change" : "Upload flyer"}
                        <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={handleEventPhotoUpload} disabled={uploadingEventPhoto} className="hidden" />
                      </label>
                      {newEvent.photo && (
                        <button type="button" onClick={() => setNewEvent(prev => ({ ...prev, photo: null }))} className="text-red-400 hover:text-red-300 text-xs text-left">Remove</button>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={newEvent.name} onChange={(e) => setNewEvent(prev => ({ ...prev, name: e.target.value }))} placeholder="Event Name" className="flex-1 bg-[#1a1a1a] border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none" />
                    <input type="text" value={newEvent.location} onChange={(e) => setNewEvent(prev => ({ ...prev, location: e.target.value }))} placeholder="City" className="w-32 bg-[#1a1a1a] border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none" />
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={newEvent.ticketLink} onChange={(e) => setNewEvent(prev => ({ ...prev, ticketLink: e.target.value }))} placeholder="Ticket URL (e.g., ra.co/events/...)" className="flex-1 bg-[#1a1a1a] border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none" />
                    <input type="date" value={newEvent.date} onChange={(e) => setNewEvent(prev => ({ ...prev, date: e.target.value }))} className="w-36 bg-[#1a1a1a] border border-gray-800 rounded px-3 py-2 text-white focus:border-gray-600 focus:outline-none [color-scheme:dark]" />
                  </div>
                  {/* Venue selector */}
                  <select value={newEvent.linkedVenues[0]?.venueId || ""} onChange={(e) => { const vId = e.target.value; if (!vId) { setNewEvent(prev => ({ ...prev, linkedVenues: [] })); return; } const venue = venueOptions.find(v => v.id === vId); if (venue) setNewEvent(prev => ({ ...prev, linkedVenues: [{ venueId: venue.id, venueName: venue.name }] })); }} className="w-full bg-[#1a1a1a] border border-gray-800 rounded px-3 py-2 text-white focus:border-gray-600 focus:outline-none">
                    <option value="">Select a venue...</option>
                    {venueOptions.map((venue) => (<option key={venue.id} value={venue.id}>{venue.name}</option>))}
                  </select>
                  {/* Linked Collectives */}
                  <div>
                    {newEvent.linkedCollectives.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {newEvent.linkedCollectives.map((lc) => (
                          <span key={lc.collectiveId} className="inline-flex items-center gap-1 bg-[#1a1a1a] rounded px-2 py-1 text-xs text-white">
                            {lc.collectiveName}
                            <button type="button" onClick={() => setNewEvent(prev => ({ ...prev, linkedCollectives: prev.linkedCollectives.filter(c => c.collectiveId !== lc.collectiveId) }))} className="text-red-400 hover:text-red-300">&times;</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <select value="" onChange={(e) => { const cId = e.target.value; if (!cId) return; const coll = collectiveOptions.find(c => c.id === cId); if (!coll || newEvent.linkedCollectives.some(lc => lc.collectiveId === cId)) return; setNewEvent(prev => ({ ...prev, linkedCollectives: [...prev.linkedCollectives, { collectiveId: coll.id, collectiveName: coll.name }] })); }} className="w-full bg-[#1a1a1a] border border-gray-800 rounded px-3 py-2 text-white focus:border-gray-600 focus:outline-none">
                      <option value="">Add a collective...</option>
                      {collectiveOptions.filter(c => !newEvent.linkedCollectives.some(lc => lc.collectiveId === c.id)).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                    </select>
                  </div>
                  {/* Tagged DJs */}
                  <div>
                    {newEvent.djs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {newEvent.djs.map((dj, djIdx) => (
                          <span key={djIdx} className="inline-flex items-center gap-1 bg-[#1a1a1a] rounded px-2 py-1 text-xs text-white">
                            {dj.djName}{dj.djUsername ? ` @${dj.djUsername}` : ""}
                            <button type="button" onClick={() => setNewEvent(prev => ({ ...prev, djs: prev.djs.filter((_, j) => j !== djIdx) }))} className="text-red-400 hover:text-red-300">&times;</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <select value="" onChange={(e) => { const val = e.target.value; if (!val) return; if (val === "__manual__") { setNewEvent(prev => ({ ...prev, djs: [...prev.djs, { djName: "" }] })); return; } const option = djOptions.find(o => (o.djUsername || o.djName) === val); if (!option || newEvent.djs.some(d => (d.djUsername || d.djName) === (option.djUsername || option.djName))) return; setNewEvent(prev => ({ ...prev, djs: [...prev.djs, { djName: option.djName, djUserId: option.djUserId, djUsername: option.djUsername, djPhotoUrl: option.djPhotoUrl }] })); }} className="w-full bg-[#1a1a1a] border border-gray-800 rounded px-3 py-2 text-white focus:border-gray-600 focus:outline-none">
                      <option value="">Tag a DJ...</option>
                      {djOptions.filter(o => !newEvent.djs.some(d => (d.djUsername || d.djName) === (o.djUsername || o.djName))).map((o) => (<option key={o.djUsername || o.djName} value={o.djUsername || o.djName}>{o.label}</option>))}
                      <option value="__manual__">Other (type name)</option>
                    </select>
                  </div>
                  {/* Error display */}
                  {eventError && (
                    <p className="text-red-400 text-xs">{eventError}</p>
                  )}
                  {/* Action buttons */}
                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={editingEventId ? updateEvent : createEvent} disabled={savingNewEvent || !newEvent.name.trim()} className="px-4 py-2 bg-white text-black text-xs font-medium rounded hover:bg-gray-200 transition-colors disabled:opacity-50">
                      {savingNewEvent ? "Saving..." : editingEventId ? "Update Event" : "Create Event"}
                    </button>
                    <button type="button" onClick={() => { setShowNewEventForm(false); setEditingEventId(null); setEventError(null); setNewEvent({ name: "", date: "", location: "", ticketLink: "", photo: null, linkedVenues: [], linkedCollectives: [], djs: [] }); }} className="px-4 py-2 text-gray-400 hover:text-white text-xs transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {!showNewEventForm && (
                <button type="button" onClick={() => setShowNewEventForm(true)} className="text-gray-500 hover:text-white text-xs transition-colors">
                  + Add event
                </button>
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
            <div className="bg-[#1a1a1a] rounded p-4 space-y-4">
              {radioShowsInput.map((show, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-gray-400 text-sm">
                      Show {index + 1}
                    </label>
                    {(show.name || show.radioName || show.url || show.date) && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = radioShowsInput.filter((_, i) => i !== index);
                          if (updated.length === 0 || (updated[updated.length - 1].name || updated[updated.length - 1].radioName || updated[updated.length - 1].url || updated[updated.length - 1].date)) {
                            updated.push({ name: "", radioName: "", url: "", date: "", time: "", duration: "1" });
                          }
                          setRadioShowsInput(updated);
                        }}
                        className="text-gray-600 hover:text-red-400 text-xs transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
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
                      className="flex-1 bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
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
                      className="w-32 bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
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
                      className="flex-1 bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none [color-scheme:dark]"
                    />
                    <select
                      value={show.time}
                      onChange={(e) => {
                        const updated = [...radioShowsInput];
                        updated[index] = { ...updated[index], time: e.target.value };
                        setRadioShowsInput(updated);
                      }}
                      className="w-24 bg-black border border-gray-800 rounded px-2 py-2 text-white focus:border-gray-600 focus:outline-none"
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
                      className="w-20 bg-black border border-gray-800 rounded px-2 py-2 text-white focus:border-gray-600 focus:outline-none"
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
                    className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
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
              <button
                type="button"
                onClick={() => setRadioShowsInput([...radioShowsInput, { name: "", radioName: "", url: "", date: "", time: "", duration: "1" }])}
                className="text-gray-500 hover:text-white text-xs transition-colors"
              >
                + Add another show
              </button>
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
              Share music, IRL shows, and online shows you recommend with your listeners.
            </p>
            <div className="bg-[#1a1a1a] rounded p-4 space-y-4">
              {recsInput.map((rec, index) => (
                <div key={index} className={`space-y-3 ${index > 0 ? "border-t border-gray-800 pt-4" : ""}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 text-xs font-mono">REC {index + 1}</span>
                    {recsInput.length > 1 && (
                      <button
                        onClick={() => {
                          const updated = recsInput.filter((_, i) => i !== index);
                          setRecsInput(updated);
                        }}
                        className="px-2 py-1 text-gray-500 hover:text-red-400 transition-colors"
                        aria-label="Remove rec"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {/* Type selector */}
                  <div className="flex gap-2">
                    {(["music", "irl", "online"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          const updated = [...recsInput];
                          updated[index] = { ...updated[index], type: t };
                          setRecsInput(updated);
                        }}
                        className={`px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wide transition-colors ${
                          rec.type === t
                            ? "bg-white text-black"
                            : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                        }`}
                      >
                        {t === "irl" ? "IRL Show" : t === "online" ? "Online Show" : "Music"}
                      </button>
                    ))}
                  </div>
                  {/* Title */}
                  <input
                    type="text"
                    value={rec.title}
                    onChange={(e) => {
                      const updated = [...recsInput];
                      updated[index] = { ...updated[index], title: e.target.value };
                      setRecsInput(updated);
                    }}
                    placeholder="Title"
                    className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                  />
                  {/* URL */}
                  <input
                    type="text"
                    value={rec.url}
                    onChange={(e) => {
                      const updated = [...recsInput];
                      updated[index] = { ...updated[index], url: e.target.value };
                      setRecsInput(updated);
                    }}
                    placeholder="https://..."
                    className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                  />
                  {/* Image upload */}
                  <div className="flex items-center gap-3">
                    {rec.imageUrl ? (
                      <div className="relative w-20 h-12 rounded overflow-hidden border border-gray-700">
                        <Image
                          src={rec.imageUrl}
                          alt="Rec image"
                          fill
                          className="object-cover"
                          unoptimized
                        />
                        <button
                          onClick={() => {
                            const updated = [...recsInput];
                            updated[index] = { ...updated[index], imageUrl: undefined };
                            setRecsInput(updated);
                          }}
                          className="absolute top-0 right-0 bg-black/70 p-0.5 rounded-bl"
                          aria-label="Remove image"
                        >
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center gap-2 px-3 py-2 bg-black border border-gray-800 rounded text-gray-400 hover:text-white text-sm cursor-pointer transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {uploadingRecImage === index ? "Uploading..." : "Add Image"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploadingRecImage === index}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file || !user) return;
                            const validation = validatePhoto(file);
                            if (!validation.valid) {
                              alert(validation.error);
                              return;
                            }
                            setUploadingRecImage(index);
                            const result = await uploadRecImage(user.uid, index, file);
                            if (result.success && result.url) {
                              const updated = [...recsInput];
                              updated[index] = { ...updated[index], imageUrl: result.url };
                              setRecsInput(updated);
                            } else {
                              alert(result.error || "Upload failed");
                            }
                            setUploadingRecImage(null);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>
              ))}
              <button
                onClick={() => setRecsInput([...recsInput, { type: "music", title: "", url: "" }])}
                className="text-gray-400 hover:text-white text-sm transition-colors flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Recommendation
              </button>
              <p className="text-gray-600 text-xs">
                {savingMyRecs ? "Saving..." : saveMyRecsSuccess ? "Saved" : ""}
              </p>
            </div>
          </section>


        </div>
      </main>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        includeDjTerms
      />

      {/* Upload Pre-Recording Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70"
            onClick={!uploading ? closeUploadModal : undefined}
          />

          {/* Modal */}
          <div className="relative bg-[#1a1a1a] rounded-xl w-full max-w-md p-6 border border-gray-800">
            <h2 className="text-white text-lg font-semibold mb-4">Upload a pre-recording</h2>

            {/* Show name input */}
            <div className="mb-4">
              <label className="text-gray-400 text-sm mb-1 block">Recording name</label>
              <input
                type="text"
                value={uploadShowName}
                onChange={(e) => setUploadShowName(e.target.value.slice(0, 100))}
                placeholder="e.g. Deep House Sessions"
                disabled={uploading}
                className="w-full bg-[#252525] text-white rounded px-3 py-2 text-sm border border-gray-700 focus:border-gray-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* File picker */}
            <div className="mb-4">
              <label className="text-gray-400 text-sm mb-1 block">Audio file</label>
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.aac,.m4a,.flac,.ogg,.mp4,.webm"
                onChange={handleUploadFileChange}
                disabled={uploading}
                className="w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-gray-800 file:text-white hover:file:bg-gray-700 file:cursor-pointer disabled:opacity-50"
              />
            </div>

            {/* File info */}
            {uploadFile && (
              <div className="mb-4 bg-[#252525] rounded p-3 text-sm">
                <div className="flex justify-between text-gray-400">
                  <span className="truncate mr-2">{uploadFile.name}</span>
                  <span className="flex-shrink-0">{(uploadFile.size / (1024 * 1024)).toFixed(1)} MB</span>
                </div>
                {detectingDuration && (
                  <div className="flex items-center gap-2 mt-1 text-gray-500">
                    <div className="w-3 h-3 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                    <span>Reading audio file...</span>
                  </div>
                )}
                {uploadDuration !== null && (
                  <div className="text-gray-300 mt-1">
                    Duration: {Math.floor(uploadDuration / 60)}m {uploadDuration % 60}s
                  </div>
                )}
              </div>
            )}

            {/* Quota info */}
            {uploadQuotaRemaining !== null && (
              <div className="mb-4 text-sm text-gray-500">
                {Math.floor(uploadQuotaRemaining / 60)} minutes remaining this month
              </div>
            )}

            {/* Upload progress */}
            {uploading && (
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-400">Uploading...</span>
                  <span className="text-white">{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error message */}
            {uploadError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
                {uploadError}
              </div>
            )}

            {/* Terms confirmation */}
            <div className="mb-4 bg-gray-800/50 border border-gray-700 rounded-lg p-4">
              <p className="text-gray-300 text-sm mb-3">
                I confirm that I am the DJ (or authorized representative) known as <span className="text-white font-medium">{chatUsername || 'DJName'}</span>, under whose name this upload is being made.
              </p>
              <p className="text-gray-300 text-sm mb-3">
                By uploading this recording, I represent and warrant that:
              </p>
              <ul className="text-gray-400 text-sm space-y-1 mb-4 ml-1">
                <li>• I am responsible for ensuring the content complies with applicable laws.</li>
                <li>• Channel may use this recording, replay it, and make it available on Channel websites and radio.</li>
                <li>• All DJs featured in this recording are aware of and consent to its use on Channel.</li>
              </ul>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={uploadTermsConfirmed}
                  onChange={(e) => setUploadTermsConfirmed(e.target.checked)}
                  disabled={uploading}
                  className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-gray-800 text-white focus:ring-0 focus:ring-offset-0 cursor-pointer"
                />
                <span className="text-gray-300 text-sm">
                  I confirm and agree to the{' '}
                  <a
                    href="/dj-terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white underline hover:text-gray-300"
                  >
                    DJ Terms
                  </a>
                </span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={closeUploadModal}
                disabled={uploading && uploadProgress > 0 && uploadProgress < 100}
                className="flex-1 py-2.5 rounded font-medium text-white bg-gray-800 hover:bg-gray-700 transition-colors border border-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={
                  uploading ||
                  !uploadFile ||
                  !uploadShowName.trim() ||
                  uploadDuration === null ||
                  detectingDuration ||
                  !uploadTermsConfirmed ||
                  (uploadQuotaRemaining !== null && uploadDuration > uploadQuotaRemaining)
                }
                className="flex-1 py-2.5 rounded font-medium bg-white text-black hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? 'Uploading...' : uploadError ? 'Try again' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
