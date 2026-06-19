'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { BroadcastSlotSerialized, BroadcastType, DJSlot, DJProfileInfo, Recording, Archive, ArchiveDJ } from '@/types/broadcast';
import { uploadShowImage, validatePhoto } from '@/lib/photo-upload';
import { priorityIsHigh } from '@/lib/archive-priority';

type SlotModalTab = 'new-show' | 'archives';

interface SlotModalProps {
  slot?: BroadcastSlotSerialized | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    showName: string;
    djName?: string;
    djEmail?: string;
    djSlots?: DJSlot[];
    startTime: number;
    endTime: number;
    broadcastType: BroadcastType;
    showImageUrl?: string;
    // Restream fields
    archiveId?: string;
    archiveRecordingUrl?: string;
    archiveDuration?: number;
    restreamDjs?: ArchiveDJ[];
    // Curated archive that plays at the radio loop anchor right after this
    // slot's contiguous live block ends. Empty string clears the curation.
    postLiveArchiveId?: string;
    // Suppress go-live emails for this slot — used when testing a real
    // go-live so real subscribers aren't emailed.
    goLiveEmailsDisabled?: boolean;
  }) => Promise<void>;
  onDelete?: (slotId: string) => Promise<void>;
  initialStartTime?: Date;
  initialEndTime?: Date;
  // Full schedule, used by the restream "end right before next slot" toggle to
  // find the next scheduled slot and back-fit this restream's start.
  allSlots?: BroadcastSlotSerialized[];
}

// Individual DJ profile for B3B (with UI state)
interface LocalDJProfile {
  email: string;
  userId?: string;
  username?: string;
  usernameNormalized?: string;
  bio?: string;
  photoUrl?: string;
  thankYouMessage?: string;
  socialLinks?: {
    soundcloud?: string;
    instagram?: string;
    youtube?: string;
  };
  // UI state
  profileFound?: boolean;
  isLookingUp?: boolean;
}

interface LocalDJSlot {
  id: string;
  djName: string;
  startDate: string; // YYYY-MM-DD format
  startTime: string; // HH:mm format
  endDate: string;   // YYYY-MM-DD format
  endTime: string;   // HH:mm format
  // Legacy single-DJ fields (backwards compatibility, populated from first profile)
  djEmail?: string;
  djUserId?: string;
  djUsername?: string;
  djBio?: string;
  djPhotoUrl?: string;
  djThankYouMessage?: string;
  djSocialLinks?: {
    soundcloud?: string;
    instagram?: string;
    youtube?: string;
  };
  // UI state for legacy single-DJ
  profileFound?: boolean;
  isLookingUp?: boolean;
  // B3B support: multiple DJ profiles
  djProfiles: LocalDJProfile[];
}

// Generate time options in 30-minute increments with simple labels
function generateTimeOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const value = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const ampm = hour < 12 ? 'am' : 'pm';
      // Simpler format: "8pm" or "8:30pm"
      const label = minute === 0 ? `${hour12}${ampm}` : `${hour12}:${minute}${ampm}`;
      options.push({ value, label });
    }
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

// Snap time string to nearest 30-minute increment
function snapToHalfHour(timeStr: string): string {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const snappedMinutes = Math.round(minutes / 30) * 30;
  if (snappedMinutes === 60) {
    return `${((hours + 1) % 24).toString().padStart(2, '0')}:00`;
  }
  return `${hours.toString().padStart(2, '0')}:${snappedMinutes.toString().padStart(2, '0')}`;
}

// Convert date + time to timestamp
function dateTimeToTimestamp(date: string, time: string): number {
  return new Date(`${date}T${time}`).getTime();
}

// Convert timestamp to date string (YYYY-MM-DD)
function timestampToDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

