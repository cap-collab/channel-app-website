"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { doc, onSnapshot, updateDoc, collection, query, where, orderBy, Timestamp, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { useSchedule } from "@/contexts/ScheduleContext";
import { useUserRole, isDJ } from "@/hooks/useUserRole";
import { AuthModal } from "@/components/AuthModal";
import { Header } from "@/components/Header";
import { normalizeUrl } from "@/lib/url";
import { normalizeTrackIds, type TrackId } from "@/lib/track-ids";
import { uploadDJPhoto, deleteDJPhoto, validatePhoto, uploadRecImage, uploadEventPhoto, uploadShowImage, deleteShowImage, uploadArchiveImage } from "@/lib/photo-upload";
import { wordBoundaryMatch, normalizeUsername } from "@/lib/dj-matching";
import { CreatableChipField } from "@/components/events/CreatableChipField";
import { getStationById } from "@/lib/stations";
import { TEMPOS } from "@/lib/tempo";
import type { Tempo } from "@/types/broadcast";
import { parseGenresInput, extractInstagramHandle } from "@/lib/genres";
import { ShareableShowCardStory } from "@/components/studio/ShareableShowCardStory";
import { Checkbox } from "@/components/Checkbox";
import CollectiveStudioClient from "@/app/studio/CollectiveStudioClient";

// Shown when a DJ tries to edit or delete a recording that has already been
// booked into an upcoming anchor or restream slot.
const SCHEDULED_LOCK_MESSAGE =
  'Your show has already been scheduled, reach out to Cap 415 316 3109 if you need to edit anything.';

// Word boundary matching for DJ/show names
// e.g. "PAC" matches "PAC" or "Night PAC" but NOT "pace" or "space"
function containsMatch(text: string, term: string): boolean {
  return wordBoundaryMatch(text, term);
}

interface UpcomingShow {
  id: string;
  slotId?: string;
  showName: string;
  djName?: string;
  startTime: number;
  endTime: number;
  status: string;
  stationId: string;
  stationName: string;
  isExternal: boolean;
  broadcastToken?: string;
  showImageUrl?: string;
  djPhotoUrl?: string;
  djGenres?: string[];
  djDescription?: string;
  broadcastType?: string;
}

interface CustomLink {
  label: string;
  url: string;
}

interface ResidentReferral {
  username: string;
  displayName: string;
  photoUrl: string;
}

