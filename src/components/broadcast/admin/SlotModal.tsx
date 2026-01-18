'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { BroadcastSlotSerialized, BroadcastType, DJSlot, DJProfileInfo, Recording } from '@/types/broadcast';
import { uploadShowImage, validatePhoto } from '@/lib/photo-upload';

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
  }) => Promise<void>;
  onDelete?: (slotId: string) => Promise<void>;
  initialStartTime?: Date;
  initialEndTime?: Date;
}

// Individual DJ profile for B3B (with UI state)
interface LocalDJProfile {
  email: string;
  userId?: string;
  username?: string;
  usernameNormalized?: string;
  bio?: string;
  photoUrl?: string;
  promoText?: string;
  promoHyperlink?: string;
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
  djPromoText?: string;
  djPromoHyperlink?: string;
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
  const [isLookingUpRemote, setIsLookingUpRemote] = useState(false);
  // Show image state
  const [showImageUrl, setShowImageUrl] = useState<string | undefined>(undefined);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

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
          promoText: undefined,
          promoHyperlink: undefined,
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
            promoText: data.djPromoText,
            promoHyperlink: data.djPromoHyperlink,
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
            promoText: undefined,
            promoHyperlink: undefined,
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

  // Check if this is an overnight show
  const isOvernight = startDate && endDate && endDate > startDate;

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
      if (slot) {
        // Editing existing slot
        const start = new Date(slot.startTime);
        const end = new Date(slot.endTime);
        setShowName(slot.showName || '');
        setDjName(slot.djName || '');
        setDjEmail(slot.djEmail || '');
        setShowImageUrl(slot.showImageUrl);
        // Use local date formatting to avoid timezone issues
        setStartDate(formatLocalDate(start));
        setEndDate(formatLocalDate(end));
        setStartTime(snapToHalfHour(start.toTimeString().slice(0, 5)));
        setEndTime(snapToHalfHour(end.toTimeString().slice(0, 5)));
        setBroadcastType(slot.broadcastType || 'remote');

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
                promoText: p.promoText,
                promoHyperlink: p.promoHyperlink,
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
                promoText: dj.djPromoText,
                promoHyperlink: dj.djPromoHyperlink,
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
              djPromoText: dj.djPromoText,
              djPromoHyperlink: dj.djPromoHyperlink,
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
        setShowName('');
        setDjName('');
        setDjEmail('');
        setShowImageUrl(undefined);
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
    console.log('[SlotModal] handleSave called with:', { showName, startDate, endDate, startTime, endTime, broadcastType, djSlotsCount: djSlots.length });
    if (!showName || !startDate || !endDate || !startTime || !endTime) {
      console.log('[SlotModal] Validation failed:', { showName: !showName, startDate: !startDate, endDate: !endDate, startTime: !startTime, endTime: !endTime });
      return;
    }

    setIsSaving(true);
    try {
      const startDateTime = new Date(`${startDate}T${startTime}`).getTime();
      const endDateTime = new Date(`${endDate}T${endTime}`).getTime();

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
                promoText: p.promoText || undefined,
                promoHyperlink: p.promoHyperlink || undefined,
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
              djPromoText: firstProfile?.promoText || undefined,
              djPromoHyperlink: firstProfile?.promoHyperlink || undefined,
              djThankYouMessage: firstProfile?.thankYouMessage || undefined,
              djSocialLinks: firstProfile?.socialLinks || undefined,
              // B3B support: all DJ profiles
              djProfiles: djProfiles.length > 0 ? djProfiles : undefined,
            };
          })
        : undefined;

      await onSave({
        showName,
        djName: broadcastType === 'remote' ? (djName || undefined) : undefined,
        djEmail: djEmail || undefined,  // Same for both venue and remote
        djSlots: convertedDjSlots,
        startTime: startDateTime,
        endTime: endDateTime,
        broadcastType,
        showImageUrl,
      });
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
  const openDjEmailWithDetails = (targetEmail: string, targetDjName: string, slotStart: number, slotEnd: number) => {
    if (!slot) return;

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

    const subject = `You're scheduled to livestream on Channel — ${formattedDate}`;
    const body = `Hi ${targetDjName},

You're officially scheduled to livestream on Channel!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Show: ${showName}
Date: ${formattedDate}
Time: ${formattedStart} – ${formattedEnd} ${djTz}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. COMPLETE YOUR DJ PROFILE

Your DJ profile is what listeners see on our calendar, in your show details, and while you're live. A complete profile helps people connect with you and support your work.

Please take a few minutes to set up your DJ profile. IMPORTANT: Sign up using THIS email address (${targetEmail}) so we can link your profile to your scheduled show.
→ https://channel-app.com/studio

• Connect Stripe so you can receive listener support during your set. If Stripe isn't connected, listeners can still send support — but payouts will be delayed until you finish setup.
  See our setup guide: https://channel-app.com/stripe-setup

• Add a profile photo (this shows up during your set)
• Write a short bio (who you are / what you play)
• Add a promo text
• Add anything you want to show on your personal DJ page

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

2. PREPARE YOUR LIVE STREAM

You'll broadcast using your private link below. Do not share this link.

Your broadcast link:
${broadcastUrl}

We strongly recommend:
• Opening the link ahead of time
• Doing a quick test stream (sound levels, connection, device)
• Using the same setup you'll use for the live set

→ Full streaming setup guide: https://channel-app.com/streaming-guide

Need help? Contact support@channel-app.com

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

3. DAY OF THE SHOW

• Join a few minutes early
• Once you hit "Go Live," listeners will be able to tune in, chat, and support you in real time
• You'll see live feedback and support messages during the set
• Share your live stream URL: https://channel-app.com/channel

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

That's it — we're excited to have you on Channel.

See you on air,
– The Channel Team`;

    const mailto = `mailto:${targetEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, '_blank');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-[#252525] rounded-xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800 sticky top-0 bg-[#252525] z-10">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Edit Show' : 'New Show'}
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

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Broadcast link (for existing slots) */}
          {isEditing && (
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

          {/* Show Name (REQUIRED) */}
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

          {/* Date & Time */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Start Date *</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-black text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">End Date *</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  className="w-full bg-black text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Start Time *</label>
                <select
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-black text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                >
                  {TIME_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">End Time *</label>
                <select
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-black text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                >
                  {TIME_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

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

          {/* Broadcast Type */}
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
                <input
                  type="text"
                  value={djName}
                  onChange={(e) => setDjName(e.target.value)}
                  placeholder="e.g., DJ Shadow"
                  className="w-full bg-black text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                />
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
                  {isLookingUpRemote && (
                    <span className="text-xs text-gray-400">Looking up...</span>
                  )}
                  {!isLookingUpRemote && remoteProfileFound && (
                    <span className="text-xs text-green-400 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Profile found
                    </span>
                  )}
                </div>
                <p className="text-gray-500 text-xs mt-1">
                  Required for tips. Auto-fills DJ profile if account exists.
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
              disabled={isSaving || !showName || !startDate || !endDate || !startTime || !endTime}
              className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
            >
              {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Show'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