// Convert timestamp to time string (HH:mm)
function timestampToTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// Human-readable duration: "1h13m" / "47m" / "2h05m".
function formatDuration(totalSeconds: number): string {
  const mins = Math.round(totalSeconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h${m.toString().padStart(2, '0')}m`;
}

// Second-accurate clock label, e.g. "9:14:07pm" — shown for restream slots so
// the admin can see (and trust) that the slot ends to the second, not the
// 30-min grid the dropdowns are limited to.
function formatExactClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).toLowerCase().replace(/\s/g, '');
}

// Adjust DJ slots to fit within show boundaries (works with full date+time)
function adjustDjSlotsToShowBounds(
  djSlots: LocalDJSlot[],
  showStartDate: string,
  showStartTime: string,
  showEndDate: string,
  showEndTime: string
): LocalDJSlot[] {
  if (djSlots.length === 0) return djSlots;

  const showStartTs = dateTimeToTimestamp(showStartDate, showStartTime);
  const showEndTs = dateTimeToTimestamp(showEndDate, showEndTime);

  return djSlots.map(dj => {
    let djStartTs = dateTimeToTimestamp(dj.startDate, dj.startTime);
    let djEndTs = dateTimeToTimestamp(dj.endDate, dj.endTime);

    // Clamp DJ start time to show bounds
    if (djStartTs < showStartTs) {
      djStartTs = showStartTs;
    }
    if (djStartTs > showEndTs) {
      djStartTs = showEndTs;
    }

    // Clamp DJ end time to show bounds
    if (djEndTs < showStartTs) {
      djEndTs = showStartTs;
    }
    if (djEndTs > showEndTs) {
      djEndTs = showEndTs;
    }

    // Ensure end is after start (minimum 30 min slot)
    if (djEndTs <= djStartTs) {
      djEndTs = Math.min(djStartTs + 30 * 60 * 1000, showEndTs);
    }

    return {
      ...dj,
      startDate: timestampToDate(djStartTs),
      startTime: snapToHalfHour(timestampToTime(djStartTs)),
      endDate: timestampToDate(djEndTs),
      endTime: snapToHalfHour(timestampToTime(djEndTs)),
    };
  });
}

// Ensure DJ slots cover the entire show time, filling gaps with empty DJ slots
function ensureFullCoverage(
  djSlots: LocalDJSlot[],
  showStartDate: string,
  showStartTime: string,
  showEndDate: string,
  showEndTime: string
): LocalDJSlot[] {
  if (djSlots.length === 0) return djSlots;

  const showStartTs = dateTimeToTimestamp(showStartDate, showStartTime);
  const showEndTs = dateTimeToTimestamp(showEndDate, showEndTime);

  // Sort slots by start time
  const sortedSlots = [...djSlots].sort((a, b) => {
    const aStart = dateTimeToTimestamp(a.startDate, a.startTime);
    const bStart = dateTimeToTimestamp(b.startDate, b.startTime);
    return aStart - bStart;
  });

  const result: LocalDJSlot[] = [];
  let currentTs = showStartTs;

  for (const slot of sortedSlots) {
    const slotStartTs = dateTimeToTimestamp(slot.startDate, slot.startTime);
    const slotEndTs = dateTimeToTimestamp(slot.endDate, slot.endTime);

    // If there's a gap before this slot, fill it with an empty DJ slot
    if (slotStartTs > currentTs) {
      result.push({
        id: `gap-${Date.now()}-${result.length}`,
        djName: '',
        startDate: timestampToDate(currentTs),
        startTime: snapToHalfHour(timestampToTime(currentTs)),
        endDate: timestampToDate(slotStartTs),
        endTime: snapToHalfHour(timestampToTime(slotStartTs)),
        djProfiles: [{ email: '' }],
      });
    }

    result.push(slot);
    currentTs = Math.max(currentTs, slotEndTs);
  }

  // If there's a gap after the last slot, fill it
  if (currentTs < showEndTs) {
    result.push({
      id: `gap-${Date.now()}-end`,
      djName: '',
      startDate: timestampToDate(currentTs),
      startTime: snapToHalfHour(timestampToTime(currentTs)),
      endDate: showEndDate,
      endTime: showEndTime,
      djProfiles: [{ email: '' }],
    });
  }

  // Ensure first slot starts at show start
  if (result.length > 0) {
    const firstSlotStart = dateTimeToTimestamp(result[0].startDate, result[0].startTime);
    if (firstSlotStart > showStartTs) {
      result.unshift({
        id: `gap-${Date.now()}-start`,
        djName: '',
        startDate: showStartDate,
        startTime: showStartTime,
        endDate: result[0].startDate,
        endTime: result[0].startTime,
        djProfiles: [{ email: '' }],
      });
    } else if (firstSlotStart < showStartTs) {
      result[0].startDate = showStartDate;
      result[0].startTime = showStartTime;
    }
  }

  return result;
}

export function SlotModal({
  slot,
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialStartTime,
  initialEndTime,
  allSlots,
}: SlotModalProps) {
  const [showName, setShowName] = useState('');
  const [djName, setDjName] = useState('');
  const [djEmail, setDjEmail] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [broadcastType, setBroadcastType] = useState<BroadcastType>('venue');
  const [djSlots, setDjSlots] = useState<LocalDJSlot[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [emailOpened, setEmailOpened] = useState(false);
  // Remote DJ profile lookup state
  const [remoteProfileFound, setRemoteProfileFound] = useState(false);
  const [remoteIsCollective, setRemoteIsCollective] = useState(false);
  const [isLookingUpRemote, setIsLookingUpRemote] = useState(false);
  // Show image state
  const [showImageUrl, setShowImageUrl] = useState<string | undefined>(undefined);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // When true, the show-starting-emails cron skips this slot — used to test a
  // real go-live/restream without emailing real subscribers.
  const [goLiveEmailsDisabled, setGoLiveEmailsDisabled] = useState(false);
  // Archive/restream tab state
  const [modalTab, setModalTab] = useState<SlotModalTab>('new-show');
  const [archives, setArchives] = useState<Archive[]>([]);
  const [archivesLoaded, setArchivesLoaded] = useState(false);
  const [archiveSearchQuery, setArchiveSearchQuery] = useState('');
  const [archiveDateFilter, setArchiveDateFilter] = useState('');
  const [selectedArchive, setSelectedArchive] = useState<Archive | null>(null);
  // Exact-millisecond restream times. The HH:mm form fields snap to a 30-min
  // grid and can't express second precision, so for restreams we carry the
  // true start/end here and let them win at save time. After-live: only the
  // end is exact (= chosen start + archive duration); start stays null and
  // comes from the form. Before-live (fitBeforeNext): both are exact, computed
  // backward from the next slot's start.
  const [restreamExactEndMs, setRestreamExactEndMs] = useState<number | null>(null);
  const [restreamExactStartMs, setRestreamExactStartMs] = useState<number | null>(null);
  // "End right before next slot" toggle — back-fits the start so the audio
  // ends exactly when the next scheduled slot begins.
  const [fitBeforeNext, setFitBeforeNext] = useState(false);
  // The admin's chosen start at the moment they toggled fit-before-next on.
  // The next-slot search keys off this stable anchor, not the live start field
  // (which back-fitting overwrites). Null in forward mode.
  const [fitAnchorMs, setFitAnchorMs] = useState<number | null>(null);
  // While editing an existing restream we seed restreamExact* from the saved
  // slot. The timing effect must not clobber those with form-derived values on
  // hydration (the form start is snapped to the 30-min grid and would corrupt a
  // second-accurate before-live slot). This holds the archiveId we hydrated; the
  // effect skips its first recompute for that archive until the admin actually
  // edits the start, the archive, or the toggle.
  const hydratedRestreamArchiveIdRef = useRef<string | null>(null);
  // Tracks the slot id whose post-live anchor we've already hydrated, so the
  // hydration effect runs ONCE per slot and never re-adds the anchor after the
  // user clears it (without this, clearing sets null and the effect immediately
  // re-resolves it from the still-unsaved slot.postLiveArchiveId — "can't clear").
  const hydratedPostLiveSlotIdRef = useRef<string | null>(null);
  // Curated post-live archive (radio-loop alignment). Optional.
  const [postLiveArchive, setPostLiveArchive] = useState<Archive | null>(null);
  const [postLivePickerOpen, setPostLivePickerOpen] = useState(false);
  const [postLiveSearchQuery, setPostLiveSearchQuery] = useState('');

  const isEditing = !!slot;

  // Lookup DJ profile by email (for remote broadcasts)
  const lookupRemoteDjProfile = async (email: string) => {
    if (!email || !email.includes('@')) {
      setRemoteProfileFound(false);
      return;
    }

    setIsLookingUpRemote(true);
    try {
      const res = await fetch(`/api/users/lookup-by-email?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (data.found) {
        setRemoteProfileFound(true);
        // Auto-fill DJ name if empty
        if (!djName && data.djName) {
          setDjName(data.djName);
        }
      } else {
        setRemoteProfileFound(false);
      }
    } catch (error) {
      console.error('Failed to lookup DJ profile:', error);
      setRemoteProfileFound(false);
    } finally {
      setIsLookingUpRemote(false);
    }
  };

  // Lookup DJ profile by name (for remote broadcasts) — checks users + pending-dj-profiles + collectives
  const lookupRemoteDjByName = async (name: string) => {
    if (!name || name.trim().length < 2) {
      setRemoteProfileFound(false);
      setRemoteIsCollective(false);
      return;
    }

    setIsLookingUpRemote(true);
    try {
      const res = await fetch(`/api/users/lookup-by-name?name=${encodeURIComponent(name.trim())}`);
      const data = await res.json();
      if (data.found) {
        setRemoteProfileFound(true);
        setRemoteIsCollective(!!data.isCollective);
        // Auto-fill email if found and currently empty
        if (data.djEmail && !djEmail) {
          setDjEmail(data.djEmail);
        }
      } else {
        setRemoteProfileFound(false);
        setRemoteIsCollective(false);
      }
    } catch (error) {
      console.error('Failed to lookup DJ profile by name:', error);
      setRemoteProfileFound(false);
      setRemoteIsCollective(false);
    } finally {
      setIsLookingUpRemote(false);
    }
  };

  // Lookup DJ profile for a specific DJ in a B3B slot
  const lookupDjProfileInSlot = async (slotId: string, profileIndex: number, email: string) => {
    if (!email || !email.includes('@')) {
      // Clear profile fields if email is invalid
      setDjSlots(prev => prev.map(dj => {
        if (dj.id !== slotId) return dj;
        const updatedProfiles = [...dj.djProfiles];
        updatedProfiles[profileIndex] = {
          ...updatedProfiles[profileIndex],
          profileFound: false,
          isLookingUp: false,
          userId: undefined,
          username: undefined,
          usernameNormalized: undefined,
          bio: undefined,
          photoUrl: undefined,
          thankYouMessage: undefined,
          socialLinks: undefined,
        };
        return { ...dj, djProfiles: updatedProfiles };
      }));
      return;
    }

    // Set loading state
    setDjSlots(prev => prev.map(dj => {
      if (dj.id !== slotId) return dj;
      const updatedProfiles = [...dj.djProfiles];
      updatedProfiles[profileIndex] = { ...updatedProfiles[profileIndex], isLookingUp: true };
      return { ...dj, djProfiles: updatedProfiles };
    }));

    try {
      const res = await fetch(`/api/users/lookup-by-email?email=${encodeURIComponent(email)}`);
      const data = await res.json();

      setDjSlots(prev => prev.map(dj => {
        if (dj.id !== slotId) return dj;
        const updatedProfiles = [...dj.djProfiles];

        if (data.found) {
          updatedProfiles[profileIndex] = {
            ...updatedProfiles[profileIndex],
            isLookingUp: false,
            profileFound: true,
            userId: data.djUserId,
            username: data.djUsername,
            usernameNormalized: data.djUsernameNormalized,
            bio: data.djBio,
            photoUrl: data.djPhotoUrl,
            thankYouMessage: data.djThankYouMessage,
            socialLinks: data.djSocialLinks,
          };
        } else {
          updatedProfiles[profileIndex] = {
            ...updatedProfiles[profileIndex],
            isLookingUp: false,
            profileFound: false,
            userId: undefined,
            username: undefined,
            usernameNormalized: undefined,
            bio: undefined,
            photoUrl: undefined,
            thankYouMessage: undefined,
            socialLinks: undefined,
          };
        }

        return { ...dj, djProfiles: updatedProfiles };
      }));
    } catch (error) {
      console.error('Failed to lookup DJ profile:', error);
      setDjSlots(prev => prev.map(dj => {
        if (dj.id !== slotId) return dj;
        const updatedProfiles = [...dj.djProfiles];
        updatedProfiles[profileIndex] = { ...updatedProfiles[profileIndex], isLookingUp: false, profileFound: false };
        return { ...dj, djProfiles: updatedProfiles };
      }));
    }
  };

  // Lookup DJ profile by name for a venue DJ slot — checks users + pending-dj-profiles
  const lookupDjByNameInSlot = async (slotId: string, name: string) => {
    if (!name || name.trim().length < 2) return;

    // Set loading on first profile
    setDjSlots(prev => prev.map(dj => {
      if (dj.id !== slotId) return dj;
      const updatedProfiles = [...dj.djProfiles];
      updatedProfiles[0] = { ...updatedProfiles[0], isLookingUp: true };
      return { ...dj, djProfiles: updatedProfiles };
    }));

    try {
      const res = await fetch(`/api/users/lookup-by-name?name=${encodeURIComponent(name.trim())}`);
      const data = await res.json();

      setDjSlots(prev => prev.map(dj => {
        if (dj.id !== slotId) return dj;
        const updatedProfiles = [...dj.djProfiles];

        if (data.found) {
          // Auto-fill email if found and first profile has no email
          if (data.djEmail && !updatedProfiles[0].email) {
            updatedProfiles[0] = {
              ...updatedProfiles[0],
              email: data.djEmail,
            };
          }
          updatedProfiles[0] = {
            ...updatedProfiles[0],
            isLookingUp: false,
            profileFound: true,
            userId: data.djUserId || undefined,
            username: data.djUsername || undefined,
            usernameNormalized: data.djUsernameNormalized || undefined,
            bio: data.djBio || undefined,
            photoUrl: data.djPhotoUrl || undefined,
            thankYouMessage: data.djThankYouMessage || undefined,
            socialLinks: data.djSocialLinks || undefined,
          };
        } else {
          updatedProfiles[0] = { ...updatedProfiles[0], isLookingUp: false, profileFound: false };
        }

        return { ...dj, djProfiles: updatedProfiles };
      }));
    } catch (error) {
      console.error('Failed to lookup DJ profile by name in slot:', error);
      setDjSlots(prev => prev.map(dj => {
        if (dj.id !== slotId) return dj;
        const updatedProfiles = [...dj.djProfiles];
        updatedProfiles[0] = { ...updatedProfiles[0], isLookingUp: false, profileFound: false };
        return { ...dj, djProfiles: updatedProfiles };
      }));
    }
  };

  // Add a new DJ profile to a slot (for B3B)
  const addDjProfileToSlot = (slotId: string) => {
    setDjSlots(prev => prev.map(dj =>
      dj.id === slotId
        ? { ...dj, djProfiles: [...dj.djProfiles, { email: '' }] }
        : dj
    ));
  };

  // Remove a DJ profile from a slot
  const removeDjProfileFromSlot = (slotId: string, profileIndex: number) => {
    setDjSlots(prev => prev.map(dj => {
      if (dj.id !== slotId) return dj;
      // Don't remove if it's the last profile
      if (dj.djProfiles.length <= 1) return dj;
      return {
        ...dj,
        djProfiles: dj.djProfiles.filter((_, i) => i !== profileIndex),
      };
    }));
  };

  // Update a DJ profile's email in a slot
  const updateDjProfileEmail = (slotId: string, profileIndex: number, email: string) => {
    setDjSlots(prev => prev.map(dj => {
      if (dj.id !== slotId) return dj;
      const updatedProfiles = [...dj.djProfiles];
      updatedProfiles[profileIndex] = { ...updatedProfiles[profileIndex], email };
      return { ...dj, djProfiles: updatedProfiles };
    }));
  };

  // Fetch archives when archives tab is first opened
  const fetchArchives = async () => {
    if (archivesLoaded) return;
    try {
      // includeHidden so admins can schedule a hidden archive as a restream
      // (and pick it for post-live) without first un-hiding it. The picker
      // lists are admin-only; public surfaces still call /api/archives plain.
      const res = await fetch('/api/archives?includeHidden=true');
      const data = await res.json();
      if (data.archives) {
        setArchives(data.archives);
      }
      setArchivesLoaded(true);
    } catch (error) {
      console.error('Failed to fetch archives:', error);
    }
  };

  // When editing a restream, auto-select the matching archive once archives load
  // This also fills in showImageUrl if it was missing from the slot
  useEffect(() => {
    if (slot?.broadcastType === 'restream' && slot.archiveId && archives.length > 0 && !selectedArchive) {
      const match = archives.find(a => a.id === slot.archiveId);
      if (match) {
        setSelectedArchive(match);
        // Fill in showImageUrl from archive if missing on the slot
        if (!showImageUrl && match.showImageUrl) {
          setShowImageUrl(match.showImageUrl);
        }
      }
    }
  }, [slot, archives, selectedArchive, showImageUrl]);

  // When editing a slot with an existing postLiveArchiveId, resolve to the
  // archive once the archives list is loaded — but only ONCE per slot. Guarding
  // on a per-slot ref (not `!postLiveArchive`) means clearing the anchor sticks:
  // after the user clears it, this effect won't re-resolve it from the slot's
  // still-unsaved postLiveArchiveId.
  useEffect(() => {
    if (!slot?.id || archives.length === 0) return;
    if (hydratedPostLiveSlotIdRef.current === slot.id) return;
    hydratedPostLiveSlotIdRef.current = slot.id;
    if (slot.postLiveArchiveId) {
      const match = archives.find(a => a.id === slot.postLiveArchiveId);
      if (match) setPostLiveArchive(match);
    }
  }, [slot, archives]);

  // Filter archives by search query and date
  const filteredArchives = archives.filter(archive => {
    const matchesSearch = !archiveSearchQuery ||
      archive.djs.some(dj => dj.name.toLowerCase().includes(archiveSearchQuery.toLowerCase())) ||
      archive.showName.toLowerCase().includes(archiveSearchQuery.toLowerCase());
    const matchesDate = !archiveDateFilter ||
      new Date(archive.recordedAt).toISOString().split('T')[0] === archiveDateFilter;
    return matchesSearch && matchesDate;
  });

  // Handle archive selection — sets the archive metadata. The exact start/end
  // and the display HH:mm fields are computed by the effect below (keyed on
  // start/archive/fitBeforeNext), so picking an archive, changing the start, or
  // toggling "fit before next" all flow through one place.
  const handleSelectArchive = (archive: Archive) => {
    // A user-driven archive pick exits hydration so the timing effect recomputes.
    hydratedRestreamArchiveIdRef.current = null;
    setSelectedArchive(archive);
    setShowName(archive.showName);
    setDjName(archive.djs[0]?.name || '');
    setShowImageUrl(archive.showImageUrl);
    // A fresh archive pick defaults to forward-from-start mode; the admin opts
    // into back-fitting via the toggle.
    setFitBeforeNext(false);
    setFitAnchorMs(null);
  };

  // Toggle "end right before next slot". Capture the current start as the
  // search anchor when turning on so the next-slot lookup stays stable while
  // we move the start backward.
  const handleToggleFitBeforeNext = (on: boolean) => {
    hydratedRestreamArchiveIdRef.current = null;
    if (on) {
      const anchor = startDate && startTime ? new Date(`${startDate}T${startTime}`).getTime() : Date.now();
      setFitAnchorMs(anchor);
    } else {
      setFitAnchorMs(null);
    }
    setFitBeforeNext(on);
  };

  // Start-field edits (date or time) also exit hydration and recompute the end.
  const handleRestreamStartChange = (setter: (v: string) => void, value: string) => {
    hydratedRestreamArchiveIdRef.current = null;
    setter(value);
  };

  // Find the earliest scheduled/live slot that starts strictly after `afterMs`,
  // excluding the slot currently being edited. Any broadcastType counts — the
  // restream butts up against whatever comes next on the schedule.
  const findNextSlot = (afterMs: number): BroadcastSlotSerialized | null => {
    if (!allSlots || allSlots.length === 0) return null;
    let best: BroadcastSlotSerialized | null = null;
    for (const s of allSlots) {
      if (slot && s.id === slot.id) continue;
      if (s.status !== 'scheduled' && s.status !== 'live') continue;
      if (s.startTime <= afterMs) continue;
      if (!best || s.startTime < best.startTime) best = s;
    }
    return best;
  };

  // The next slot to fit before. Computed from `fitAnchorMs` — the admin's
  // chosen start captured when the toggle turns on — NOT from the live
  // startDate/startTime, which back-fitting overwrites (using the form value
  // would let the search drift to an earlier slot after we move the start).
  // In forward mode, fitAnchorMs is null and we search from the current start.
  const formStartMs = startDate && startTime ? new Date(`${startDate}T${startTime}`).getTime() : null;
  const nextSearchFromMs = fitBeforeNext ? fitAnchorMs : formStartMs;
  const nextSlot = nextSearchFromMs != null ? findNextSlot(nextSearchFromMs) : null;

  // Keep the exact restream times (and the display HH:mm fields) in sync with
  // the chosen start, selected archive, and the fit-before-next toggle. This is
  // the single source of truth for restream timing; handleSave reads the
  // restreamExact* state, the form fields are display-only for restreams.
  useEffect(() => {
    if (modalTab !== 'archives' || !selectedArchive || !startDate || !startTime) return;
    // Hydrating an existing restream: keep the seeded second-accurate values
    // (the form start is grid-snapped and would corrupt them). Cleared the
    // moment the admin edits the start, swaps the archive, or flips the toggle.
    if (hydratedRestreamArchiveIdRef.current === selectedArchive.id) return;
    const durationMs = selectedArchive.duration * 1000;

    if (fitBeforeNext && nextSlot) {
      // Back-fit: audio ends exactly when the next slot starts.
      const endMs = nextSlot.startTime;
      const startMs = endMs - durationMs;
      setRestreamExactStartMs(startMs);
      setRestreamExactEndMs(endMs);
      setStartDate(timestampToDate(startMs));
      setStartTime(snapToHalfHour(timestampToTime(startMs)));
      setEndDate(timestampToDate(endMs));
      setEndTime(snapToHalfHour(timestampToTime(endMs)));
    } else {
      // Forward: end = chosen start + exact duration. Start comes from the form.
      const startMs = new Date(`${startDate}T${startTime}`).getTime();
      const endMs = startMs + durationMs;
      setRestreamExactStartMs(null);
      setRestreamExactEndMs(endMs);
      setEndDate(timestampToDate(endMs));
      setEndTime(snapToHalfHour(timestampToTime(endMs)));
    }
    // nextSlot.startTime is the only object-derived dep; the rest are primitives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalTab, selectedArchive, startDate, startTime, fitBeforeNext, nextSlot?.startTime]);

  // Non-blocking warning for back-fit: the archive may be too long to fit
  // before the next slot — it would start in the past, or overlap the slot
  // immediately before it. We warn but still allow saving (admin's call).
  const fitWarning: string | null = (() => {
    if (!fitBeforeNext || !nextSlot || !selectedArchive || restreamExactStartMs == null) return null;
    const startMs = restreamExactStartMs;
    if (startMs < Date.now()) {
      return `This ${formatDuration(selectedArchive.duration)} archive would have to start at ${formatExactClock(startMs)} to end when "${nextSlot.showName}" begins — that's in the past.`;
    }
    // Latest end of any slot that finishes at/before the next slot's start
    // (i.e. could sit immediately before this restream).
    let prevEndMs = 0;
    let prevName = '';
    for (const s of allSlots ?? []) {
      if (slot && s.id === slot.id) continue;
      if (s.id === nextSlot.id) continue;
      if (s.status !== 'scheduled' && s.status !== 'live') continue;
      if (s.endTime <= nextSlot.startTime && s.endTime > prevEndMs) {
        prevEndMs = s.endTime;
        prevName = s.showName;
      }
    }
    if (prevEndMs > startMs) {
      return `This ${formatDuration(selectedArchive.duration)} archive would start at ${formatExactClock(startMs)}, overlapping "${prevName}" (ends ${formatExactClock(prevEndMs)}).`;
    }
    return null;
  })();

  // Check if this is an overnight show
  const isOvernight = startDate && endDate && endDate > startDate;

  // A restream slot with an archive chosen — drives the exact-time read-only
  // fields and the "end right before next slot" toggle.
  const isRestreamSelected = modalTab === 'archives' && !!selectedArchive;

  // Helper to format date as YYYY-MM-DD in local timezone
  const formatLocalDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Initialize form when modal opens
  useEffect(() => {
    if (isOpen) {
      // Reset archive state
      setArchiveSearchQuery('');
      setArchiveDateFilter('');
      setSelectedArchive(null);
      // Reset the post-live anchor too. Without this it persists across modal
      // opens: editing slot A with anchor X then opening slot B still shows X,
      // and the !postLiveArchive hydration guard below can't correct it — so a
      // save bleeds X onto B (and onto every slot you touch). It re-hydrates
      // from slot.postLiveArchiveId in the effect below (once per slot).
      setPostLiveArchive(null);
      hydratedPostLiveSlotIdRef.current = null;
      // Reset restream exact-time state; the edit branch below re-seeds it for
      // an existing restream.
      setRestreamExactStartMs(null);
      setRestreamExactEndMs(null);
      setFitBeforeNext(false);
      setFitAnchorMs(null);
      hydratedRestreamArchiveIdRef.current = null;

      if (slot) {
        // Default to archives tab when editing a restream
        const isRestream = slot.broadcastType === 'restream';
        setModalTab(isRestream ? 'archives' : 'new-show');
        if (isRestream) fetchArchives();
        // Editing existing slot
        const start = new Date(slot.startTime);
        const end = new Date(slot.endTime);
        setShowName(slot.showName || '');
        setDjName(slot.djName || '');
        setDjEmail(slot.djEmail || '');
        setShowImageUrl(slot.showImageUrl);
        setGoLiveEmailsDisabled(slot.goLiveEmailsDisabled === true);
        // Use local date formatting to avoid timezone issues
        setStartDate(formatLocalDate(start));
        setEndDate(formatLocalDate(end));
        setStartTime(snapToHalfHour(start.toTimeString().slice(0, 5)));
        setEndTime(snapToHalfHour(end.toTimeString().slice(0, 5)));
        setBroadcastType(slot.broadcastType || 'remote');
        // Restream: seed the second-accurate start/end from the saved slot so a
        // no-change re-save is a no-op (the snapped HH:mm fields above are
        // display-only). hydratedRestreamArchiveIdRef guards the timing effect
        // from overwriting these once the archive auto-selects.
        if (isRestream) {
          setRestreamExactStartMs(slot.startTime);
          setRestreamExactEndMs(slot.endTime);
          hydratedRestreamArchiveIdRef.current = slot.archiveId ?? null;
        } else {
          setRestreamExactStartMs(null);
          setRestreamExactEndMs(null);
          hydratedRestreamArchiveIdRef.current = null;
        }
        setFitBeforeNext(false);
        setFitAnchorMs(null);

        // Convert DJ slots to local format with dates and profile fields
        if (slot.djSlots && slot.djSlots.length > 0) {
          setDjSlots(slot.djSlots.map(dj => {
            const djStart = new Date(dj.startTime);
            const djEnd = new Date(dj.endTime);

            // Convert djProfiles array or create from legacy single-DJ fields
            let djProfiles: LocalDJProfile[] = [];
            if (dj.djProfiles && dj.djProfiles.length > 0) {
              // Use existing djProfiles array
              djProfiles = dj.djProfiles.map(p => ({
                email: p.email || '',
                userId: p.userId,
                username: p.username,
                usernameNormalized: p.usernameNormalized,
                bio: p.bio,
                photoUrl: p.photoUrl,
                thankYouMessage: p.thankYouMessage,
                socialLinks: p.socialLinks,
                profileFound: !!p.userId,
              }));
            } else if (dj.djEmail) {
              // Migrate from legacy single-DJ fields
              djProfiles = [{
                email: dj.djEmail,
                userId: dj.djUserId,
                username: dj.djUsername,
                bio: dj.djBio,
                photoUrl: dj.djPhotoUrl,
                thankYouMessage: dj.djThankYouMessage,
                socialLinks: dj.djSocialLinks,
                profileFound: !!dj.djUserId,
              }];
            } else {
              // No DJ info, start with empty profile
              djProfiles = [{ email: '' }];
            }

            return {
              id: dj.id,
              djName: dj.djName || '',
              startDate: formatLocalDate(djStart),
              startTime: snapToHalfHour(djStart.toTimeString().slice(0, 5)),
              endDate: formatLocalDate(djEnd),
              endTime: snapToHalfHour(djEnd.toTimeString().slice(0, 5)),
              // Legacy fields (from first profile for backwards compat)
              djEmail: dj.djEmail,
              djUserId: dj.djUserId,
              djUsername: dj.djUsername,
              djBio: dj.djBio,
              djPhotoUrl: dj.djPhotoUrl,
              djThankYouMessage: dj.djThankYouMessage,
              djSocialLinks: dj.djSocialLinks,
              profileFound: !!dj.djUserId,
              // B3B support
              djProfiles,
            };
          }));
        } else {
          setDjSlots([]);
        }
        // Reset remote profile state
        setRemoteProfileFound(false);
      } else if (initialStartTime && initialEndTime) {
        // Creating new slot from calendar drag
        setModalTab('new-show');
        setShowName('');
        setDjName('');
        setDjEmail('');
        setShowImageUrl(undefined);
        setGoLiveEmailsDisabled(false);
        // Use local date formatting to avoid timezone issues
        setStartDate(formatLocalDate(initialStartTime));
        setEndDate(formatLocalDate(initialEndTime));
        setStartTime(snapToHalfHour(initialStartTime.toTimeString().slice(0, 5)));
        setEndTime(snapToHalfHour(initialEndTime.toTimeString().slice(0, 5)));
        setBroadcastType('remote');
        setDjSlots([]);
        // Reset profile/image state
        setRemoteProfileFound(false);
        setImageUploadError(null);
      }
    }
  }, [isOpen, slot, initialStartTime, initialEndTime]);

  // Auto-set end date when start date changes (if not overnight)
  useEffect(() => {
    if (startDate && !endDate) {
      setEndDate(startDate);
    }
  }, [startDate, endDate]);

  // Auto-detect overnight when end time is before start time on same date
  useEffect(() => {
    if (startDate && startTime && endTime && startDate === endDate) {
      const startMinutes = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
      const endMinutes = parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1]);
      if (endMinutes <= startMinutes) {
        // End time is before start time, assume overnight
        const nextDay = new Date(startDate);
        nextDay.setDate(nextDay.getDate() + 1);
        setEndDate(nextDay.toISOString().split('T')[0]);
      }
    }
  }, [startDate, endDate, startTime, endTime]);

  // Adjust DJ slots when show times change to keep them within bounds
  useEffect(() => {
    if (djSlots.length > 0 && startTime && endTime && startDate && endDate) {
      const adjustedSlots = adjustDjSlotsToShowBounds(djSlots, startDate, startTime, endDate, endTime);

      // Only update if there are actual changes to avoid infinite loops
      const hasChanges = adjustedSlots.some((adjusted, i) =>
        adjusted.startDate !== djSlots[i].startDate ||
        adjusted.startTime !== djSlots[i].startTime ||
        adjusted.endDate !== djSlots[i].endDate ||
        adjusted.endTime !== djSlots[i].endTime
      );

      if (hasChanges) {
        setDjSlots(adjustedSlots);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, endTime, startDate, endDate]);

  // Handle show image upload
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file
    const validation = validatePhoto(file);
    if (!validation.valid) {
      setImageUploadError(validation.error || 'Invalid file');
      return;
    }

    setIsUploadingImage(true);
    setImageUploadError(null);

    try {
      // Generate a temporary ID for new slots, or use existing slot ID
      const uploadId = slot?.id || `temp-${Date.now()}`;
      const result = await uploadShowImage(uploadId, file);

      if (result.success && result.url) {
        setShowImageUrl(result.url);
      } else {
        setImageUploadError(result.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Image upload failed:', error);
      setImageUploadError('Failed to upload image');
    } finally {
      setIsUploadingImage(false);
      // Reset file input
      if (imageInputRef.current) {
        imageInputRef.current.value = '';
      }
    }
  };

  const handleRemoveImage = () => {
    setShowImageUrl(undefined);
    setImageUploadError(null);
  };

  const handleSave = async () => {
    console.log('[SlotModal] handleSave called with:', { showName, startDate, endDate, startTime, endTime, broadcastType, modalTab, djSlotsCount: djSlots.length });
    // For archives tab, require selected archive instead of show name
    if (modalTab === 'archives' && !selectedArchive) return;
    if (modalTab === 'new-show' && !showName) return;
    if (!startDate || !endDate || !startTime || !endTime) return;

    setIsSaving(true);
    try {
      const startDateTime = new Date(`${startDate}T${startTime}`).getTime();
      const endDateTime = new Date(`${endDate}T${endTime}`).getTime();

      // Restreams carry second-accurate start/end that the 30-min HH:mm fields
      // can't express, so the exact values win. After-live: only the end is
      // exact (start comes from the form). Before-live (fitBeforeNext): both
      // are exact, back-fitted from the next slot's start.
      const isRestream = modalTab === 'archives' && !!selectedArchive;
      const finalStartMs = isRestream && restreamExactStartMs != null ? restreamExactStartMs : startDateTime;
      const finalEndMs = isRestream && restreamExactEndMs != null ? restreamExactEndMs : endDateTime;

      // For venue broadcasts with DJ slots, ensure full coverage before saving
      let slotsToSave = djSlots;
      if (broadcastType === 'venue' && djSlots.length > 0) {
        slotsToSave = ensureFullCoverage(djSlots, startDate, startTime, endDate, endTime);
      }

      // Convert local DJ slots to timestamps using explicit dates, including all profile fields
      const convertedDjSlots: DJSlot[] | undefined = broadcastType === 'venue' && slotsToSave.length > 0
        ? slotsToSave.map(dj => {
            // Get first profile for legacy single-DJ fields (backwards compatibility)
            const firstProfile = dj.djProfiles.find(p => p.email) || dj.djProfiles[0];

            // Convert djProfiles array to DJProfileInfo format (filter out empty emails)
            const djProfiles: DJProfileInfo[] = dj.djProfiles
              .filter(p => p.email)
              .map(p => ({
                email: p.email || undefined,
                userId: p.userId || undefined,
                username: p.username || undefined,
                usernameNormalized: p.usernameNormalized || undefined,
                bio: p.bio || undefined,
                photoUrl: p.photoUrl || undefined,
                thankYouMessage: p.thankYouMessage || undefined,
                socialLinks: p.socialLinks || undefined,
              }));

            return {
              id: dj.id,
              djName: dj.djName || undefined,
              startTime: new Date(`${dj.startDate}T${dj.startTime}`).getTime(),
              endTime: new Date(`${dj.endDate}T${dj.endTime}`).getTime(),
              // Legacy single-DJ fields (from first profile for backwards compatibility)
              djEmail: firstProfile?.email || undefined,
              djUserId: firstProfile?.userId || undefined,
              djUsername: firstProfile?.username || undefined,
              djBio: firstProfile?.bio || undefined,
              djPhotoUrl: firstProfile?.photoUrl || undefined,
              djThankYouMessage: firstProfile?.thankYouMessage || undefined,
              djSocialLinks: firstProfile?.socialLinks || undefined,
              // B3B support: all DJ profiles
              djProfiles: djProfiles.length > 0 ? djProfiles : undefined,
            };
          })
        : undefined;

      // Build save data — include restream fields when on archives tab
      const saveData: Parameters<typeof onSave>[0] = {
        showName,
        djName: modalTab === 'archives' ? (selectedArchive?.djs[0]?.name || djName || undefined) : (broadcastType === 'remote' ? (djName || undefined) : undefined),
        djEmail: modalTab === 'archives' ? (selectedArchive?.djs[0]?.email || undefined) : (djEmail || undefined),
        djSlots: convertedDjSlots,
        startTime: finalStartMs,
        endTime: finalEndMs,
        broadcastType: modalTab === 'archives' ? 'restream' : broadcastType,
        showImageUrl,
        // Empty string clears any previous curation; non-empty sets it. The
        // archive-radio cron reads this when generating loops to choose what
        // plays at the loop anchor after this slot's contiguous live block.
        postLiveArchiveId: postLiveArchive?.id ?? '',
        goLiveEmailsDisabled,
      };

      if (modalTab === 'archives' && selectedArchive) {
        saveData.archiveId = selectedArchive.id;
        saveData.archiveRecordingUrl = selectedArchive.recordingUrl;
        saveData.archiveDuration = selectedArchive.duration;
        // Pass all DJs from the archive for multi-DJ restream display
        if (selectedArchive.djs && selectedArchive.djs.length > 0) {
          saveData.restreamDjs = selectedArchive.djs;
        }
      }

      await onSave(saveData);
      onClose();
    } catch (error) {
      console.error('Failed to save slot:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!slot || !onDelete) return;
    if (!confirm('Delete this show?')) return;

    setIsSaving(true);
    try {
      await onDelete(slot.id);
      onClose();
    } catch (error) {
      console.error('Failed to delete slot:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const copyBroadcastLink = async () => {
    if (!slot) return;
    const url = `${window.location.origin}/broadcast/live?token=${slot.broadcastToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  // Format time in a specific timezone
  const formatTimeInTimezone = (timestamp: number, timezone: string, options?: Intl.DateTimeFormatOptions) => {
    return new Date(timestamp).toLocaleString('en-US', { timeZone: timezone, ...options });
  };

  // Get short timezone name (e.g., "EST", "PST")
  const getTimezoneAbbr = (timezone: string, timestamp: number) => {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' });
    const parts = formatter.formatToParts(new Date(timestamp));
    return parts.find(p => p.type === 'timeZoneName')?.value || timezone;
  };

  // Open mailto with DJ onboarding email (for remote broadcasts)
  const openDjEmail = () => {
    if (!slot || !djEmail) return;
    openDjEmailWithDetails(djEmail, djName || 'there', slot.startTime, slot.endTime);
  };

  // Open mailto for a specific DJ in a venue slot
  const openDjEmailForSlot = (targetEmail: string, targetDjName: string, slotStartTime: number, slotEndTime: number) => {
    if (!slot || !targetEmail) return;
    openDjEmailWithDetails(targetEmail, targetDjName || 'there', slotStartTime, slotEndTime);
  };

  // Shared email generation logic
  const openDjEmailWithDetails = async (targetEmail: string, targetDjName: string, slotStart: number, slotEnd: number) => {
    if (!slot) return;

    // Fresh lookup to get the DJ's username for the profile URL
    // Try by email first, then fall back to name lookup (which also checks pending-dj-profiles)
    let djUsernameNormalized: string | undefined;
    let djRealName: string | undefined;
    try {
      const res = await fetch(`/api/users/lookup-by-email?email=${encodeURIComponent(targetEmail)}`);
      const data = await res.json();
      if (data.found && data.djUsernameNormalized) {
        djUsernameNormalized = data.djUsernameNormalized;
      }
      if (data.name) {
        djRealName = data.name;
      }
    } catch (error) {
      console.error('Failed to lookup DJ for email template:', error);
    }

    if (!djUsernameNormalized && targetDjName) {
      try {
        const res = await fetch(`/api/users/lookup-by-name?name=${encodeURIComponent(targetDjName.trim())}`);
        const data = await res.json();
        if (data.found && data.djUsernameNormalized) {
          djUsernameNormalized = data.djUsernameNormalized;
        }
        if (data.name && !djRealName) {
          djRealName = data.name;
        }
      } catch (error) {
        console.error('Failed to lookup DJ by name for email template:', error);
      }
    }


    const broadcastUrl = `${window.location.origin}/broadcast/live?token=${slot.broadcastToken}`;
    const djTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone; // Use admin's timezone as default
    const djTz = getTimezoneAbbr(djTimezone, slotStart);
    const formattedDate = formatTimeInTimezone(slotStart, djTimezone, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const formattedStart = formatTimeInTimezone(slotStart, djTimezone, { hour: 'numeric', minute: '2-digit' });
    const formattedEnd = formatTimeInTimezone(slotEnd, djTimezone, { hour: 'numeric', minute: '2-digit' });

    const profileUrl = djUsernameNormalized
      ? `https://channel-app.com/dj/${djUsernameNormalized}`
      : null;
    const profileBlock = profileUrl
      ? `\nYour profile:\n${profileUrl}\n`
      : '';

    const subject = `Your show on Channel: ${showName}`;
    const body = `Hi ${djRealName || targetDjName},

You're all set to go live on Channel.

Show: ${showName}
${formattedDate}
${formattedStart} – ${formattedEnd} ${djTz}

⸻

1. Fine-tune your profile
${profileBlock}
Sign up or log in using ${targetEmail}:
https://channel-app.com/studio

Add bio, links, upcoming shows. We feature these on the website and newsletter. I'd really recommend adding your genre and a tip link to your profile. The tip link is what people land on when they click "support", and it also adds a small tip icon to your player whenever someone is listening to your live or recordings.

⸻

2. Your live stream link

Go live from here (keep private):
${broadcastUrl}

Test ahead of time. "Test audio capture" in studio to test your setup.

Setup guide:
https://channel-app.com/streaming-guide

⸻

3. Leading up to your show

Join us early and share: https://channel-app.com${profileUrl ? ` or ${profileUrl}` : ''} for people to hear you live, engage in the conversation, and access your recordings.

Excited to have you on.

Cap`;

    const gmailUrl = `https://mail.google.com/mail/?authuser=cap@channel-app.com&view=cm&fs=1&to=${encodeURIComponent(targetEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank');
    setEmailOpened(true);
    setTimeout(() => setEmailOpened(false), 2000);
  };

  const addDjSlot = () => {
    const newId = `dj-${Date.now()}`;

    if (djSlots.length === 0) {
      // First DJ slot covers entire show
      setDjSlots([{
        id: newId,
        djName: '',
        startDate: startDate,
        startTime: startTime,
        endDate: endDate,
        endTime: endTime,
        djProfiles: [{ email: '' }],
      }]);
    } else {
      // New slot starts at last slot's end, ends at show end
      const lastSlot = djSlots[djSlots.length - 1];
      setDjSlots([...djSlots, {
        id: newId,
        djName: '',
        startDate: lastSlot.endDate,
        startTime: lastSlot.endTime,
        endDate: endDate,
        endTime: endTime,
        djProfiles: [{ email: '' }],
      }]);
    }
  };

  const updateDjSlot = (id: string, field: keyof LocalDJSlot, value: string) => {
    const slotIndex = djSlots.findIndex(dj => dj.id === id);
    if (slotIndex === -1) return;

    const updatedSlots = [...djSlots];
    const updatedDj = { ...updatedSlots[slotIndex], [field]: value };

    // If updating date/time fields, clamp to show bounds and auto-adjust adjacent slots
    if (field === 'startDate' || field === 'startTime' || field === 'endDate' || field === 'endTime') {
      // First clamp the updated slot to show bounds
      const [adjusted] = adjustDjSlotsToShowBounds([updatedDj], startDate, startTime, endDate, endTime);
      updatedSlots[slotIndex] = adjusted;

      // Auto-adjust adjacent slots to prevent gaps
      if (field === 'endDate' || field === 'endTime') {
        // When changing end time, update next slot's start to match
        if (slotIndex < updatedSlots.length - 1) {
          updatedSlots[slotIndex + 1] = {
            ...updatedSlots[slotIndex + 1],
            startDate: adjusted.endDate,
            startTime: adjusted.endTime,
          };
        }
      }

      if (field === 'startDate' || field === 'startTime') {
        // When changing start time, update previous slot's end to match
        if (slotIndex > 0) {
          updatedSlots[slotIndex - 1] = {
            ...updatedSlots[slotIndex - 1],
            endDate: adjusted.startDate,
            endTime: adjusted.startTime,
          };
        }
      }
    } else {
      updatedSlots[slotIndex] = updatedDj;
    }

    setDjSlots(updatedSlots);
  };

  const removeDjSlot = (id: string) => {
    const slotIndex = djSlots.findIndex(dj => dj.id === id);
    if (slotIndex === -1) return;

    const removedSlot = djSlots[slotIndex];
    const updatedSlots = djSlots.filter(dj => dj.id !== id);

    // Extend adjacent slot to fill the gap
    if (updatedSlots.length > 0) {
      if (slotIndex > 0 && slotIndex <= updatedSlots.length) {
        // Extend previous slot's end to the removed slot's end
        updatedSlots[slotIndex - 1] = {
          ...updatedSlots[slotIndex - 1],
          endDate: removedSlot.endDate,
          endTime: removedSlot.endTime,
        };
      } else if (slotIndex === 0 && updatedSlots.length > 0) {
        // Removed first slot - extend next slot's start to removed slot's start
        updatedSlots[0] = {
          ...updatedSlots[0],
          startDate: removedSlot.startDate,
          startTime: removedSlot.startTime,
        };
      }
    }

    setDjSlots(updatedSlots);
  };

  if (!isOpen) return null;

  const broadcastUrl = slot
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/broadcast/live?token=${slot.broadcastToken}`
    : '';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-[#252525] rounded-xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800 sticky top-0 bg-[#252525] z-10">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Edit Show' : modalTab === 'archives' ? 'Schedule Restream' : 'New Show'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-black rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar — show when creating new, or editing a restream */}
        {(!isEditing || slot?.broadcastType === 'restream') && (
          <div className="flex border-b border-gray-800">
            <button
              type="button"
              onClick={() => setModalTab('new-show')}
              className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                modalTab === 'new-show'
                  ? 'text-white border-b-2 border-accent'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              New Show
            </button>
            <button
              type="button"
              onClick={() => {
                setModalTab('archives');
                fetchArchives();
              }}
              className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                modalTab === 'archives'
                  ? 'text-white border-b-2 border-purple-500'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              Archives
            </button>
          </div>
        )}

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Archive search panel (archives tab) */}
          {modalTab === 'archives' && (
            <div className="space-y-3">
              {selectedArchive ? (
                /* Selected archive summary */
                <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {selectedArchive.showImageUrl && (
                        <div className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0">
                          <Image
                            src={selectedArchive.showImageUrl}
                            alt={selectedArchive.showName}
                            fill
                            className="object-cover"
                          />
                        </div>
                      )}
                      <div>
                        <p className="text-white font-medium text-sm">{selectedArchive.showName}</p>
                        <p className="text-gray-400 text-xs">
                          {selectedArchive.djs.map(d => d.name).join(', ')} &middot;{' '}
                          {new Date(selectedArchive.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} &middot;{' '}
                          {Math.floor(selectedArchive.duration / 3600)}h{Math.floor((selectedArchive.duration % 3600) / 60).toString().padStart(2, '0')}m
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedArchive(null)}
                      className="text-xs text-purple-400 hover:text-purple-300"
                    >
                      Change
                    </button>
                  </div>
                </div>
              ) : (
                /* Archive search */
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={archiveSearchQuery}
                      onChange={(e) => setArchiveSearchQuery(e.target.value)}
                      placeholder="Search by DJ or show name..."
                      className="bg-black text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
                    />
                    <input
                      type="date"
                      value={archiveDateFilter}
                      onChange={(e) => setArchiveDateFilter(e.target.value)}
                      className="bg-black text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {!archivesLoaded ? (
                      <p className="text-gray-500 text-sm text-center py-4">Loading archives...</p>
                    ) : filteredArchives.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-4">No archives found</p>
                    ) : (
                      filteredArchives.map(archive => (
                        <button
                          key={archive.id}
                          type="button"
                          onClick={() => handleSelectArchive(archive)}
                          className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors text-left"
                        >
                          {archive.showImageUrl ? (
                            <div className="relative w-10 h-10 rounded overflow-hidden flex-shrink-0">
                              <Image src={archive.showImageUrl} alt="" fill className="object-cover" />
                            </div>
                          ) : (
                            <div className="w-10 h-10 rounded bg-gray-800 flex items-center justify-center flex-shrink-0">
                              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                              </svg>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">{archive.showName}</p>
                            <p className="text-gray-400 text-xs truncate">
                              {archive.djs.map(d => d.name).join(', ')} &middot;{' '}
                              {new Date(archive.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} &middot;{' '}
                              {Math.floor(archive.duration / 60)}min
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Broadcast link (for existing slots) */}
          {isEditing && modalTab === 'new-show' && (
            <div className="bg-black rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">Broadcast Link</span>
                <div className="flex gap-2">
                  {djEmail && (
                    <button
                      onClick={openDjEmail}
                      className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                        emailOpened
                          ? 'bg-green-600 text-white'
                          : 'bg-blue-600 hover:bg-blue-500 text-white'
                      }`}
                    >
                      {emailOpened ? 'Opened!' : 'Send Email'}
                    </button>
                  )}
                  <button
                    onClick={copyBroadcastLink}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                      copied
                        ? 'bg-green-600 text-white'
                        : 'bg-accent hover:bg-accent-hover text-white'
                    }`}
                  >
                    {copied ? 'Copied!' : 'Copy Link'}
                  </button>
                </div>
              </div>
              <div className="text-xs text-gray-500 font-mono truncate">
                {broadcastUrl}
              </div>
            </div>
          )}

          {/* Show Name + Image — only for new-show tab */}
          {modalTab === 'new-show' && <>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Show Name *</label>
            <input
              type="text"
              value={showName}
              onChange={(e) => setShowName(e.target.value)}
              placeholder="e.g., Sunday Sessions"
              className="w-full bg-black text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
            />
          </div>

          {/* Show Image */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Show Image</label>
            <div className="flex items-start gap-3">
              {/* Image preview or placeholder */}
              {showImageUrl ? (
                <div className="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0">
                  <Image
                    src={showImageUrl}
                    alt="Show image"
                    fill
                    className="object-cover"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute top-1 right-1 p-1 bg-black/70 hover:bg-black rounded-full transition-colors"
                    title="Remove image"
                  >
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="w-20 h-20 rounded-lg bg-black border border-gray-700 flex items-center justify-center flex-shrink-0">
                  <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}

              {/* Upload button and info */}
              <div className="flex-1">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  onChange={handleImageUpload}
                  className="hidden"
                  id="show-image-upload"
                />
                <label
                  htmlFor="show-image-upload"
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                    isUploadingImage
                      ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                      : 'bg-accent hover:bg-accent-hover text-white'
                  }`}
                >
                  {isUploadingImage ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Uploading...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      {showImageUrl ? 'Change Image' : 'Upload Image'}
                    </>
                  )}
                </label>
                <p className="text-gray-500 text-xs mt-1">
                  PNG, JPG, or WebP. Used in archives.
                </p>
                {imageUploadError && (
                  <p className="text-red-400 text-xs mt-1">{imageUploadError}</p>
                )}
              </div>
            </div>
          </div>
          </>}

          {/* Date & Time */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Start Date *</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => handleRestreamStartChange(setStartDate, e.target.value)}
                  className="w-full bg-black text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">End Date *</label>
                {isRestreamSelected ? (
                  // Determined by start + exact duration — read-only for restreams.
                  <div className="w-full bg-black/60 text-gray-300 border border-gray-800 rounded-lg px-3 py-2">
                    {endDate ? new Date(`${endDate}T00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—'}
                  </div>
                ) : (
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    min={startDate}
                    className="w-full bg-black text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                  />
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Start Time *</label>
                {isRestreamSelected && fitBeforeNext ? (
                  // Back-fitted from the next slot — read-only, second-accurate.
                  <div className="w-full bg-black/60 text-gray-300 border border-gray-800 rounded-lg px-3 py-2">
                    {restreamExactStartMs != null ? formatExactClock(restreamExactStartMs) : '—'}
                  </div>
                ) : (
                  <select
                    value={startTime}
                    onChange={(e) => handleRestreamStartChange(setStartTime, e.target.value)}
                    className="w-full bg-black text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                  >
                    {TIME_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">End Time *</label>
                {isRestreamSelected ? (
                  // Restream end is fully determined by start + exact archive
                  // duration (or = the next slot's start when back-fitting), so
                  // it's read-only and shown to the second.
                  <div className="w-full bg-black/60 text-gray-300 border border-gray-800 rounded-lg px-3 py-2">
                    {restreamExactEndMs != null ? formatExactClock(restreamExactEndMs) : '—'}
                  </div>
                ) : (
                  <select
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full bg-black text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                  >
                    {TIME_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Restream: end-right-before-next-slot toggle */}
            {isRestreamSelected && (
              <div className="bg-black/50 border border-gray-700 rounded-lg p-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={fitBeforeNext}
                    disabled={!nextSlot}
                    onChange={(e) => handleToggleFitBeforeNext(e.target.checked)}
                    className="accent-accent w-4 h-4"
                  />
                  <span className="text-sm text-gray-200">End right before next slot</span>
                </label>
                {nextSlot ? (
                  <p className="text-gray-400 text-xs">
                    {fitBeforeNext
                      ? `Starts ${restreamExactStartMs != null ? formatExactClock(restreamExactStartMs) : ''} so the audio ends right as "${nextSlot.showName}" begins (${formatExactClock(nextSlot.startTime)}).`
                      : `Next slot: "${nextSlot.showName}" at ${formatExactClock(nextSlot.startTime)}. Turn on to back-fit the start.`}
                  </p>
                ) : (
                  <p className="text-gray-500 text-xs">No upcoming slot to fit before.</p>
                )}
                {fitWarning && (
                  <p className="text-amber-400 text-xs">{fitWarning}</p>
                )}
              </div>
            )}

            {/* Overnight indicator */}
            {isOvernight && (
              <div className="bg-black/50 border border-gray-700 rounded-lg p-3 text-sm">
                <div className="flex items-center gap-2 text-gray-300">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                  <span>Overnight show</span>
                </div>
                <p className="text-gray-400 text-xs mt-1">
                  Ends {new Date(endDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {endTime}
                </p>
              </div>
            )}
          </div>

          {/* Broadcast Type and DJ info — only for new-show tab */}
          {modalTab === 'new-show' && <>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Broadcast Location</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setBroadcastType('venue')}
                className={`flex-1 p-3 rounded-lg border transition-colors ${
                  broadcastType === 'venue'
                    ? 'bg-accent/20 border-accent text-white'
                    : 'bg-black border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2 justify-center">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="font-medium">Venue</span>
                </div>
                <p className="text-xs mt-1 opacity-70">At the venue CDJs</p>
              </button>
              <button
                type="button"
                onClick={() => setBroadcastType('remote')}
                className={`flex-1 p-3 rounded-lg border transition-colors ${
                  broadcastType === 'remote'
                    ? 'bg-blue-600/20 border-blue-500 text-white'
                    : 'bg-black border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2 justify-center">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium">Remote</span>
                </div>
                <p className="text-xs mt-1 opacity-70">Unique link for DJ</p>
              </button>
            </div>
          </div>

          {/* DJ Lineup (venue only) */}
          {broadcastType === 'venue' && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">DJ Lineup</label>
              <div className="space-y-2">
                {djSlots.map((dj, index) => (
                  <div key={dj.id} className="bg-black rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-500 w-6">#{index + 1}</span>
                      <input
                        type="text"
                        value={dj.djName}
                        onChange={(e) => updateDjSlot(dj.id, 'djName', e.target.value)}
                        onBlur={(e) => lookupDjByNameInSlot(dj.id, e.target.value)}
                        placeholder="DJ Name"
                        className="flex-1 bg-gray-700 text-white border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-gray-500"
                      />
                      <button
                        type="button"
                        onClick={() => removeDjSlot(dj.id)}
                        className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    {/* DJ Emails with profile lookup (supports B3B with multiple DJs) */}
                    <div className="space-y-2 ml-6 mb-2">
                      {dj.djProfiles.map((profile, profileIndex) => (
                        <div key={profileIndex} className="flex items-center gap-2">
                          <input
                            type="email"
                            value={profile.email}
                            onChange={(e) => updateDjProfileEmail(dj.id, profileIndex, e.target.value)}
                            onBlur={(e) => lookupDjProfileInSlot(dj.id, profileIndex, e.target.value)}
                            placeholder={dj.djProfiles.length > 1 ? `DJ ${profileIndex + 1} Email` : "DJ Email (for tips & profile)"}
                            className="flex-1 bg-gray-700 text-white border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-gray-500"
                          />
                          {profile.isLookingUp && (
                            <span className="text-xs text-gray-400">Looking up...</span>
                          )}
                          {!profile.isLookingUp && profile.profileFound && (
                            <span className="text-xs text-green-400 flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              {profile.username || 'Found'}
                            </span>
                          )}
                          {isEditing && profile.email && (
                            <button
                              type="button"
                              onClick={() => {
                                const slotStartTs = new Date(`${dj.startDate}T${dj.startTime}`).getTime();
                                const slotEndTs = new Date(`${dj.endDate}T${dj.endTime}`).getTime();
                                openDjEmailForSlot(profile.email, dj.djName || 'there', slotStartTs, slotEndTs);
                              }}
                              className="px-2 py-0.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                              title="Send onboarding email"
                            >
                              Email
                            </button>
                          )}
                          {dj.djProfiles.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeDjProfileFromSlot(dj.id, profileIndex)}
                              className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                              title="Remove this DJ"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addDjProfileToSlot(dj.id)}
                        className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
                      >
                        + Add another DJ (B3B)
                      </button>
                    </div>
                    {/* Time selection - show dates for multi-day shows */}
                    <div className="flex items-center gap-2 ml-6 flex-wrap">
                      {isOvernight && (
                        <input
                          type="date"
                          value={dj.startDate}
                          onChange={(e) => updateDjSlot(dj.id, 'startDate', e.target.value)}
                          min={startDate}
                          max={endDate}
                          className="bg-gray-700 text-white border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-gray-500"
                        />
                      )}
                      <select
                        value={dj.startTime}
                        onChange={(e) => updateDjSlot(dj.id, 'startTime', e.target.value)}
                        className="bg-gray-700 text-white border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-gray-500"
                      >
                        {TIME_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <span className="text-gray-500">-</span>
                      {isOvernight && (
                        <input
                          type="date"
                          value={dj.endDate}
                          onChange={(e) => updateDjSlot(dj.id, 'endDate', e.target.value)}
                          min={startDate}
                          max={endDate}
                          className="bg-gray-700 text-white border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-gray-500"
                        />
                      )}
                      <select
                        value={dj.endTime}
                        onChange={(e) => updateDjSlot(dj.id, 'endTime', e.target.value)}
                        className="bg-gray-700 text-white border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-gray-500"
                      >
                        {TIME_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addDjSlot}
                  className="w-full py-2 border border-dashed border-gray-700 rounded-lg text-gray-400 hover:border-gray-600 hover:text-gray-300 transition-colors text-sm"
                >
                  + Add DJ Slot
                </button>
              </div>
            </div>
          )}

          {/* DJ Name & Email (remote only) */}
          {broadcastType === 'remote' && (
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-1">DJ Name</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={djName}
                    onChange={(e) => setDjName(e.target.value)}
                    onBlur={(e) => lookupRemoteDjByName(e.target.value)}
                    placeholder="e.g., DJ Shadow"
                    className="flex-1 bg-black text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                  />
                  {isLookingUpRemote && (
                    <span className="text-xs text-gray-400">Looking up...</span>
                  )}
                  {!isLookingUpRemote && remoteProfileFound && (
                    <span className={`text-xs flex items-center gap-1 ${remoteIsCollective ? 'text-purple-400' : 'text-green-400'}`}>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {remoteIsCollective ? 'Collective' : 'Profile found'}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">DJ Email</label>
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={djEmail}
                    onChange={(e) => setDjEmail(e.target.value)}
                    onBlur={(e) => lookupRemoteDjProfile(e.target.value)}
                    placeholder="dj@example.com"
                    className="flex-1 bg-black text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                  />
                </div>
                <p className="text-gray-500 text-xs mt-1">
                  Required for tips. Auto-fills from DJ profile if found.
                </p>
              </div>
            </>
          )}

          {/* Status badge (for existing slots) */}
          {isEditing && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Status:</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                slot?.status === 'live' ? 'bg-red-600 text-white' :
                slot?.status === 'scheduled' ? 'bg-accent text-white' :
                slot?.status === 'paused' ? 'bg-orange-600 text-white' :
                slot?.status === 'completed' ? 'bg-gray-600 text-white' :
                'bg-gray-600 text-gray-300'
              }`}>
                {slot?.status}
              </span>
            </div>
          )}

          {/* Recording download (for completed slots with recording) */}
          {isEditing && slot?.status === 'completed' && (
            <div className="bg-black rounded-lg p-3">
              <span className="text-sm text-gray-400">Recordings</span>

              {/* Multiple recordings (new format) */}
              {slot.recordings && slot.recordings.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {slot.recordings.map((recording: Recording, index: number) => (
                    <div key={recording.egressId} className="flex items-center justify-between bg-gray-800/50 rounded-lg p-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">Recording {index + 1}</span>
                        {recording.status === 'ready' && recording.duration && (
                          <span className="text-xs text-gray-500">
                            ({Math.floor(recording.duration / 60)}:{String(Math.floor(recording.duration % 60)).padStart(2, '0')})
                          </span>
                        )}
                        {recording.status === 'recording' && (
                          <span className="text-xs text-yellow-500">Recording...</span>
                        )}
                        {recording.status === 'processing' && (
                          <span className="text-xs text-blue-400">Processing...</span>
                        )}
                        {recording.status === 'failed' && (
                          <span className="text-xs text-red-400">Failed</span>
                        )}
                      </div>
                      {recording.status === 'ready' && recording.url && (
                        <a
                          href={recording.url}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium transition-colors flex items-center gap-1"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : slot.recordingStatus === 'ready' && slot.recordingUrl ? (
                /* Legacy single recording format (backward compatibility) */
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      {slot.recordingDuration
                        ? `${Math.floor(slot.recordingDuration / 60)}:${String(Math.floor(slot.recordingDuration % 60)).padStart(2, '0')}`
                        : 'Ready'}
                    </span>
                  </div>
                  <a
                    href={slot.recordingUrl}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </a>
                </div>
              ) : slot.recordingStatus === 'recording' ? (
                <p className="text-xs text-yellow-500 mt-1">Recording in progress...</p>
              ) : slot.recordingStatus === 'processing' ? (
                <p className="text-xs text-blue-400 mt-1">Processing...</p>
              ) : slot.recordingStatus === 'failed' ? (
                <p className="text-xs text-red-400 mt-1">Recording failed</p>
              ) : (
                <p className="text-xs text-gray-500 mt-1">No recording available</p>
              )}
            </div>
          )}
          </>}

          {/* Post-live archive (radio loop alignment). Optional — leave empty
              to let the cron pick a random archive at the loop anchor that
              follows this slot's live block. */}
          <div className="px-4 pb-4 border-t border-gray-800 pt-4 mt-2">
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
              Post-live archive (radio loop)
            </label>
            <p className="text-xs text-gray-500 mb-3">
              When the live block ending with this slot finishes, the archive radio plays an interlude then this archive at offset 0. Leave empty for random.
            </p>
            {postLiveArchive ? (
              <div className="flex items-center gap-3 bg-black/40 border border-white/10 rounded p-2">
                {postLiveArchive.showImageUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={postLiveArchive.showImageUrl} alt={postLiveArchive.showName} className="w-10 h-10 object-cover rounded" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{postLiveArchive.showName}</p>
                  <p className="text-[11px] text-gray-500 truncate">
                    {postLiveArchive.djs.map(d => d.name).join(', ')} ·{' '}
                    {Math.floor(postLiveArchive.duration / 3600)}h{Math.floor((postLiveArchive.duration % 3600) / 60).toString().padStart(2, '0')}m
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPostLiveArchive(null)}
                  className="text-xs text-gray-400 hover:text-white px-2 py-1"
                >
                  Clear
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPostLivePickerOpen((v) => !v);
                  if (!archivesLoaded) fetchArchives();
                }}
                className="text-xs text-gray-300 hover:text-white px-3 py-1.5 border border-white/15 rounded"
              >
                {postLivePickerOpen ? 'Cancel' : 'Pick archive…'}
              </button>
            )}
            {postLivePickerOpen && !postLiveArchive && (
              <div className="mt-3 border border-white/10 rounded bg-black/20">
                <input
                  type="text"
                  value={postLiveSearchQuery}
                  onChange={(e) => setPostLiveSearchQuery(e.target.value)}
                  placeholder="Search shows or DJs"
                  className="w-full px-3 py-2 bg-transparent text-sm text-white placeholder-gray-500 border-b border-white/10 focus:outline-none"
                />
                <div className="max-h-56 overflow-y-auto">
                  {archives
                    .filter((a) => priorityIsHigh(a.priority) && a.duration >= 1800)
                    .filter((a) => {
                      if (!postLiveSearchQuery) return true;
                      const q = postLiveSearchQuery.toLowerCase();
                      return a.showName.toLowerCase().includes(q)
                        || a.djs.some((d) => d.name.toLowerCase().includes(q));
                    })
                    .slice(0, 50)
                    .map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setPostLiveArchive(a);
                          setPostLivePickerOpen(false);
                          setPostLiveSearchQuery('');
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-white/5 border-b border-white/5 last:border-0"
                      >
                        <p className="text-sm text-white truncate">{a.showName}</p>
                        <p className="text-[11px] text-gray-500 truncate">
                          {a.djs.map(d => d.name).join(', ')} ·{' '}
                          {Math.floor(a.duration / 60)} min
                        </p>
                      </button>
                    ))}
                  {!archivesLoaded && (
                    <p className="text-xs text-gray-500 px-3 py-3">Loading archives…</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Go-live emails — disable for test broadcasts so the cron doesn't
              email real subscribers when you take a real slot live to test. */}
          <div className="px-4 pb-4 border-t border-gray-800 pt-4 mt-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={goLiveEmailsDisabled}
                onChange={(e) => setGoLiveEmailsDisabled(e.target.checked)}
                className="w-4 h-4 flex-shrink-0 accent-white"
              />
              <span className="text-sm text-gray-200">Disable go-live emails (testing)</span>
            </label>
            <p className="text-xs text-gray-500 mt-1.5">
              When checked, the show-starting cron skips this slot — no go-live notifications are sent. Use when testing a real go-live or restream.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-800 sticky bottom-0 bg-[#252525]">
          {isEditing && onDelete ? (
            <button
              onClick={handleDelete}
              disabled={isSaving}
              className="px-4 py-2 text-red-400 hover:bg-red-900/30 rounded-lg transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          ) : (
            <div />
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:bg-black rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !startDate || !endDate || !startTime || !endTime || (modalTab === 'archives' ? !selectedArchive : !showName)}
              className={`px-4 py-2 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors ${
                modalTab === 'archives' ? 'bg-purple-600 hover:bg-purple-500' : 'bg-accent hover:bg-accent-hover'
              }`}
            >
              {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : modalTab === 'archives' ? 'Schedule Restream' : 'Create Show'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