// Logged-out "Don't have a code?" section: heading + body copy + a grid of
// monthly residents. Each card reuses the /scene card shape (16:9 image with the
// name overlaid bottom-left) and links to the resident's profile. 2-up on mobile,
// 4-up on desktop. Renders nothing until residents have loaded. The API only
// returns residents with a photo, so there's no name-fallback tile.
function ResidentReferralSection({ residents }: { residents: ResidentReferral[] }) {
  if (residents.length === 0) return null;
  return (
    <div className="mt-12 text-center">
      <p className="text-white font-medium mb-1">Don&apos;t have a code?</p>
      <p className="text-gray-400 text-sm mb-8">
        New hosts join through referrals from artists already broadcasting on Channel.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
        {residents.map((r) => (
          <Link
            key={r.username}
            href={`/dj/${r.username}`}
            className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10 group"
          >
            <Image
              src={r.photoUrl}
              alt={r.displayName}
              fill
              className="object-cover"
              unoptimized
            />
            {/* Gradient scrims + bottom-left name — matches the /scene card overlay. */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
            <div className="absolute bottom-2 left-2 right-2 text-left">
              <span className="text-xs md:text-sm font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-1">
                {r.displayName}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

interface DJEvent {
  id?: string; // undefined = new event, string = existing event
  name: string;
  date: string; // YYYY-MM-DD for form input
  startTime: string; // HH:MM for form input, defaults to 20:00 (8 PM)
  location: string;
  ticketLink: string;
  discountCode: string;
  photo: string | null;
  venueName: string; // free text — venues are no longer an entity
  linkedVenues: { venueName: string }[];
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
    website?: string;
    customLinks?: CustomLink[];
  };
  radioShows?: RadioShow[];
  myRecs?: RecItem[];
  // Sharing consent — all default true (opted in). YouTube and SoundCloud
  // hide archives from /broadcast/admin → Social Render when off; Meta is
  // stored only (no enforcement yet — placeholder for future Instagram/Meta
  // sharing). An archive shows up in the picker if at least one of YouTube
  // or SoundCloud is on.
  youtubeOptIn?: boolean;
  soundcloudOptIn?: boolean;
  metaOptIn?: boolean;
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
  const searchParams = useSearchParams();
  const [showAuthModal, setShowAuthModal] = useState(false);

  // DJ upgrade state
  const [agreedToDJTerms, setAgreedToDJTerms] = useState(false);
  const [upgradingToDJ, setUpgradingToDJ] = useState(false);
  const [upgradeError, setUpgradeError] = useState("");

  // Invite code state
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [codeValidating, setCodeValidating] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [codeValidated, setCodeValidated] = useState(false);

  // Monthly residents shown on the logged-out "don't have a code?" referral grid.
  const [monthlyResidents, setMonthlyResidents] = useState<ResidentReferral[]>([]);

  // Track when inline sign-in flow completes (role assignment done)
  const [signInFlowComplete, setSignInFlowComplete] = useState(false);
  // Keep showing inline auth UI until sign-in flow is fully done
  const [signingInInline, setSigningInInline] = useState(false);

  // If user signed in via the inline AuthModal with DJ terms,
  // we know they have the DJ role — skip the upgrade screen while role propagates
  const djTermsJustAccepted = signInFlowComplete || (typeof window !== 'undefined' && sessionStorage.getItem('djTermsJustAccepted') === 'true');
  // Auto-validate invite code from URL parameter (e.g. /studio?code=XYZ)
  useEffect(() => {
    const codeParam = searchParams.get("code");
    if (codeParam && !codeValidated) {
      setCodeValidating(true);
      fetch("/api/validate-invite-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeParam.trim() }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.valid) {
            setCodeValidated(true);
          } else {
            setShowCodeInput(true);
            setCodeError("Invalid code. Please try again.");
          }
        })
        .catch(() => {
          setShowCodeInput(true);
          setCodeError("Something went wrong. Please try again.");
        })
        .finally(() => setCodeValidating(false));
    }
  }, [searchParams]);

  // Owned collective slugs as STATE (myCollectiveSlugsRef drives slot matching;
  // this drives the collective-studio routing + toggle). Empty = not an owner.
  const [ownedCollectiveSlugs, setOwnedCollectiveSlugs] = useState<string[]>([]);
  // When set, /studio renders the collective studio for this slug instead of the
  // personal artist studio (collective-only owner, or toggled in).
  const [managingCollectiveSlug, setManagingCollectiveSlug] = useState<string | null>(null);

  // Preferred collective for owners of MULTIPLE collectives: the last one they
  // managed (localStorage), if still owned; else the first. Single-collective
  // owners just get their one slug.
  const LAST_COLLECTIVE_KEY = "lastManagedCollectiveSlug";
  const preferredCollectiveSlug = useCallback((): string | null => {
    if (ownedCollectiveSlugs.length === 0) return null;
    if (typeof window !== "undefined") {
      const last = window.localStorage.getItem(LAST_COLLECTIVE_KEY);
      if (last && ownedCollectiveSlugs.includes(last)) return last;
    }
    return ownedCollectiveSlugs[0];
  }, [ownedCollectiveSlugs]);

  // Switch (and remember) which collective is being managed.
  const manageCollective = useCallback((slug: string) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_COLLECTIVE_KEY, slug);
    }
    setManagingCollectiveSlug(slug);
  }, []);

  // Auto-enter the collective studio for collective owners. A collective-only
  // owner (not a DJ) has no personal studio, so /studio IS their collective
  // studio. A DJ who also owns a collective stays on their artist studio until
  // they click the toggle.
  useEffect(() => {
    if (managingCollectiveSlug) return;
    if (ownedCollectiveSlugs.length === 0) return;
    if (!isDJ(role)) {
      setManagingCollectiveSlug(preferredCollectiveSlug());
    }
  }, [ownedCollectiveSlugs, role, managingCollectiveSlug, preferredCollectiveSlug]);

  // Fetch monthly residents for the logged-out referral grid. Only relevant
  // before the user becomes a DJ; once they have a profile this view is gone.
  useEffect(() => {
    if (isDJ(role)) return;
    let cancelled = false;
    fetch("/api/residents/monthly")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data?.residents)) {
          setMonthlyResidents(data.residents);
        }
      })
      .catch(() => {
        /* non-critical — grid just stays hidden */
      });
    return () => { cancelled = true; };
  }, [role]);

  // "Entered a studio" = the terminal state that ends the just-accepted spinner
  // and the safety reload. A DJ role, OR a collective owner (who may stay
  // role:'user' forever — without this, the reload below loops every 5s because
  // !isDJ(role) is permanently true for a collective-only owner).
  const enteredStudio = isDJ(role) || ownedCollectiveSlugs.length > 0;

  // Clear the flag once the studio is reachable (DJ role or collective ownership).
  useEffect(() => {
    if (enteredStudio && typeof window !== 'undefined') {
      sessionStorage.removeItem('djTermsJustAccepted');
      setSignInFlowComplete(false);
      setSigningInInline(false);
    }
  }, [enteredStudio]);

  // The live user-doc onSnapshot flips role/ownership as soon as the grant lands,
  // so the spinner normally clears on its own. If after 8s nothing has landed
  // (e.g. a new email with no admin attribution), give up so we can show a
  // dead-end message instead of spinning forever. No reload gymnastics.
  const [grantGaveUp, setGrantGaveUp] = useState(false);
  useEffect(() => {
    if (enteredStudio) {
      setGrantGaveUp(false);
      return;
    }
    if (!djTermsJustAccepted || !isAuthenticated) return;
    const timer = setTimeout(() => {
      sessionStorage.removeItem('djTermsJustAccepted');
      setGrantGaveUp(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [enteredStudio, djTermsJustAccepted, isAuthenticated]);


  // Profile data
  const [chatUsername, setChatUsername] = useState<string | null>(null);
  const [isResident, setIsResident] = useState(false);
  const [djProfile, setDjProfile] = useState<DJProfile>({
    bio: null,
    tipButtonLink: null,
    photoUrl: null,
    location: null,
    genres: [],
    socialLinks: {},
    radioShows: [],
    myRecs: [],
    youtubeOptIn: true,
    soundcloudOptIn: true,
    metaOptIn: true,
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
  const [residentAdvisorInput, setResidentAdvisorInput] = useState("");
  const [websiteInput, setWebsiteInput] = useState("");
  const [customLinksInput, setCustomLinksInput] = useState<CustomLink[]>([]);
  const [savingSocial, setSavingSocial] = useState(false);
  const [saveSocialSuccess, setSaveSocialSuccess] = useState(false);

  // Form state - IRL Events section
  const [djEvents, setDjEvents] = useState<DJEvent[]>([]);
  const [loadingDjEvents, setLoadingDjEvents] = useState(true);
  const [newEvent, setNewEvent] = useState<DJEvent>({ name: "", date: "", startTime: "20:00", location: "", ticketLink: "", discountCode: "", photo: null, venueName: "", linkedVenues: [], linkedCollectives: [], djs: [] });
  const [showNewEventForm, setShowNewEventForm] = useState(false);
  const [savingNewEvent, setSavingNewEvent] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [uploadingEventPhoto, setUploadingEventPhoto] = useState(false);
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

  // Form state - Name (internal)
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [saveNameSuccess, setSaveNameSuccess] = useState(false);

  // DJ Name setup state (for users without a chat username)
  const [djNameInput, setDjNameInput] = useState("");
  const [djNameAvailable, setDjNameAvailable] = useState<boolean | null>(null);
  const [djNameError, setDjNameError] = useState<string | null>(null);
  const [checkingDjName, setCheckingDjName] = useState(false);
  const [savingDjName, setSavingDjName] = useState(false);

  // Upcoming shows (broadcasts + external radio shows)
  const [upcomingShows, setUpcomingShows] = useState<UpcomingShow[]>([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(true);
  const [uploadingShowImageSlotId, setUploadingShowImageSlotId] = useState<string | null>(null);
  const [showImageErrors, setShowImageErrors] = useState<Record<string, string | null>>({});
  const [editingShowNameSlotId, setEditingShowNameSlotId] = useState<string | null>(null);
  const [editingShowNameValue, setEditingShowNameValue] = useState("");
  const [savingShowName, setSavingShowName] = useState(false);
  const [showNameError, setShowNameError] = useState<string | null>(null);
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
    showImageUrl?: string;
    ownerUserId?: string; // djs[0].userId — only the owner may delete. Absent for session recs (uploader is owner).
    trackIds?: TrackId[]; // editable tracklist (archive recordings only)
  }
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(true);
  const [publishingRecording, setPublishingRecording] = useState<string | null>(null);
  const [deletingRecording, setDeletingRecording] = useState<string | null>(null);
  const [editingRecordingId, setEditingRecordingId] = useState<string | null>(null);
  const [editingRecordingName, setEditingRecordingName] = useState("");
  const [savingRecordingName, setSavingRecordingName] = useState(false);
  const [recordingNameError, setRecordingNameError] = useState<string | null>(null);
  const [uploadingRecordingImageId, setUploadingRecordingImageId] = useState<string | null>(null);
  const [recordingImageErrors, setRecordingImageErrors] = useState<Record<string, string | null>>({});
  const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);
  const [recordingCurrentTime, setRecordingCurrentTime] = useState<Record<string, number>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  // Tracklist editor: per-recording working draft (keyed by recording id) while
  // editing, plus save/error state. `null` draft = not currently editing that card.
  const [tracklistDrafts, setTracklistDrafts] = useState<Record<string, TrackId[]>>({});
  const [savingTracklistId, setSavingTracklistId] = useState<string | null>(null);
  const [tracklistErrors, setTracklistErrors] = useState<Record<string, string | null>>({});
  // Archive ids that are already scheduled into an upcoming anchor or restream
  // slot. Once scheduled, a DJ must not silently edit/delete the recording out
  // from under the broadcast — they're told to reach out to Cap instead.
  const [scheduledArchiveIds, setScheduledArchiveIds] = useState<Set<string>>(new Set());

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
  const [uploadTempo, setUploadTempo] = useState<Tempo | ''>('');
  const [uploadImageFile, setUploadImageFile] = useState<File | null>(null);
  const [uploadImagePreview, setUploadImagePreview] = useState<string | null>(null);
  const [uploadImageError, setUploadImageError] = useState<string | null>(null);
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
    if (file.size > 1500 * 1024 * 1024) {
      setUploadError('File is too large. Maximum size is 1500MB.');
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

  // Handle optional image attached to the pre-recording
  const handleUploadImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadImageError(null);
    const validation = validatePhoto(file);
    if (!validation.valid) {
      setUploadImageError(validation.error || 'Invalid image');
      return;
    }
    setUploadImageFile(file);
    setUploadImagePreview(URL.createObjectURL(file));
  }, []);

  const clearUploadImage = useCallback(() => {
    if (uploadImagePreview) URL.revokeObjectURL(uploadImagePreview);
    setUploadImageFile(null);
    setUploadImagePreview(null);
    setUploadImageError(null);
  }, [uploadImagePreview]);

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
          tempo: uploadTempo || null,
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

      // Step 4: If the user attached an image, upload it to Firebase Storage
      // and write the URL onto the archive doc. Archive cards/pages already
      // read `showImageUrl` for display, so no other wiring is needed.
      if (uploadImageFile && db) {
        const imageResult = await uploadArchiveImage(archiveId, uploadImageFile);
        if (imageResult.success && imageResult.url) {
          try {
            await updateDoc(doc(db, 'archives', archiveId), {
              showImageUrl: imageResult.url,
            });
          } catch (imgErr) {
            console.error('Failed to save recording image URL:', imgErr);
          }
        } else {
          console.error('Recording image upload failed:', imageResult.error);
        }
      }

      // Success — close modal and reset state
      setShowUploadModal(false);
      setUploadShowName('');
      setUploadFile(null);
      setUploadDuration(null);
      setUploadProgress(0);
      setUploadError('');
      setUploadTermsConfirmed(false);
      setUploadTempo('');
      clearUploadImage();
      // Recording will appear automatically via onSnapshot listener

    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [user, uploadFile, uploadDuration, uploadShowName, uploadTempo, uploadImageFile, clearUploadImage]);

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
    setUploadTempo('');
    clearUploadImage();
  }, [uploading, clearUploadImage]);

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
  const nameDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadRef = useRef(true);

  // Load user profile and DJ profile data
  useEffect(() => {
    if (!user || !db) return;

    const userRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      const data = snapshot.data();
      if (data) {
        setChatUsername(data.chatUsername || null);
        setIsResident(!!data.djProfile?.residency?.cadence);
        // Collectives this user owns, denormalized on the user doc (kept in sync
        // by /api/admin/collectives). Sourced here off the live user-doc
        // subscription instead of a separate `owners array-contains` query, so
        // it updates automatically if ownership changes. Stored raw — the slot
        // matcher below compares against the raw slot djUsername.
        const ownedSlugs = Array.isArray(data.ownedCollectiveSlugs)
          ? data.ownedCollectiveSlugs.filter((s: unknown): s is string => typeof s === "string")
          : [];
        myCollectiveSlugsRef.current = new Set(ownedSlugs);
        setOwnedCollectiveSlugs(ownedSlugs);
        // Brand-new DJs may not have a djProfile map yet — release the
        // initial-load gate so auto-save effects can fire. Without this,
        // every save is silently no-op'd at the `if (initialLoadRef.current) return`
        // check, the user types but nothing persists.
        if (initialLoadRef.current && !data.djProfile) {
          initialLoadRef.current = false;
        }
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
            // Default to true (opted in) when the field doesn't exist yet,
            // so legacy DJ profiles created before this feature are
            // implicitly consenting until they explicitly opt out.
            youtubeOptIn: data.djProfile.youtubeOptIn !== false,
            soundcloudOptIn: data.djProfile.soundcloudOptIn !== false,
            metaOptIn: data.djProfile.metaOptIn !== false,
          });
          // Only set input values on initial load to avoid overwriting user edits
          if (initialLoadRef.current) {
            setBioInput(data.djProfile.bio || "");
            setTipButtonLinkInput(data.djProfile.tipButtonLink || "");
            setNameInput(data.djProfile.name || "");
            setLocationInput(data.djProfile.location || "");
            setGenresInput((data.djProfile.genres || []).join(", "));
            setInstagramInput(data.djProfile.socialLinks?.instagram || "");
            setSoundcloudInput(data.djProfile.socialLinks?.soundcloud || "");
            setBandcampInput(data.djProfile.socialLinks?.bandcamp || "");
            setYoutubeInput(data.djProfile.socialLinks?.youtube || "");
            setBookingEmailInput(data.djProfile.socialLinks?.bookingEmail || "");
            setResidentAdvisorInput(data.djProfile.socialLinks?.residentAdvisor || "");
            setWebsiteInput(data.djProfile.socialLinks?.website || "");
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


  // Set of collective slugs where this user is an owner. Refreshed alongside
  // the snapshot listener so a slot assigned to a collective the user owns
  // shows up in their upcoming list.
  const myCollectiveSlugsRef = useRef<Set<string>>(new Set());

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

    // myCollectiveSlugsRef (collectives this user owns) is populated by the
    // user-doc subscription above, from the denormalized ownedCollectiveSlugs
    // field — no separate `owners array-contains` query needed here.

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
            data.djEmail?.toLowerCase() === user.email?.toLowerCase() ||
            // Collective ownership: slot assigned to a collective this user owns
            (typeof data.djUsername === "string" && myCollectiveSlugsRef.current.has(data.djUsername));

          if (isMySlot) {
            const id = `broadcast-${docSnap.id}`;
            seenIds.add(id);
            shows.push({
              id,
              slotId: docSnap.id,
              stationId: data.stationId || "broadcast",
              stationName: "Channel Radio",
              showName: data.showName || "Broadcast",
              djName: data.djName,
              startTime: (data.startTime as Timestamp).toMillis(),
              endTime: (data.endTime as Timestamp).toMillis(),
              status: data.status,
              isExternal: false,
              broadcastToken: data.broadcastToken,
              showImageUrl: data.showImageUrl || undefined,
              djPhotoUrl: data.liveDjPhotoUrl || undefined,
              djGenres: data.liveDjGenres || undefined,
              djDescription: data.liveDjDescription || data.liveDjBio || undefined,
              broadcastType: data.broadcastType,
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
    let liveRecs: Recording[] = [];
    let sessionRecs: Recording[] = [];
    let archiveSlotIds = new Set<string>();
    let liveSlotIds = new Set<string>();
    let archivesLoaded = false;
    let liveLoaded = false;
    let sessionsLoaded = false;

    // Map an archive doc to a studio Recording row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toRecording = (id: string, data: any): Recording => ({
      id,
      showName: data.showName || 'Untitled Recording',
      djName: data.djs?.[0]?.name,
      createdAt: data.recordedAt || data.createdAt || Date.now(),
      duration: data.duration || 0,
      isPublic: data.isPublic !== false,
      slug: data.slug || id,
      audioUrl: data.recordingUrl,
      sourceType: data.sourceType,
      source: 'archive',
      showImageUrl: data.showImageUrl,
      ownerUserId: data.djs?.[0]?.userId,
      trackIds: normalizeTrackIds(data.trackIds),
    });

    const mergeAndSet = () => {
      if (!archivesLoaded || !liveLoaded || !sessionsLoaded) return;
      const slotIds = new Set<string>([...Array.from(archiveSlotIds), ...Array.from(liveSlotIds)]);
      // Deduplicate: only include studio-sessions that don't already have an archive
      const filteredSessions = sessionRecs.filter(r => !slotIds.has(r.id));
      // Dedup archives by id — a collective archive the user also uploaded can
      // appear in BOTH archiveRecs (uploadedBy) and liveRecs (collective slug).
      const seen = new Set<string>();
      const merged = [...archiveRecs, ...liveRecs, ...filteredSessions].filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
      merged.sort((a, b) => b.createdAt - a.createdAt);
      setRecordings(merged);
      setLoadingRecordings(false);
    };

    // Query 1: UPLOADED recordings (sourceType 'recording'). These reliably
    // carry `uploadedBy` (set at upload time), so a direct query works and stays
    // realtime (the Publish toggle / name edits update live).
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
          archiveRecs.push(toRecording(docSnap.id, data));
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

    // Query 1b: LIVE recordings + COLLECTIVE archives. Neither is findable by a
    // Firestore query on ownership: live archives carry no `uploadedBy` (owner in
    // djs[].userId), and collective archives are credited by djs[0].username ===
    // <collective slug>. Both are positional array fields, so we mirror the DJ
    // profile page — fetch and filter in memory. The archives collection is
    // small (~90 docs). Include an archive when:
    //   (a) it's a LIVE recording the user is credited on (djs[].userId), OR
    //   (b) it's credited to a collective the user owns (djs[0].username ∈ slugs),
    //       whether that archive is live OR an uploaded recording.
    // (Own UPLOADED recordings are already loaded realtime by Query 1.)
    (async () => {
      try {
        // Owned collective slugs, normalized to match archive djs[].username.
        // Sourced from myCollectiveSlugsRef (populated by the user-doc
        // subscription from the denormalized ownedCollectiveSlugs field) —
        // no separate `owners array-contains` query.
        const ownedSlugs = new Set<string>();
        try {
          myCollectiveSlugsRef.current.forEach((slug) => {
            ownedSlugs.add(normalizeUsername(slug));
          });
        } catch (err) {
          console.error("Error resolving owned collectives:", err);
        }

        const snapshot = await getDocs(
          query(collection(db, "archives"), where("sourceType", "in", ["live", "recording"]))
        );
        liveRecs = [];
        liveSlotIds = new Set();
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const djs = (data.djs || []) as { userId?: string; username?: string }[];
          const isOwnLive = data.sourceType === "live" && djs.some((dj) => dj.userId === user.uid);
          const isOwnedCollective = ownedSlugs.size > 0 && djs.some(
            (dj) => typeof dj.username === "string" && ownedSlugs.has(normalizeUsername(dj.username))
          );
          if (!isOwnLive && !isOwnedCollective) return;
          if (data.priority === 'hidden') return; // admin-hidden → keep out of studio
          if (data.broadcastSlotId) liveSlotIds.add(data.broadcastSlotId);
          liveRecs.push(toRecording(docSnap.id, data));
        });
      } catch (err) {
        console.error("Error loading live/collective recordings:", err);
      } finally {
        liveLoaded = true;
        mergeAndSet();
      }
    })();

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

  // Track which archives are already booked into an upcoming anchor or restream
  // slot. A scheduled slot points at its archive via `archiveId` (set only for
  // restream/anchor) and, for anchors, via `postLiveArchiveId`. We only care
  // about slots that haven't ended yet — a past broadcast no longer locks the
  // recording. broadcast-slots is world-readable, so this runs client-side.
  useEffect(() => {
    if (!user || !db) return;
    const slotsRef = collection(db, "broadcast-slots");
    const q = query(slotsRef, where("endTime", ">", Timestamp.fromDate(new Date())));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const ids = new Set<string>();
        snap.forEach((d) => {
          const data = d.data();
          if (data.broadcastType !== 'anchor' && data.broadcastType !== 'restream') return;
          if (typeof data.archiveId === 'string' && data.archiveId) ids.add(data.archiveId);
          if (typeof data.postLiveArchiveId === 'string' && data.postLiveArchiveId) ids.add(data.postLiveArchiveId);
        });
        setScheduledArchiveIds(ids);
      },
      (err) => console.error("Error loading scheduled slots:", err)
    );
    return () => unsub();
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
      const { doc: firestoreDoc, deleteDoc, getDoc, updateDoc } = await import('firebase/firestore');
      const rec = recordings.find(r => r.id === recordingId);

      if (rec?.source === 'session') {
        // This recording only exists in studio-sessions (no archive doc)
        const sessionRef = firestoreDoc(db, 'studio-sessions', recordingId);
        await deleteDoc(sessionRef);
      } else {
        // Delete from archives + associated studio-session
        const archiveRef = firestoreDoc(db, 'archives', recordingId);
        const archiveSnap = await getDoc(archiveRef);
        // Only the current OWNER (djs[0]) may delete. After an admin reassigns
        // an archive's owner (e.g. DJ → collective, original DJ kept only as a
        // contributor), the original uploader is no longer the owner and must
        // not be able to delete it. djs[0].userId is the owner; if it's set and
        // isn't this user, refuse. (No userId on djs[0] — e.g. a collective
        // owner — also means this individual isn't the owner.)
        const ownerUserId = archiveSnap.data()?.djs?.[0]?.userId;
        if (ownerUserId !== user.uid) {
          alert('Only the current owner of this recording can delete it.');
          setDeletingRecording(null);
          return;
        }
        const sessionId = archiveSnap.data()?.broadcastSlotId;
        if (sessionId) {
          const sessionRef = firestoreDoc(db, 'studio-sessions', sessionId);
          await deleteDoc(sessionRef).catch(() => {}); // ignore if already deleted
        }
        await deleteDoc(archiveRef);
      }

      // Refund this recording's duration to the monthly upload quota. Uploads
      // (and live recordings) charge usedSeconds when they complete, but the
      // delete paths never credited it back — so a DJ who deleted and tried to
      // re-upload would be stuck with a phantom "0 minutes remaining". Only
      // refund when the recording was charged in the CURRENT quota month
      // (matching monthKey), and clamp at 0 so we can never over-refund.
      const refundSeconds = rec?.duration || 0;
      if (refundSeconds > 0) {
        try {
          const userRef = firestoreDoc(db, 'users', user.uid);
          const userSnap = await getDoc(userRef);
          const quota = userSnap.data()?.recordingQuota;
          if (quota?.monthKey) {
            const recMonth = new Date(rec?.createdAt || 0).toISOString().slice(0, 7);
            if (recMonth === quota.monthKey) {
              await updateDoc(userRef, {
                'recordingQuota.usedSeconds': Math.max(0, (quota.usedSeconds || 0) - refundSeconds),
              });
            }
          }
        } catch (refundErr) {
          // Non-fatal: the recording is already deleted; quota will self-correct
          // next month. Log so we can spot it if refunds start failing.
          console.error('Quota refund on delete failed:', refundErr);
        }
      }
    } catch (error) {
      console.error('Error deleting recording:', error);
    } finally {
      setDeletingRecording(null);
    }
  }, [user, db, recordings]);

  const handleStartEditRecordingName = useCallback((recordingId: string, currentName: string) => {
    setEditingRecordingId(recordingId);
    setEditingRecordingName(currentName);
    setRecordingNameError(null);
  }, []);

  const handleCancelEditRecordingName = useCallback(() => {
    setEditingRecordingId(null);
    setEditingRecordingName("");
    setRecordingNameError(null);
  }, []);

  const handleRecordingImageChange = useCallback(async (recordingId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !db) return;

    setRecordingImageErrors(prev => ({ ...prev, [recordingId]: null }));

    const validation = validatePhoto(file);
    if (!validation.valid) {
      setRecordingImageErrors(prev => ({ ...prev, [recordingId]: validation.error || 'Invalid image' }));
      return;
    }

    setUploadingRecordingImageId(recordingId);
    try {
      const result = await uploadArchiveImage(recordingId, file);
      if (!result.success || !result.url) {
        setRecordingImageErrors(prev => ({ ...prev, [recordingId]: result.error || 'Upload failed' }));
        return;
      }
      await updateDoc(doc(db, 'archives', recordingId), {
        showImageUrl: result.url,
      });
      setRecordings(prev => prev.map(r =>
        r.id === recordingId ? { ...r, showImageUrl: result.url } : r
      ));
    } catch (err) {
      console.error('Error uploading recording image:', err);
      setRecordingImageErrors(prev => ({ ...prev, [recordingId]: 'Failed to upload image' }));
    } finally {
      setUploadingRecordingImageId(null);
    }
  }, [db]);

  const handleRemoveRecordingImage = useCallback(async (recordingId: string) => {
    if (!db) return;
    setUploadingRecordingImageId(recordingId);
    setRecordingImageErrors(prev => ({ ...prev, [recordingId]: null }));
    try {
      await updateDoc(doc(db, 'archives', recordingId), {
        showImageUrl: null,
      });
      setRecordings(prev => prev.map(r =>
        r.id === recordingId ? { ...r, showImageUrl: undefined } : r
      ));
    } catch (err) {
      console.error('Error removing recording image:', err);
      setRecordingImageErrors(prev => ({ ...prev, [recordingId]: 'Failed to remove image' }));
    } finally {
      setUploadingRecordingImageId(null);
    }
  }, [db]);

  const handleSaveRecordingName = useCallback(async (recordingId: string) => {
    if (!db) return;
    const trimmed = editingRecordingName.trim();
    if (!trimmed) {
      setRecordingNameError("Name cannot be empty");
      return;
    }

    setSavingRecordingName(true);
    setRecordingNameError(null);

    try {
      await updateDoc(doc(db, 'archives', recordingId), {
        showName: trimmed,
      });
      setRecordings(prev => prev.map(r =>
        r.id === recordingId ? { ...r, showName: trimmed } : r
      ));
      setEditingRecordingId(null);
      setEditingRecordingName("");
    } catch (error) {
      console.error('Error saving recording name:', error);
      setRecordingNameError('Failed to save name');
    } finally {
      setSavingRecordingName(false);
    }
  }, [db, editingRecordingName]);

  // ---- Tracklist editor (artist edits their own archive's trackIds) ----
  // Enter edit mode for a card: seed the draft from the recording's tracklist.
  const handleStartEditTracklist = useCallback((rec: Recording) => {
    setTracklistDrafts(prev => ({ ...prev, [rec.id]: (rec.trackIds || []).map(t => ({ ...t })) }));
    setTracklistErrors(prev => ({ ...prev, [rec.id]: null }));
  }, []);

  const handleCancelEditTracklist = useCallback((recordingId: string) => {
    setTracklistDrafts(prev => { const next = { ...prev }; delete next[recordingId]; return next; });
    setTracklistErrors(prev => ({ ...prev, [recordingId]: null }));
  }, []);

  // Remove a row — ONLY allowed for a blank (empty/whitespace) row, so an
  // accidental "+ add track" can be undone. A real (non-empty) track has no ×
  // and can't be deleted (make it private instead).
  const handleTracklistRemoveBlank = useCallback((recordingId: string, index: number) => {
    setTracklistDrafts(prev => {
      const rows = prev[recordingId] ? [...prev[recordingId]] : [];
      if (!rows[index] || rows[index].text.trim() !== '') return prev; // guard: blanks only
      rows.splice(index, 1);
      return { ...prev, [recordingId]: rows };
    });
  }, []);

  // Move a row up/down one position (reorder). Saved order = displayed order.
  const handleTracklistMove = useCallback((recordingId: string, index: number, dir: -1 | 1) => {
    setTracklistDrafts(prev => {
      const rows = prev[recordingId] ? [...prev[recordingId]] : [];
      const to = index + dir;
      if (to < 0 || to >= rows.length) return prev; // at an edge
      [rows[index], rows[to]] = [rows[to], rows[index]];
      return { ...prev, [recordingId]: rows };
    });
  }, []);

  // Edit one row's text.
  const handleTracklistRowText = useCallback((recordingId: string, index: number, text: string) => {
    setTracklistDrafts(prev => {
      const rows = prev[recordingId] ? [...prev[recordingId]] : [];
      if (!rows[index]) return prev;
      rows[index] = { ...rows[index], text };
      return { ...prev, [recordingId]: rows };
    });
  }, []);

  // Toggle one row's private flag.
  const handleTracklistRowPrivate = useCallback((recordingId: string, index: number) => {
    setTracklistDrafts(prev => {
      const rows = prev[recordingId] ? [...prev[recordingId]] : [];
      if (!rows[index]) return prev;
      rows[index] = { ...rows[index], private: !rows[index].private };
      return { ...prev, [recordingId]: rows };
    });
  }, []);

  // Insert a new blank row at a given index (the "+ add track here" affordance) —
  // this is how a track is placed anywhere; there is no reorder control.
  const handleTracklistInsert = useCallback((recordingId: string, index: number) => {
    setTracklistDrafts(prev => {
      const rows = prev[recordingId] ? [...prev[recordingId]] : [];
      rows.splice(index, 0, { text: '', private: false });
      return { ...prev, [recordingId]: rows };
    });
  }, []);

  // Save the draft to the archive doc (owner-authorized by firestore.rules
  // uploadedBy == uid). Reject if any row is blank/whitespace — tracks can't be
  // deleted or emptied (make them private instead), so blanks never persist.
  const handleSaveTracklist = useCallback(async (recordingId: string) => {
    if (!db) return;
    const draft = tracklistDrafts[recordingId] || [];
    // Drop blank rows (an accidental "+ add" or a row left empty) — they carry
    // no data, so we simply don't persist them rather than blocking the save.
    // normalizeTrackIds trims, drops blanks, AND preserves the admin-set
    // djUsername tag (so a DJ editing text here can't strip a tag).
    const cleaned = normalizeTrackIds(draft.map(t => ({ ...t, text: t.text.trim() })));
    setSavingTracklistId(recordingId);
    setTracklistErrors(prev => ({ ...prev, [recordingId]: null }));
    try {
      await updateDoc(doc(db, 'archives', recordingId), { trackIds: cleaned });
      setRecordings(prev => prev.map(r => r.id === recordingId ? { ...r, trackIds: cleaned } : r));
      setTracklistDrafts(prev => { const next = { ...prev }; delete next[recordingId]; return next; });
    } catch (error) {
      console.error('Error saving tracklist:', error);
      setTracklistErrors(prev => ({ ...prev, [recordingId]: 'Failed to save tracklist' }));
    } finally {
      setSavingTracklistId(null);
    }
  }, [db, tracklistDrafts]);

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
      const genresArray = parseGenresInput(genres);

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
    residentAdvisor: string,
    website: string,
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
          instagram: instagram.trim() ? extractInstagramHandle(instagram) : null,
          soundcloud: soundcloud.trim() ? normalizeUrl(soundcloud.trim()) : null,
          bandcamp: normalizedBandcamp,
          youtube: youtube.trim() ? normalizeUrl(youtube.trim()) : null,
          bookingEmail: bookingEmail.trim() || null,
          residentAdvisor: residentAdvisor.trim() ? normalizeUrl(residentAdvisor.trim()) : null,
          website: website.trim() ? normalizeUrl(website.trim()) : null,
          customLinks: validCustomLinks.length > 0 ? validCustomLinks : null,
        },
      };
      await updateDoc(userRef, updateData);
      setSaveSocialSuccess(true);
      setTimeout(() => setSaveSocialSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving social links:", error);
    } finally {
      setSavingSocial(false);
    }
  }, [user]);

  // Fetch collective and DJ options for event selectors
  const fetchEventOptions = useCallback(async () => {
    if (!db) return;
    try {
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
          // Split the stored ms into date + time in LOCAL time, matching how
          // eventDateMs composes and saves it (and the local date label below).
          const dateObj = new Date(data.date);
          const pad = (n: number) => String(n).padStart(2, "0");
          const dateStr = `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
          const timeStr = `${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
          events.push({
            id: d.id,
            name: data.name || "",
            date: dateStr,
            startTime: timeStr,
            location: data.location || "",
            ticketLink: data.ticketLink || "",
            discountCode: data.discountCode || "",
            photo: data.photo || null,
            venueName: data.linkedVenues?.[0]?.venueName || data.venueName || "",
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

  // Compose the form's date + start time into a unix-ms timestamp, interpreting
  // the entry in the browser's LOCAL timezone (a bare datetime string with no
  // trailing Z parses as local). Start time defaults to 20:00 (8 PM local) when
  // the user leaves it untouched; if no date is picked, default to today so the
  // API never falls back to the current time. Matches the local basis used in
  // fetchDjEvents read-back.
  const eventDateMs = (): number => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const now = new Date();
    const dateStr = newEvent.date ||
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const ms = new Date(`${dateStr}T${newEvent.startTime || "20:00"}:00`).getTime();
    return isNaN(ms) ? now.getTime() : ms;
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
          date: eventDateMs(),
          location: newEvent.location.trim() || undefined,
          ticketLink: newEvent.ticketLink.trim() ? normalizeUrl(newEvent.ticketLink.trim()) : undefined,
          discountCode: newEvent.discountCode.trim() || undefined,
          photo: newEvent.photo || undefined,
          linkedVenues: newEvent.venueName.trim() ? [{ venueName: newEvent.venueName.trim() }] : undefined,
          linkedCollectives: newEvent.linkedCollectives.length > 0 ? newEvent.linkedCollectives : undefined,
          djs: newEvent.djs.filter(d => d.djName.trim()).length > 0 ? newEvent.djs.filter(d => d.djName.trim()) : undefined,
        }),
      });

      if (response.ok) {
        setNewEvent({ name: "", date: "", startTime: "20:00", location: "", ticketLink: "", discountCode: "", photo: null, venueName: "", linkedVenues: [], linkedCollectives: [], djs: [] });
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
          date: eventDateMs(),
          location: newEvent.location.trim() || null,
          ticketLink: newEvent.ticketLink.trim() ? normalizeUrl(newEvent.ticketLink.trim()) : null,
          discountCode: newEvent.discountCode.trim() || null,
          photo: newEvent.photo || null,
          linkedVenues: newEvent.venueName.trim() ? [{ venueName: newEvent.venueName.trim() }] : [],
          linkedCollectives: newEvent.linkedCollectives,
          djs: newEvent.djs.filter(d => d.djName.trim()),
        }),
      });

      if (response.ok) {
        setNewEvent({ name: "", date: "", startTime: "20:00", location: "", ticketLink: "", discountCode: "", photo: null, venueName: "", linkedVenues: [], linkedCollectives: [], djs: [] });
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
            djUsername: chatUsername ? normalizeUsername(chatUsername) : "",
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

  // Sharing consent toggles (YouTube/Google, SoundCloud, Instagram/Meta).
  // Writes immediately (no debounce — single click). Optimistically updates
  // local state; onSnapshot reconciles. Field names map directly to djProfile
  // keys: 'youtubeOptIn', 'soundcloudOptIn', or 'metaOptIn'.
  const saveSharingConsent = useCallback(
    async (field: 'youtubeOptIn' | 'soundcloudOptIn' | 'metaOptIn', optedIn: boolean) => {
      if (!user || !db) return;
      setDjProfile((prev) => ({ ...prev, [field]: optedIn }));
      try {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, { [`djProfile.${field}`]: optedIn });
      } catch (error) {
        console.error(`Error saving ${field}:`, error);
      }
    },
    [user]
  );

  // Save name (internal)
  const saveName = useCallback(async (name: string) => {
    if (!user || !db) return;
    setSavingName(true);
    setSaveNameSuccess(false);
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, { "djProfile.name": name.trim() || null });
      setSaveNameSuccess(true);
      setTimeout(() => setSaveNameSuccess(false), 2000);
    } catch (error) {
      console.error("Error saving name:", error);
    } finally {
      setSavingName(false);
    }
  }, [user]);

  // Auto-save name with debounce
  useEffect(() => {
    if (initialLoadRef.current) return;
    if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current);
    nameDebounceRef.current = setTimeout(() => saveName(nameInput), 1000);
    return () => { if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current); };
  }, [nameInput, saveName]);

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
      bookingEmailInput, residentAdvisorInput, websiteInput, customLinksInput
    ), 1000);
    return () => { if (socialDebounceRef.current) clearTimeout(socialDebounceRef.current); };
  }, [instagramInput, soundcloudInput, bandcampInput, youtubeInput, bookingEmailInput, residentAdvisorInput, websiteInput, customLinksInput, saveSocialLinks]);

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

  const handleShowImageChange = async (slotId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !db) return;

    setShowImageErrors(prev => ({ ...prev, [slotId]: null }));

    const validation = validatePhoto(file);
    if (!validation.valid) {
      setShowImageErrors(prev => ({ ...prev, [slotId]: validation.error || 'Invalid file' }));
      return;
    }

    setUploadingShowImageSlotId(slotId);

    try {
      const result = await uploadShowImage(slotId, file);

      if (!result.success) {
        setShowImageErrors(prev => ({ ...prev, [slotId]: result.error || 'Upload failed' }));
        return;
      }

      await updateDoc(doc(db, "broadcast-slots", slotId), {
        showImageUrl: result.url,
      });

      setUpcomingShows(prev => prev.map(s =>
        s.slotId === slotId ? { ...s, showImageUrl: result.url } : s
      ));
    } catch (error) {
      console.error("Error uploading show image:", error);
      setShowImageErrors(prev => ({ ...prev, [slotId]: 'Failed to upload image' }));
    } finally {
      setUploadingShowImageSlotId(null);
    }
  };

  const handleRemoveShowImage = async (slotId: string) => {
    if (!db) return;

    setUploadingShowImageSlotId(slotId);
    setShowImageErrors(prev => ({ ...prev, [slotId]: null }));

    try {
      await deleteShowImage(slotId);

      await updateDoc(doc(db, "broadcast-slots", slotId), {
        showImageUrl: null,
      });

      setUpcomingShows(prev => prev.map(s =>
        s.slotId === slotId ? { ...s, showImageUrl: undefined } : s
      ));
    } catch (error) {
      console.error("Error removing show image:", error);
      setShowImageErrors(prev => ({ ...prev, [slotId]: 'Failed to remove image' }));
    } finally {
      setUploadingShowImageSlotId(null);
    }
  };

  const handleStartEditShowName = (slotId: string, currentName: string) => {
    setEditingShowNameSlotId(slotId);
    setEditingShowNameValue(currentName);
    setShowNameError(null);
  };

  const handleCancelEditShowName = () => {
    setEditingShowNameSlotId(null);
    setEditingShowNameValue("");
    setShowNameError(null);
  };

  const handleSaveShowName = async (slotId: string) => {
    if (!db) return;
    const trimmed = editingShowNameValue.trim();
    if (!trimmed) {
      setShowNameError("Show name cannot be empty");
      return;
    }

    setSavingShowName(true);
    setShowNameError(null);

    try {
      await updateDoc(doc(db, "broadcast-slots", slotId), {
        showName: trimmed,
      });

      setUpcomingShows(prev => prev.map(s =>
        s.slotId === slotId ? { ...s, showName: trimmed } : s
      ));
      setEditingShowNameSlotId(null);
      setEditingShowNameValue("");
    } catch (error) {
      console.error("Error saving show name:", error);
      setShowNameError("Failed to save show name");
    } finally {
      setSavingShowName(false);
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

  const handleValidateCode = async () => {
    if (!inviteCode.trim()) {
      setCodeError("Please enter a code");
      return;
    }
    setCodeValidating(true);
    setCodeError("");
    try {
      const trimmed = inviteCode.trim();
      const res = await fetch("/api/validate-invite-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await res.json();
      if (data.valid) {
        setCodeValidated(true);
        // Stamp the code into the URL so it survives the magic-link round-trip
        // (AuthModal sets authRedirectTo to current location, /emailSignIn
        // returns here, and the URL-param effect re-validates).
        if (typeof window !== 'undefined') {
          window.history.replaceState(null, '', `/studio?code=${encodeURIComponent(trimmed)}`);
        }
      } else {
        setCodeError("Invalid code. Please try again.");
      }
    } catch {
      setCodeError("Something went wrong. Please try again.");
    } finally {
      setCodeValidating(false);
    }
  };

  const handleUpgradeToDJ = async () => {
    if (!user || !agreedToDJTerms) {
      setUpgradeError("Please accept the Artist Terms to continue");
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

  // Collective studio: a DJ who owns a collective toggled "Manage collective",
  // OR a collective-only owner (role:'user') whose /studio IS the collective
  // studio. Rendered BEFORE the isDJ(role) wall so a non-DJ owner isn't bounced.
  //
  // Compute the effective slug INLINE (not just from the managingCollectiveSlug
  // state, which the auto-enter effect sets one render late) so a collective-only
  // owner mounts the collective studio on the FIRST render. Without this, a
  // non-DJ owner flashes the DJ studio body for a frame.
  const effectiveCollectiveSlug =
    managingCollectiveSlug ||
    (isAuthenticated && ownedCollectiveSlugs.length > 0 && !isDJ(role)
      ? preferredCollectiveSlug()
      : null);
  if (isAuthenticated && effectiveCollectiveSlug) {
    return (
      <CollectiveStudioClient
        slug={effectiveCollectiveSlug}
        ownedSlugs={ownedCollectiveSlugs}
        onSwitchCollective={manageCollective}
        // Only offer "back to artist page" to actual DJs; a collective-only
        // owner has no personal studio to return to.
        onExit={isDJ(role) ? () => setManagingCollectiveSlug(null) : undefined}
      />
    );
  }

  // Not authenticated, or sign-in is in progress (keep AuthModal mounted until flow completes)
  if (!isAuthenticated || (signingInInline && !signInFlowComplete)) {
    // Code validated — show sign-up modal with DJ terms
    if (codeValidated) {
      return (
        <div className="min-h-screen bg-black">
          <Header currentPage="studio" position="sticky" />
          <main className="max-w-xl mx-auto p-4">
            <div className="text-center py-12">
              <h1 className="text-2xl font-semibold text-white mb-2">Studio</h1>
              <p className="text-gray-400 mb-8">
                {signingInInline ? 'Setting up your account...' : 'Create your account to get started'}
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

    // Not authenticated — show two options
    return (
      <div className="min-h-screen bg-black">
        <Header currentPage="studio" position="sticky" />
        <main className="max-w-4xl mx-auto p-4">
          <div className="text-center py-12">
            <h1 className="text-2xl font-semibold text-white mb-8">Studio</h1>

            <div className="max-w-sm mx-auto space-y-4">
              {!showCodeInput ? (
                <>
                  <button
                    onClick={() => setShowAuthModal(true)}
                    className="w-full bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors"
                  >
                    I already have an account
                  </button>
                  <button
                    onClick={() => setShowCodeInput(true)}
                    className="w-full border border-gray-700 text-white px-6 py-3 rounded-lg font-medium hover:bg-[#1e1e1e] transition-colors"
                  >
                    I have a code
                  </button>
                </>
              ) : (
                <div className="bg-[#1e1e1e] rounded-lg p-4 space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inviteCode}
                      onChange={(e) => { setInviteCode(e.target.value); setCodeError(""); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleValidateCode(); }}
                      placeholder="Enter your code"
                      className="flex-1 bg-black border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-white focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={handleValidateCode}
                      disabled={codeValidating}
                      className="bg-white text-black px-4 py-2 rounded font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
                    >
                      {codeValidating ? "..." : "Go"}
                    </button>
                  </div>
                  {codeError && <p className="text-red-400 text-sm">{codeError}</p>}
                  <button
                    onClick={() => { setShowCodeInput(false); setInviteCode(""); setCodeError(""); }}
                    className="text-gray-500 text-sm hover:text-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            <ResidentReferralSection residents={monthlyResidents} />
          </div>
        </main>

        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
        />
      </div>
    );
  }

  // Terms just accepted via inline sign-in — show loading while the grant
  // propagates. Excludes users already granted (DJ or collective). If the grant
  // never lands (grantGaveUp: e.g. a new email with no admin attribution), show
  // a dead-end message instead of spinning forever.
  if (!enteredStudio && djTermsJustAccepted && !grantGaveUp) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Setting up your account...</p>
        </div>
      </div>
    );
  }

  // Authenticated but not a DJ — show two options (code or apply). A collective
  // owner skips this entirely (they're mounted into the collective studio above;
  // this guard avoids flashing the DJ apply-wall before the auto-enter effect runs).
  if (!isDJ(role) && ownedCollectiveSlugs.length === 0) {
    // Code validated — show DJ terms acceptance and upgrade
    if (codeValidated) {
      return (
        <div className="min-h-screen bg-black">
          <Header currentPage="studio" position="sticky" />
          <main className="max-w-xl mx-auto p-4">
            <div className="py-8">
              <h1 className="text-2xl font-semibold text-white mb-2">Activate Artist Profile</h1>
              <p className="text-gray-400 mb-6">
                Accept the Artist Terms to unlock your artist profile and start broadcasting on Channel.
              </p>

              <div className="bg-[#1e1e1e] rounded-lg p-6">
                <label className="flex items-start gap-3 cursor-pointer mb-4">
                  <Checkbox
                    checked={agreedToDJTerms}
                    onChange={setAgreedToDJTerms}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-gray-300">
                    I have read and agree to the{" "}
                    <Link
                      href="/dj-terms"
                      target="_blank"
                      className="text-white underline hover:text-gray-300"
                    >
                      Artist Terms
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
                      Activating...
                    </>
                  ) : (
                    "Activate Artist Profile"
                  )}
                </button>
              </div>
            </div>
          </main>
        </div>
      );
    }

    // Show two options: code input or apply
    return (
      <div className="min-h-screen bg-black">
        <Header currentPage="studio" position="sticky" />
        <main className="max-w-4xl mx-auto p-4">
          <div className="text-center py-12">
            <h1 className="text-2xl font-semibold text-white mb-2">Studio</h1>
            <p className="text-gray-400 mb-8">
              Host a show on Channel
            </p>

            <div className="max-w-sm mx-auto space-y-4">
              {!showCodeInput ? (
                <button
                  onClick={() => setShowCodeInput(true)}
                  className="w-full bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors"
                >
                  I have a code
                </button>
              ) : (
                <div className="bg-[#1e1e1e] rounded-lg p-4 space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inviteCode}
                      onChange={(e) => { setInviteCode(e.target.value); setCodeError(""); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleValidateCode(); }}
                      placeholder="Enter your code"
                      className="flex-1 bg-black border border-gray-700 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-white focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={handleValidateCode}
                      disabled={codeValidating}
                      className="bg-white text-black px-4 py-2 rounded font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
                    >
                      {codeValidating ? "..." : "Go"}
                    </button>
                  </div>
                  {codeError && <p className="text-red-400 text-sm">{codeError}</p>}
                  <button
                    onClick={() => { setShowCodeInput(false); setInviteCode(""); setCodeError(""); }}
                    className="text-gray-500 text-sm hover:text-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            <ResidentReferralSection residents={monthlyResidents} />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <Header currentPage="studio" position="sticky" />

      <main className="max-w-xl mx-auto p-4">
        {/* Manage-collective toggle — only for a DJ who also owns a collective.
            Opens the preferred (last-managed) collective; the in-studio dropdown
            switches between them when they own more than one. */}
        {ownedCollectiveSlugs.length > 0 && (
          <div className="mb-4 flex justify-end">
            <button
              onClick={() => { const s = preferredCollectiveSlug(); if (s) manageCollective(s); }}
              className="text-gray-400 hover:text-white text-sm transition-colors border border-gray-700 rounded px-3 py-1.5"
            >
              {ownedCollectiveSlugs.length > 1
                ? "Manage your collectives →"
                : `Manage ${ownedCollectiveSlugs[0]} page →`}
            </button>
          </div>
        )}

        {/* Curator Name Setup Banner - shown when chatUsername is not set */}
        {!chatUsername && (
          <div className="mb-6 bg-gradient-to-r from-purple-900/50 to-blue-900/50 border border-purple-500/30 rounded p-4">
            <h2 className="text-white font-medium mb-1">Set Your Artist Name</h2>
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
                    placeholder="e.g., DJ 101"
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
                  Your profile URL will be: <span className="text-purple-400">/dj/{normalizeUsername(djNameInput.trim())}</span>
                </p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-8">
          {/* Profile section */}
          <section>
            <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-3">
              Profile
            </h2>
            <div className="bg-[#1e1e1e] rounded divide-y divide-gray-700/50">
              <div className="p-4 flex items-center justify-between">
                <span className="text-gray-400">Artist Name</span>
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
                    href={`/dj/${normalizeUsername(chatUsername)}`}
                    className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
                  >
                    /dj/{normalizeUsername(chatUsername)} &rarr;
                  </Link>
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-col sm:flex-row gap-3">
              {(() => {
                const hasImminentShow = upcomingShows.some(
                  s => !s.isExternal && s.startTime - Date.now() < 30 * 60 * 1000
                );
                const hasUpcomingOwnShow = upcomingShows.some(s => !s.isExternal);
                return (
                  <>
                    <button
                      onClick={() => setShowUploadModal(true)}
                      className="flex-1 block bg-gray-800 text-white text-center py-3 rounded font-medium hover:bg-gray-700 transition-colors border border-gray-700"
                    >
                      Upload a pre-recording
                    </button>
                    <Link
                      href="/record"
                      className={`flex-1 block text-white text-center py-3 rounded font-medium transition-colors border ${
                        hasUpcomingOwnShow && !hasImminentShow
                          ? "bg-green-600 hover:bg-green-500 border-green-500"
                          : "bg-gray-800 hover:bg-gray-700 border-gray-700"
                      }`}
                    >
                      Test audio capture
                    </Link>
                    {isResident && !hasUpcomingOwnShow && (
                      <Link
                        href="/studio/livestream"
                        className={`flex-1 block text-white text-center py-3 rounded font-medium transition-colors border ${
                          hasImminentShow
                            ? "bg-gray-800 hover:bg-gray-700 border-gray-700"
                            : "bg-green-600 hover:bg-green-500 border-green-500"
                        }`}
                      >
                        Book your next show
                      </Link>
                    )}
                  </>
                );
              })()}
            </div>
          </section>

          {/* Upcoming shows on Channel */}
          {(loadingBroadcasts || upcomingShows.length > 0) && (
          <section>
            <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-3">
              Upcoming Shows on Channel
            </h2>
            <div className="bg-[#1e1e1e] rounded">
              {loadingBroadcasts ? (
                <div className="p-4 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
                </div>
              ) : (
                <div className="divide-y divide-gray-700/50">
                  {upcomingShows.map((show) => {
                    const isRestream = show.broadcastType === "restream";
                    const canEdit = !show.isExternal && !!show.slotId && show.status !== "completed" && show.status !== "missed";
                    const isEditingName = editingShowNameSlotId === show.slotId;
                    const isUploadingImage = uploadingShowImageSlotId === show.slotId;
                    const showImageError = show.slotId ? showImageErrors[show.slotId] : null;
                    return (
                    <div key={show.id} className={`p-4 ${!show.isExternal && show.broadcastToken ? "bg-[#1a2a1a] border border-green-900/50 rounded-lg" : ""}`}>
                      {isEditingName && show.slotId ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editingShowNameValue}
                            onChange={(e) => setEditingShowNameValue(e.target.value)}
                            disabled={savingShowName}
                            className="w-full bg-[#2a2a2a] text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-white focus:outline-none"
                            autoFocus
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleSaveShowName(show.slotId!)}
                              disabled={savingShowName}
                              className="text-white bg-green-600 hover:bg-green-500 text-xs px-3 py-1 rounded disabled:opacity-50"
                            >
                              {savingShowName ? "Saving..." : "Save"}
                            </button>
                            <button
                              onClick={handleCancelEditShowName}
                              disabled={savingShowName}
                              className="text-gray-400 hover:text-white text-xs px-3 py-1 rounded disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                          {showNameError && (
                            <p className="text-red-400 text-xs">{showNameError}</p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <p className="font-medium">
                            <span className="text-gray-400">Show name: </span>
                            <span className="text-white">{show.showName}</span>
                          </p>
                          {canEdit && (
                            <button
                              onClick={() => handleStartEditShowName(show.slotId!, show.showName)}
                              className="inline-flex items-center gap-1 bg-white text-black hover:bg-gray-200 text-xs px-2 py-1 rounded transition-colors"
                              aria-label="Edit show name"
                              title="Edit show name"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              Edit
                            </button>
                          )}
                        </div>
                      )}
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
                              className="inline-flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white text-sm font-medium px-3 py-1 rounded transition-colors"
                            >
                              Go Live &rarr;
                            </Link>
                          )}
                        </div>
                      ) : !show.isExternal && show.broadcastToken ? (
                        (() => {
                          const isImminent = show.startTime - Date.now() < 30 * 60 * 1000;
                          return (
                            <Link
                              href={`/broadcast/live?token=${show.broadcastToken}`}
                              className={
                                isImminent
                                  ? "inline-flex items-center gap-2 mt-3 bg-green-600 hover:bg-green-500 text-white text-base font-medium px-8 py-4 rounded transition-colors"
                                  : "inline-flex items-center gap-2 mt-3 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2 rounded transition-colors border border-gray-700"
                              }
                            >
                              {isImminent ? "Go Live" : "Prepare to Go Live"} &rarr;
                            </Link>
                          );
                        })()
                      ) : null}
                      {canEdit && show.slotId && !isRestream && (
                        <div className="mt-3 bg-[#252525] rounded p-3">
                          <p className="text-gray-400 text-xs uppercase tracking-wide mb-2">Show Image</p>
                          <div className="flex items-center gap-4">
                            <div className="relative w-20 h-20 flex-shrink-0">
                              {show.showImageUrl ? (
                                <Image
                                  src={show.showImageUrl}
                                  alt="Show image"
                                  fill
                                  className="rounded object-cover"
                                />
                              ) : (
                                <div className="w-20 h-20 rounded bg-gray-800 flex items-center justify-center">
                                  <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                </div>
                              )}
                              {isUploadingImage && (
                                <div className="absolute inset-0 bg-black/50 rounded flex items-center justify-center">
                                  <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 space-y-2">
                              <label className="block">
                                <span className="sr-only">Choose show image</span>
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/gif,image/webp"
                                  onChange={(e) => handleShowImageChange(show.slotId!, e)}
                                  disabled={isUploadingImage}
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
                              {show.showImageUrl && (
                                <button
                                  onClick={() => handleRemoveShowImage(show.slotId!)}
                                  disabled={isUploadingImage}
                                  className="text-red-400 hover:text-red-300 text-sm transition-colors disabled:opacity-50"
                                >
                                  Remove image
                                </button>
                              )}
                            </div>
                          </div>
                          {showImageError && (
                            <p className="text-red-400 text-xs mt-2">{showImageError}</p>
                          )}
                          <p className="text-gray-500 text-xs mt-2">
                            JPG, PNG, GIF, or WebP. Max 10MB. Falls back to your DJ photo if left empty.
                          </p>
                        </div>
                      )}
                      {!show.isExternal && show.broadcastToken && !isRestream && (
                        <ShareableShowCardStory
                          showName={show.showName}
                          djName={show.djName || chatUsername || "DJ"}
                          startTime={show.startTime}
                          endTime={show.endTime}
                          imageUrl={show.showImageUrl || djProfile.photoUrl || show.djPhotoUrl || undefined}
                          genres={show.djGenres?.length ? show.djGenres : djProfile.genres.length ? djProfile.genres : undefined}
                          description={show.djDescription || djProfile.bio || undefined}
                        />
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
          )}

          {/* My Recordings section */}
          <section>
            <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1">
              My Recordings
            </h2>
            <div className="bg-[#1e1e1e] rounded">
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
                  {recordings.map((recording) => {
                    // Booked into an upcoming anchor/restream slot → the DJ can't
                    // edit or delete it out from under the broadcast; hide the
                    // edit affordances and show a notice instead.
                    const isScheduled = scheduledArchiveIds.has(recording.id);
                    const canEditImage = recording.source === 'archive' && recording.sourceType !== 'live' && !isScheduled;
                    // Tracklist is editable on ANY of the artist's own archive
                    // recordings — including live ones (they get YouTube claims).
                    const canEditTracklist = recording.source === 'archive' && !isScheduled;
                    const isUploadingImage = uploadingRecordingImageId === recording.id;
                    const imageError = recordingImageErrors[recording.id];
                    return (
                    <div key={recording.id} className="bg-[#252525] rounded p-3">
                      <div className="flex items-center gap-3">
                        {/* Cover image + play overlay */}
                        <div className="relative w-12 h-12 flex-shrink-0">
                          {recording.showImageUrl ? (
                            <Image
                              src={recording.showImageUrl}
                              alt=""
                              fill
                              className="rounded object-cover"
                              sizes="48px"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded bg-gray-800" />
                          )}
                          <button
                            onClick={() => handlePlayPauseRecording(recording.id)}
                            disabled={!recording.audioUrl}
                            aria-label={playingRecordingId === recording.id ? 'Pause' : 'Play'}
                            className="absolute inset-0 flex items-center justify-center rounded bg-black/40 hover:bg-black/55 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {playingRecordingId === recording.id ? (
                              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            )}
                          </button>
                          {canEditImage && (
                            <label
                              className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white text-black flex items-center justify-center cursor-pointer shadow hover:bg-gray-100 ${isUploadingImage ? 'opacity-50 cursor-not-allowed' : ''}`}
                              title={recording.showImageUrl ? 'Change cover image' : 'Add cover image'}
                            >
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/gif,image/webp"
                                onChange={(e) => handleRecordingImageChange(recording.id, e)}
                                disabled={isUploadingImage}
                                className="sr-only"
                              />
                              {isUploadingImage ? (
                                <span className="w-2.5 h-2.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                              )}
                            </label>
                          )}
                        </div>

                        {/* Content and progress */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              {editingRecordingId === recording.id ? (
                                <div className="space-y-1.5">
                                  <input
                                    type="text"
                                    value={editingRecordingName}
                                    onChange={(e) => setEditingRecordingName(e.target.value.slice(0, 100))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveRecordingName(recording.id);
                                      if (e.key === 'Escape') handleCancelEditRecordingName();
                                    }}
                                    disabled={savingRecordingName}
                                    autoFocus
                                    className="w-full bg-[#2a2a2a] text-white text-sm px-2 py-1 rounded border border-gray-700 focus:border-white focus:outline-none"
                                  />
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => handleSaveRecordingName(recording.id)}
                                      disabled={savingRecordingName}
                                      className="text-white bg-green-600 hover:bg-green-500 text-xs px-2.5 py-0.5 rounded disabled:opacity-50"
                                    >
                                      {savingRecordingName ? 'Saving...' : 'Save'}
                                    </button>
                                    <button
                                      onClick={handleCancelEditRecordingName}
                                      disabled={savingRecordingName}
                                      className="text-gray-400 hover:text-white text-xs px-2.5 py-0.5 rounded disabled:opacity-50"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                  {recordingNameError && (
                                    <p className="text-red-400 text-xs">{recordingNameError}</p>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <h3 className="text-white font-semibold text-sm truncate">{recording.showName}</h3>
                                  {recording.source === 'archive' && recording.sourceType !== 'live' && !isScheduled && (
                                    <button
                                      onClick={() => handleStartEditRecordingName(recording.id, recording.showName)}
                                      className="text-gray-500 hover:text-white text-xs transition-colors flex-shrink-0"
                                      aria-label="Edit recording name"
                                      title="Edit name"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              )}
                              <p className="text-gray-500 text-xs">
                                {formatRecordingDate(recording.createdAt)} · {formatDuration(recording.duration)}
                                {recording.sourceType === 'live' ? (
                                  <span className="text-red-400 ml-2">· Live recording</span>
                                ) : recording.isPublic ? (
                                  <span className="text-green-400 ml-2">· Published</span>
                                ) : (
                                  <span className="text-gray-500 ml-2">· Private</span>
                                )}
                                {isScheduled && (
                                  <span className="text-amber-400 ml-2">· Scheduled</span>
                                )}
                              </p>
                            </div>
                            {/* Action buttons */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {/* Publish/Unpublish button — not for live recordings
                                  (they're already public broadcasts), and locked
                                  once the show is booked into a slot. */}
                              {recording.sourceType !== 'live' && !isScheduled && (
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
                              )}

                              {/* Delete button — hidden for live broadcast
                                  recordings, and for archives this user no
                                  longer owns (owner reassigned away). Session
                                  recs have no owner field → uploader is owner. */}
                              {recording.sourceType !== 'live'
                                && !isScheduled
                                && (recording.source !== 'archive' || recording.ownerUserId === user?.uid) && (
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

                      {/* Locked notice — this recording is already booked into an
                          upcoming anchor/restream slot, so editing/deleting is
                          disabled and the DJ is pointed to Cap. */}
                      {isScheduled && (
                        <p className="text-amber-400/90 text-xs mt-2">
                          {SCHEDULED_LOCK_MESSAGE}
                        </p>
                      )}

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
                      {imageError && (
                        <p className="text-red-400 text-xs mt-2">{imageError}</p>
                      )}
                      {canEditImage && recording.showImageUrl && !isUploadingImage && (
                        <button
                          onClick={() => handleRemoveRecordingImage(recording.id)}
                          className="text-red-400 hover:text-red-300 text-xs mt-2 transition-colors"
                        >
                          Remove image
                        </button>
                      )}

                      {/* Tracklist editor — any of the artist's own archive
                          recordings, INCLUDING live (owner-editable via
                          firestore.rules uploadedBy == uid). Rows are editable
                          text; a row can be made private (shown as "Private track
                          ID" publicly) but not deleted or left blank. New tracks are
                          slid in via the "+ add" buttons between rows. */}
                      {canEditTracklist && (() => {
                        const draft = tracklistDrafts[recording.id];
                        const isEditing = draft !== undefined;
                        const rows = isEditing ? draft : (recording.trackIds || []);
                        const err = tracklistErrors[recording.id];
                        return (
                          <div className="mt-3 pt-3 border-t border-[#333]">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-gray-400 text-[10px] uppercase tracking-wide">Tracklist</span>
                              {!isEditing ? (
                                <button
                                  onClick={() => handleStartEditTracklist(recording)}
                                  className="text-gray-400 hover:text-white text-xs transition-colors"
                                >
                                  Edit
                                </button>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleCancelEditTracklist(recording.id)}
                                    className="text-gray-400 hover:text-white text-xs transition-colors"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleSaveTracklist(recording.id)}
                                    disabled={savingTracklistId === recording.id}
                                    className="text-green-400 hover:text-green-300 text-xs transition-colors disabled:opacity-50"
                                  >
                                    {savingTracklistId === recording.id ? 'Saving…' : 'Save'}
                                  </button>
                                </div>
                              )}
                            </div>

                            {!isEditing ? (
                              rows.length > 0 ? (
                                <ol className="space-y-1">
                                  {rows.map((t, i) => (
                                    <li key={i} className={`flex gap-2 text-xs ${t.private ? 'text-gray-500 italic' : 'text-gray-300'}`}>
                                      <span className="text-gray-600 tabular-nums">{i + 1}.</span>
                                      <span>{t.text}</span>
                                      {t.private && <span className="text-gray-600">(private)</span>}
                                    </li>
                                  ))}
                                </ol>
                              ) : (
                                <p className="text-gray-600 text-xs">No tracklist yet — click Edit to add tracks.</p>
                              )
                            ) : (
                              <div className="space-y-1.5">
                                {/* insert-at-top */}
                                <button
                                  onClick={() => handleTracklistInsert(recording.id, 0)}
                                  className="w-full text-gray-600 hover:text-gray-300 text-[11px] transition-colors text-left"
                                >
                                  + add track here
                                </button>
                                {rows.map((t, i) => (
                                  <div key={i}>
                                    <div className="flex items-center gap-2">
                                      <span className="text-gray-600 tabular-nums text-xs w-5">{i + 1}.</span>
                                      {/* Reorder up/down (saved order = displayed order). */}
                                      <div className="flex flex-col -my-0.5">
                                        <button
                                          onClick={() => handleTracklistMove(recording.id, i, -1)}
                                          disabled={i === 0}
                                          title="Move up"
                                          aria-label="Move track up"
                                          className="text-gray-500 hover:text-white disabled:opacity-25 disabled:hover:text-gray-500 leading-none text-[10px]"
                                        >
                                          ▲
                                        </button>
                                        <button
                                          onClick={() => handleTracklistMove(recording.id, i, 1)}
                                          disabled={i === rows.length - 1}
                                          title="Move down"
                                          aria-label="Move track down"
                                          className="text-gray-500 hover:text-white disabled:opacity-25 disabled:hover:text-gray-500 leading-none text-[10px]"
                                        >
                                          ▼
                                        </button>
                                      </div>
                                      <input
                                        value={t.text}
                                        onChange={(e) => handleTracklistRowText(recording.id, i, e.target.value)}
                                        placeholder="Artist – Track"
                                        className={`flex-1 bg-[#2a2a2a] border border-gray-700 focus:border-white rounded px-2 py-1 text-xs text-white focus:outline-none ${t.private ? 'italic text-gray-400' : ''}`}
                                      />
                                      <button
                                        onClick={() => handleTracklistRowPrivate(recording.id, i)}
                                        title={t.private ? 'Private — click to make public' : 'Make private'}
                                        className={`text-xs px-1.5 py-1 rounded transition-colors ${t.private ? 'text-yellow-500 hover:text-yellow-400' : 'text-gray-500 hover:text-gray-300'}`}
                                      >
                                        {t.private ? '🔒 Private' : '👁 Public'}
                                      </button>
                                      {/* Remove — only for a blank row (undo an
                                          accidental add). Non-empty tracks can't be
                                          deleted; make them private instead. */}
                                      {t.text.trim() === '' && (
                                        <button
                                          onClick={() => handleTracklistRemoveBlank(recording.id, i)}
                                          title="Remove empty row"
                                          aria-label="Remove empty row"
                                          className="text-gray-500 hover:text-red-400 text-sm px-1.5 py-1 transition-colors"
                                        >
                                          ×
                                        </button>
                                      )}
                                    </div>
                                    {/* insert-after-this-row */}
                                    <button
                                      onClick={() => handleTracklistInsert(recording.id, i + 1)}
                                      className="w-full text-gray-600 hover:text-gray-300 text-[11px] transition-colors text-left pl-7 mt-1"
                                    >
                                      + add track here
                                    </button>
                                  </div>
                                ))}
                                {err && <p className="text-red-400 text-xs mt-1">{err}</p>}
                                <p className="text-gray-600 text-[10px] mt-1">Empty rows are removed on save. To hide a track, make it private rather than deleting it.</p>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Sharing consent section. All default = opted in. YouTube and
              SoundCloud opt-outs hide archives from /broadcast/admin → Social
              Render; Meta is stored only (placeholder for future
              enforcement). */}
          <section>
            <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-3">
              Sharing
            </h2>
            <div className="bg-[#1e1e1e] rounded p-4 space-y-3">
              <p className="text-sm text-white">
                I&apos;m OK with my shows&apos; audio and visuals being used
              </p>
              <label className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  size="sm"
                  checked={djProfile.youtubeOptIn !== false}
                  onChange={(v) => saveSharingConsent('youtubeOptIn', v)}
                />
                <span className="text-sm text-white">on YouTube and Google platforms</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  size="sm"
                  checked={djProfile.soundcloudOptIn !== false}
                  onChange={(v) => saveSharingConsent('soundcloudOptIn', v)}
                />
                <span className="text-sm text-white">on SoundCloud</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  size="sm"
                  checked={djProfile.metaOptIn !== false}
                  onChange={(v) => saveSharingConsent('metaOptIn', v)}
                />
                <span className="text-sm text-white">on Instagram and Meta platforms</span>
              </label>
            </div>
          </section>

          {/* Profile Photo section */}
          <section>
            <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-3">
              Profile Photo
            </h2>
            <div className="bg-[#1e1e1e] rounded p-4">
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
            <p className="text-gray-500 text-xs mt-2 px-1">
              JPG, PNG, GIF, or WebP. Max 10MB. Appears during your live broadcasts and on your public profile.
            </p>
          </section>

          {/* Location & Genres section */}
          <section>
            <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <svg className="w-3 h-3" viewBox="0 0 24 36" fill="none">
                <circle cx="12" cy="12" r="10" fill="#ef4444" />
                <line x1="12" y1="22" x2="12" y2="35" stroke="#6b7280" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Location & Genres
            </h2>
            <div className="bg-[#1e1e1e] rounded p-4 space-y-4">
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
                  <span className="text-gray-500 text-xs">
                    {savingDetails ? "Saving..." : saveDetailsSuccess ? "Saved" : ""}
                  </span>
                  <span className="text-gray-500 text-xs">
                    Separate genres with commas
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Support Button Link section */}
          <section>
            <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1 flex items-center gap-1.5">
              <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
              </svg>
              Support Button Link
            </h2>
            <p className="text-gray-500 text-xs mb-3 px-1">
              Where listeners go when they click Support. Falls back to your Bandcamp link.
            </p>
            <div className="bg-[#1e1e1e] rounded p-4 space-y-4">
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
                  <span className="text-gray-500 text-xs">
                    {savingTipButtonLink ? "Saving..." : saveTipButtonLinkSuccess ? "Saved" : ""}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* About section */}
          <section>
            <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1 flex items-center gap-1.5">
              <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path strokeLinecap="round" d="M12 16v-4m0-4h.01" />
              </svg>
              About
            </h2>
            <p className="text-gray-500 text-xs mb-3 px-1">
              Your bio appears on your public artist profile and during broadcasts.
            </p>
            <div className="bg-[#1e1e1e] rounded p-4 space-y-4">
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
                  <span className="text-gray-500 text-xs">
                    {savingAbout ? "Saving..." : saveAboutSuccess ? "Saved" : ""}
                  </span>
                  <span className="text-gray-500 text-xs">
                    {bioInput.length}/500
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Social Links section */}
          <section>
            <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1">
              Social Links
            </h2>
            <p className="text-gray-500 text-xs mb-3 px-1">
              These links appear on your public artist profile.
            </p>
            <div className="bg-[#1e1e1e] rounded p-4 space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Instagram
                </label>
                <input
                  type="text"
                  value={instagramInput}
                  onChange={(e) => setInstagramInput(e.target.value)}
                  placeholder="@yourhandle or instagram.com/yourhandle"
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
                  Website
                </label>
                <input
                  type="text"
                  value={websiteInput}
                  onChange={(e) => setWebsiteInput(e.target.value)}
                  placeholder="https://yourname.com"
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
                <p className="text-gray-500 text-xs mt-2">
                  {savingSocial ? "Saving..." : saveSocialSuccess ? "Saved" : ""}
                </p>
              </div>
            </div>
          </section>

          {/* IRL Events section */}
          <section>
            <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1 flex items-center gap-1.5">
              <svg className="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2L8 8h2v3H8l-4 6h5v5h2v-5h5l-4-6h-2V8h2L12 2z" />
              </svg>
              IRL Events
            </h2>
            <p className="text-gray-500 text-xs mb-3 px-1">
              Promote your upcoming in-person gigs. Events appear on your profile and on linked scene pages.
            </p>
            <div className="bg-[#1e1e1e] rounded p-4 space-y-3">
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
                        <p className="text-gray-500 text-xs mt-0.5">
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
                <p className="text-gray-500 text-xs text-center py-2">No events yet.</p>
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
                    <input type="text" value={newEvent.name} onChange={(e) => setNewEvent(prev => ({ ...prev, name: e.target.value }))} placeholder="Event Name" className="flex-1 bg-[#1e1e1e] border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none" />
                    <input type="text" value={newEvent.location} onChange={(e) => setNewEvent(prev => ({ ...prev, location: e.target.value }))} placeholder="City" className="w-32 bg-[#1e1e1e] border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none" />
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={newEvent.ticketLink} onChange={(e) => setNewEvent(prev => ({ ...prev, ticketLink: e.target.value }))} placeholder="Ticket URL (e.g., ra.co/events/...)" className="flex-1 bg-[#1e1e1e] border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none" />
                    <input type="date" value={newEvent.date} onChange={(e) => setNewEvent(prev => ({ ...prev, date: e.target.value }))} className="w-36 bg-[#1e1e1e] border border-gray-800 rounded px-3 py-2 text-white focus:border-gray-600 focus:outline-none [color-scheme:dark]" />
                    <input type="time" value={newEvent.startTime} onChange={(e) => setNewEvent(prev => ({ ...prev, startTime: e.target.value }))} className="w-28 bg-[#1e1e1e] border border-gray-800 rounded px-3 py-2 text-white focus:border-gray-600 focus:outline-none [color-scheme:dark]" />
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={newEvent.discountCode} onChange={(e) => setNewEvent(prev => ({ ...prev, discountCode: e.target.value }))} placeholder="Discount code (optional)" className="flex-1 bg-[#1e1e1e] border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none" />
                  </div>
                  {/* Venue — free text */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newEvent.venueName}
                      onChange={(e) => setNewEvent(prev => ({ ...prev, venueName: e.target.value }))}
                      placeholder="Venue"
                      className="flex-1 bg-[#1e1e1e] border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                    />
                  </div>
                  {/* Linked Collectives — search available collectives or type a new name */}
                  <CreatableChipField<{ id: string; name: string }, { collectiveId: string; collectiveName: string }>
                    label="Collectives"
                    options={collectiveOptions}
                    selected={newEvent.linkedCollectives}
                    optionLabel={(c) => c.name}
                    selectedLabel={(s) => s.collectiveName}
                    optionKey={(c) => c.id}
                    selectedKey={(s) => s.collectiveId || normalizeUsername(s.collectiveName)}
                    toSelected={(c) => ({ collectiveId: c.id, collectiveName: c.name })}
                    freeTextToSelected={(text) => ({ collectiveId: "", collectiveName: text })}
                    onChange={(next) => setNewEvent(prev => ({ ...prev, linkedCollectives: next }))}
                    placeholder="Search a collective, or type a new name"
                  />
                  {/* Tagged DJs — search available DJs or type a new name */}
                  <CreatableChipField<{ label: string; djName: string; djUserId?: string; djUsername?: string; djPhotoUrl?: string }, { djName: string; djUserId?: string; djUsername?: string; djPhotoUrl?: string }>
                    label="Tagged DJs"
                    options={djOptions}
                    selected={newEvent.djs}
                    optionLabel={(o) => o.label}
                    selectedLabel={(s) => s.djUsername ? `${s.djName} @${s.djUsername}` : s.djName}
                    optionKey={(o) => o.djUserId || o.djUsername || normalizeUsername(o.djName)}
                    selectedKey={(s) => s.djUserId || s.djUsername || normalizeUsername(s.djName)}
                    toSelected={(o) => ({ djName: o.djName, djUserId: o.djUserId, djUsername: o.djUsername, djPhotoUrl: o.djPhotoUrl })}
                    freeTextToSelected={(text) => ({ djName: text })}
                    onChange={(next) => setNewEvent(prev => ({ ...prev, djs: next }))}
                    placeholder="Search a DJ, or type a new name"
                  />
                  {/* Error display */}
                  {eventError && (
                    <p className="text-red-400 text-xs">{eventError}</p>
                  )}
                  {/* Action buttons */}
                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={editingEventId ? updateEvent : createEvent} disabled={savingNewEvent || !newEvent.name.trim()} className="px-4 py-2 bg-white text-black text-xs font-medium rounded hover:bg-gray-200 transition-colors disabled:opacity-50">
                      {savingNewEvent ? "Saving..." : editingEventId ? "Update Event" : "Create Event"}
                    </button>
                    <button type="button" onClick={() => { setShowNewEventForm(false); setEditingEventId(null); setEventError(null); setNewEvent({ name: "", date: "", startTime: "20:00", location: "", ticketLink: "", discountCode: "", photo: null, venueName: "", linkedVenues: [], linkedCollectives: [], djs: [] }); }} className="px-4 py-2 text-gray-400 hover:text-white text-xs transition-colors">
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
            <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1 flex items-center gap-1.5">
              <svg className="w-3 h-3 text-sky-300" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
              </svg>
              Radio Shows
            </h2>
            <p className="text-gray-500 text-xs mb-3 px-1">
              Promote your upcoming radio appearances on other stations.
            </p>
            <div className="bg-[#1e1e1e] rounded p-4 space-y-4">
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
              <p className="text-gray-500 text-xs">
                {savingRadioShows ? "Saving..." : saveRadioShowsSuccess ? "Saved" : ""}
              </p>
            </div>
          </section>

          {/* My Recs section */}
          <section>
            <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1 flex items-center gap-1.5">
              <svg className="w-3 h-3 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
              Shoutouts
            </h2>
            <p className="text-gray-500 text-xs mb-3 px-1">
              Share music, IRL shows, and online shows you recommend with your listeners.
            </p>
            <div className="bg-[#1e1e1e] rounded p-4 space-y-4">
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
              <p className="text-gray-500 text-xs">
                {savingMyRecs ? "Saving..." : saveMyRecsSuccess ? "Saved" : ""}
              </p>
            </div>
          </section>

          {/* Name (internal) section */}
          <section>
            <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1">
              Name
            </h2>
            <p className="text-gray-500 text-xs mb-3 px-1">
              For internal purposes only. Not displayed on your profile.
            </p>
            <div className="bg-[#1e1e1e] rounded p-4">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Your name"
                maxLength={100}
                className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
              />
              <p className="text-gray-500 text-xs mt-1">
                {savingName ? "Saving..." : saveNameSuccess ? "Saved" : ""}
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
      {/* z-[9000] so it sits above the sticky Header/GlobalBroadcastBar (z-[100]),
          otherwise the player overlaps the top of the modal (title + name field). */}
      {showUploadModal && (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70"
            onClick={!uploading ? closeUploadModal : undefined}
          />

          {/* Modal — capped height + scroll so the Upload button is never cut off */}
          <div className="relative bg-[#1e1e1e] rounded-xl w-full max-w-md p-6 border border-gray-800 max-h-[90vh] overflow-y-auto">
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

            {/* Tempo / category picker (optional) */}
            <div className="mb-4">
              <label className="text-gray-400 text-sm mb-1 block">
                Tempo <span className="text-gray-600">(optional)</span>
              </label>
              <select
                value={uploadTempo}
                onChange={(e) => setUploadTempo((e.target.value as Tempo) || '')}
                disabled={uploading}
                className="w-full bg-[#252525] text-white rounded px-3 py-2 text-sm border border-gray-700 focus:border-gray-500 focus:outline-none disabled:opacity-50"
              >
                <option value="">Select a tempo…</option>
                {TEMPOS.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* File picker */}
            <div className="mb-4">
              <label className="text-gray-400 text-sm mb-1 block">Audio file</label>
              <p className="text-gray-500 text-xs mb-1.5">MP3 or MP4 formats preferred · max 1500MB</p>
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

            {/* Optional cover image */}
            <div className="mb-4">
              <label className="text-gray-400 text-sm mb-1 block">
                Cover image <span className="text-gray-600">(optional)</span>
              </label>
              <div className="flex items-start gap-3">
                <div className="relative w-16 h-16 flex-shrink-0">
                  {uploadImagePreview ? (
                    <Image
                      src={uploadImagePreview}
                      alt="Cover preview"
                      fill
                      className="rounded object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="w-16 h-16 rounded bg-[#252525] flex items-center justify-center">
                      <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    onChange={handleUploadImageChange}
                    disabled={uploading}
                    className="block w-full text-sm text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-gray-800 file:text-white hover:file:bg-gray-700 file:cursor-pointer disabled:opacity-50"
                  />
                  {uploadImageFile && !uploading && (
                    <button
                      type="button"
                      onClick={clearUploadImage}
                      className="text-red-400 hover:text-red-300 text-xs transition-colors"
                    >
                      Remove image
                    </button>
                  )}
                </div>
              </div>
              {uploadImageError && (
                <p className="text-red-400 text-xs mt-2">{uploadImageError}</p>
              )}
              <p className="text-gray-500 text-xs mt-2">
                JPG, PNG, GIF, or WebP. Max 10MB. Falls back to your DJ photo if left empty.
              </p>
            </div>

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
                I confirm that I am the artist (or authorized representative) known as <span className="text-white font-medium">{chatUsername || 'Artist'}</span>, under whose name this upload is being made.
              </p>
              <p className="text-gray-300 text-sm mb-3">
                By uploading this recording, I represent and warrant that:
              </p>
              <ul className="text-gray-400 text-sm space-y-1 mb-4 ml-1">
                <li>• I am responsible for ensuring the content complies with applicable laws.</li>
                <li>• Channel may use this recording, replay it, and make it available on Channel websites and radio.</li>
                <li>• All artists featured in this recording are aware of and consent to its use on Channel.</li>
              </ul>
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  size="sm"
                  checked={uploadTermsConfirmed}
                  onChange={setUploadTermsConfirmed}
                  disabled={uploading}
                  className="mt-0.5"
                />
                <span className="text-gray-300 text-sm">
                  I confirm and agree to the{' '}
                  <a
                    href="/dj-terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white underline hover:text-gray-300"
                  >
                    Artist Terms
                  </a>
                </span>
              </label>
            </div>

            {/* Why is Upload disabled? Surface the exact blocker so a greyed-out
                button is never a mystery to the DJ (or to us when they email).
                Mirrors the button's disabled conditions below, same order. */}
            {!uploading && (() => {
              const reason =
                !uploadFile ? 'Choose an audio file to upload.' :
                detectingDuration ? 'Reading the audio file…' :
                uploadDuration === null ? 'Couldn’t read this file’s length — try re-exporting it as an MP3 or M4A.' :
                !uploadShowName.trim() ? 'Add a recording name.' :
                !uploadTermsConfirmed ? 'Check the box to agree to the Artist Terms.' :
                (uploadQuotaRemaining !== null && uploadDuration > uploadQuotaRemaining)
                  ? `This file is ${Math.ceil(uploadDuration / 60)} min but you have ${Math.floor(uploadQuotaRemaining / 60)} min left this month.` :
                null;
              return reason ? (
                <p className="text-amber-400/90 text-xs mb-3">{reason}</p>
              ) : null;
            })()}

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
