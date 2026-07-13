'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isBroadcaster } from '@/hooks/useUserRole';
import { Header } from '@/components/Header';
import { normalizeUrl } from '@/lib/url';
import { uploadEventPhoto, deleteEventPhoto, validatePhoto } from '@/lib/photo-upload';
import { Event, EventDJRef, EventVenueRef, Venue, Collective, CollectiveRef } from '@/types/events';
import { ScenePillEditor } from '@/components/broadcast/admin/ScenePillEditor';
import { CreatableChipField } from '@/components/events/CreatableChipField';
import { normalizeUsername } from '@/lib/dj-matching';
import { useScenesData } from '@/hooks/useScenesData';

interface DJOption {
  label: string;
  djName: string;
  djUserId?: string;
  djUsername?: string;
  djPhotoUrl?: string;
  source: 'user' | 'pending';
}

export function EventsAdmin() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);
  const { scenes: adminScenes, djSceneMap } = useScenesData();

  // Edit mode
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [date, setDate] = useState('');           // YYYY-MM-DD
  const [startTime, setStartTime] = useState('20:00'); // HH:MM, defaults to 8:00 PM
  const [eventLinkedVenues, setEventLinkedVenues] = useState<EventVenueRef[]>([]);
  const [eventLinkedCollectives, setEventLinkedCollectives] = useState<CollectiveRef[]>([]);
  const [location, setLocation] = useState('');
  const [ticketLink, setTicketLink] = useState('');
  const [discountCode, setDiscountCode] = useState('');
  const [djs, setDjs] = useState<EventDJRef[]>([]);
  // Scene override: null = inherit from DJs + collectives; [] = pinned to no scene; [ids] = pinned.
  const [sceneIdsOverride, setSceneIdsOverride] = useState<string[] | null>(null);

  // Photo state
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // UI state
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Data
  const [events, setEvents] = useState<Event[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [collectives, setCollectives] = useState<Collective[]>([]);
  const [djOptions, setDjOptions] = useState<DJOption[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  // Inherited scenes = union of sceneIds from all attached DJs + collectives.
  const inheritedEventScenes = useMemo(() => {
    const out = new Set<string>();
    for (const dj of djs) {
      if (dj.djUserId) {
        for (const id of djSceneMap.byUserId.get(dj.djUserId) ?? []) out.add(id);
      }
      if (dj.djUsername) {
        const key = normalizeUsername(dj.djUsername);
        for (const id of djSceneMap.byUsername.get(key) ?? []) out.add(id);
      }
    }
    for (const ref of eventLinkedCollectives) {
      const c = collectives.find((cc) => cc.id === ref.collectiveId);
      for (const id of c?.sceneIds ?? []) out.add(id);
    }
    return Array.from(out);
  }, [djs, eventLinkedCollectives, djSceneMap, collectives]);

  const hasBroadcasterAccess = isBroadcaster(role);

  // Fetch venues for the dropdown
  const fetchVenues = useCallback(async () => {
    if (!db) return;
    try {
      const venuesRef = collection(db, 'venues');
      const snapshot = await getDocs(venuesRef);
      const venuesList: Venue[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        venuesList.push({
          id: docSnap.id,
          name: data.name,
          slug: data.slug,
          location: data.location || null,
          createdAt: data.createdAt?.toMillis?.() || Date.now(),
          createdBy: data.createdBy,
        });
      });
      venuesList.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      setVenues(venuesList);
    } catch (err) {
      console.error('Error fetching venues:', err);
    }
  }, []);

  // Fetch collectives for the dropdown
  const fetchCollectives = useCallback(async () => {
    if (!db) return;
    try {
      const collectivesRef = collection(db, 'collectives');
      const snapshot = await getDocs(collectivesRef);
      const collectivesList: Collective[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        collectivesList.push({
          id: docSnap.id,
          name: data.name,
          slug: data.slug,
          location: data.location || null,
          createdAt: data.createdAt?.toMillis?.() || Date.now(),
          createdBy: data.createdBy,
        });
      });
      collectivesList.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      setCollectives(collectivesList);
    } catch (err) {
      console.error('Error fetching collectives:', err);
    }
  }, []);

  // Fetch all available DJs (pending profiles + DJ users)
  const fetchDJOptions = useCallback(async () => {
    if (!db) return;
    try {
      const options: DJOption[] = [];
      const seenUsernames = new Set<string>();

      const pendingRef = collection(db, 'pending-dj-profiles');
      const pendingSnapshot = await getDocs(pendingRef);
      pendingSnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.status !== 'pending') return;
        const username = data.chatUsernameNormalized || '';
        if (username) seenUsernames.add(username);
        options.push({
          label: data.chatUsername || data.chatUsernameNormalized || 'Unknown',
          djName: data.chatUsername || data.chatUsernameNormalized || 'Unknown',
          djUsername: data.chatUsernameNormalized,
          djPhotoUrl: data.djProfile?.photoUrl || undefined,
          source: 'pending',
        });
      });

      const usersRef = collection(db, 'users');
      const djQuery = query(usersRef, where('role', 'in', ['dj', 'broadcaster', 'admin']));
      const usersSnapshot = await getDocs(djQuery);
      usersSnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const username = data.chatUsernameNormalized || '';
        if (username && seenUsernames.has(username)) return;
        options.push({
          label: data.chatUsername || data.displayName || 'Unknown',
          djName: data.chatUsername || data.displayName || 'Unknown',
          djUserId: docSnap.id,
          djUsername: data.chatUsernameNormalized || data.chatUsername,
          djPhotoUrl: data.djProfile?.photoUrl || undefined,
          source: 'user',
        });
      });

      options.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
      setDjOptions(options);
    } catch (err) {
      console.error('Error fetching DJ options:', err);
    }
  }, []);

  // Fetch existing events
  const fetchEvents = useCallback(async () => {
    if (!db) {
      setLoadingEvents(false);
      return;
    }
    try {
      const eventsRef = collection(db, 'events');
      const snapshot = await getDocs(eventsRef);
      const eventsList: Event[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        eventsList.push({
          id: docSnap.id,
          name: data.name,
          slug: data.slug,
          date: data.date,
          endDate: data.endDate || undefined,
          photo: data.photo || null,
          description: data.description || null,
          venueId: data.venueId || null,
          venueName: data.venueName || null,
          venueCollectiveId: data.venueCollectiveId || null,
          venueCollectiveName: data.venueCollectiveName || null,
          venueCollectiveSlug: data.venueCollectiveSlug || null,
          linkedVenues: data.linkedVenues || [],
          linkedCollectives: data.linkedCollectives || [],
          djs: data.djs || [],
          genres: data.genres || [],
          location: data.location || null,
          ticketLink: data.ticketLink || null,
          discountCode: data.discountCode || null,
          socialLinks: data.socialLinks || {},
          sceneIdsOverride: data.sceneIdsOverride === undefined ? undefined : data.sceneIdsOverride,
          createdAt: data.createdAt?.toMillis?.() || Date.now(),
          createdBy: data.createdBy,
        });
      });
      // Sort by createdAt descending (most recently created on top)
      eventsList.sort((a, b) => b.createdAt - a.createdAt);
      setEvents(eventsList);
    } catch (err) {
      console.error('Error fetching events:', err);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && hasBroadcasterAccess) {
      fetchVenues();
      fetchCollectives();
      fetchEvents();
      fetchDJOptions();
    } else {
      setLoadingEvents(false);
    }
  }, [isAuthenticated, hasBroadcasterAccess, fetchVenues, fetchCollectives, fetchEvents, fetchDJOptions]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/radio-portal');
    }
  }, [authLoading, isAuthenticated, router]);

  // Get the UTC offset (in minutes) for a given date in America/Los_Angeles
  const getPDTOffset = (date: Date) => {
    const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
    const pdtStr = date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    return (new Date(utcStr).getTime() - new Date(pdtStr).getTime()) / 60000;
  };

  // Convert Unix ms to datetime-local string in PDT
  const msToDatetimeLocal = (ms: number) => {
    const d = new Date(ms);
    const offsetMin = getPDTOffset(d);
    const local = new Date(d.getTime() - offsetMin * 60 * 1000);
    return local.toISOString().slice(0, 16);
  };

  // Convert datetime-local string to Unix ms (interpreting input as PDT)
  const datetimeLocalToMs = (val: string) => {
    // Parse as if the input is in America/Los_Angeles
    // datetime-local gives us "YYYY-MM-DDTHH:MM" with no timezone
    const naive = new Date(val + 'Z'); // treat as UTC first
    const offsetMin = getPDTOffset(naive);
    return naive.getTime() + offsetMin * 60 * 1000;
  };

  const resetForm = () => {
    setName('');
    setDate('');
    setStartTime('20:00');
    setEventLinkedVenues([]);
    setEventLinkedCollectives([]);
    setLocation('');
    setTicketLink('');
    setDiscountCode('');
    setDjs([]);
    setSceneIdsOverride(null);
    setPhotoUrl(null);
    setPhotoError(null);
    setEditingEvent(null);
    setError(null);
    setSuccess(null);
  };

  const startEditing = (event: Event) => {
    setEditingEvent(event);
    setName(event.name);
    // Split the stored start ms (PDT-anchored "YYYY-MM-DDTHH:MM") into date + time.
    const [datePart, timePart] = msToDatetimeLocal(event.date).split('T');
    setDate(datePart || '');
    setStartTime(timePart || '20:00');
    // Populate venue chips from arrays, or fall back to legacy single fields
    // (venueId/venueName, or a legacy manual venueName with no id).
    const lv = event.linkedVenues || [];
    if (lv.length > 0) {
      setEventLinkedVenues(lv);
    } else if (event.venueName) {
      setEventLinkedVenues([{ venueId: event.venueId || '', venueName: event.venueName }]);
    } else {
      setEventLinkedVenues([]);
    }
    const lc = event.linkedCollectives || [];
    if (lc.length === 0 && event.collectiveId && event.collectiveName) {
      setEventLinkedCollectives([{ collectiveId: event.collectiveId, collectiveName: event.collectiveName }]);
    } else {
      setEventLinkedCollectives(lc);
    }
    setLocation(event.location || '');
    setTicketLink(event.ticketLink || '');
    setDiscountCode(event.discountCode || '');
    setDjs(event.djs.length > 0 ? event.djs : [{ djName: '' }]);
    setSceneIdsOverride(
      event.sceneIdsOverride === undefined ? null : event.sceneIdsOverride
    );
    setPhotoUrl(event.photo || null);
    setPhotoError(null);
    setError(null);
    setSuccess(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoError(null);
    const validation = validatePhoto(file);
    if (!validation.valid) {
      setPhotoError(validation.error || 'Invalid file');
      return;
    }

    const eventId = editingEvent?.id || `temp-${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    setUploadingPhoto(true);
    try {
      const result = await uploadEventPhoto(eventId, file);
      if (!result.success) {
        setPhotoError(result.error || 'Upload failed');
        return;
      }
      setPhotoUrl(result.url || null);
    } catch {
      setPhotoError('Failed to upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!photoUrl) return;
    const eventId = editingEvent?.id || `temp-${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    setUploadingPhoto(true);
    try {
      await deleteEventPhoto(eventId, photoUrl);
      setPhotoUrl(null);
    } catch {
      setPhotoError('Failed to remove photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError('Event name is required');
      return;
    }

    if (!date) {
      setError('Event date is required');
      return;
    }

    setSaving(true);

    try {
      const token = await user?.getIdToken();
      if (!token) {
        setError('Not authenticated');
        setSaving(false);
        return;
      }

      const filteredDJs = djs.filter(dj => dj.djName.trim());

      const payload = {
        ...(editingEvent ? { eventId: editingEvent.id } : {}),
        name: name.trim(),
        date: datetimeLocalToMs(`${date}T${startTime || '20:00'}`),
        endDate: null, // events no longer have an end time; clear any legacy value
        photo: photoUrl,
        venueId: eventLinkedVenues.length > 0 ? (eventLinkedVenues[0].venueId || null) : null,
        venueName: eventLinkedVenues.length > 0 ? eventLinkedVenues[0].venueName : null,
        venueCollectiveId: null, // collective-as-venue removed; clear any legacy value
        collectiveId: eventLinkedCollectives.length > 0 ? eventLinkedCollectives[0].collectiveId : null,
        linkedVenues: eventLinkedVenues,
        linkedCollectives: eventLinkedCollectives,
        djs: filteredDJs,
        sceneIdsOverride: sceneIdsOverride,
        location: location.trim() || null,
        ticketLink: ticketLink.trim() ? normalizeUrl(ticketLink.trim()) : null,
        discountCode: discountCode.trim() || null,
      };

      const res = await fetch('/api/admin/events', {
        method: editingEvent ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok) {
        setError(result.error || 'Failed to save event');
        return;
      }

      setSuccess(editingEvent ? 'Event updated!' : 'Event created!');
      resetForm();
      fetchEvents();
    } catch (err) {
      console.error('Error saving event:', err);
      setError('Failed to save event');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (eventId: string) => {
    if (!confirm('Are you sure you want to delete this event?')) return;

    setDeleting(true);
    try {
      const token = await user?.getIdToken();
      if (!token) return;

      const res = await fetch(`/api/admin/events?eventId=${eventId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setSuccess('Event deleted');
        if (editingEvent?.id === eventId) resetForm();
        fetchEvents();
      } else {
        const result = await res.json();
        setError(result.error || 'Failed to delete event');
      }
    } catch {
      setError('Failed to delete event');
    } finally {
      setDeleting(false);
    }
  };

  // Format date for display (always in PDT)
  const formatEventDate = (ms: number) => {
    return new Date(ms).toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Auth/role loading
  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <Header currentPage="broadcast-admin" position="sticky" />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 60px)' }}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <Header currentPage="broadcast-admin" position="sticky" />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 60px)' }}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      </div>
    );
  }

  if (!hasBroadcasterAccess) {
    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <Header currentPage="broadcast-admin" position="sticky" />
        <div className="flex items-center justify-center p-8" style={{ minHeight: 'calc(100vh - 60px)' }}>
          <div className="bg-[#252525] rounded-xl p-8 max-w-md text-center">
            <h1 className="text-xl font-bold text-white mb-2">Access Denied</h1>
            <p className="text-gray-400">You don&apos;t have broadcaster permissions.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Header currentPage="broadcast-admin" position="sticky" />
      <div className="p-4 md:p-8">
        <div className="max-w-3xl mx-auto">
          {/* Back link */}
          <Link
            href="/broadcast/admin"
            className="text-gray-400 hover:text-white text-sm mb-6 inline-block"
          >
            &larr; Back to Admin
          </Link>

          <h1 className="text-2xl font-bold mb-6">
            {editingEvent ? 'Edit Event' : 'Create Event'}
          </h1>

          {/* Messages */}
          {error && (
            <div className="bg-red-900/50 border border-red-700 rounded-lg px-4 py-3 mb-4 text-red-200">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-900/50 border border-green-700 rounded-lg px-4 py-3 mb-4 text-green-200">
              {success}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="bg-[#1a1a1a] rounded-xl p-6 mb-8">
            {/* Name */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Event Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                placeholder="e.g. Summer Solstice Party"
                required
              />
            </div>

            {/* Date + Time (start only) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Date *</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white [color-scheme:dark]"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Start Time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white [color-scheme:dark]"
                />
              </div>
            </div>

            {/* Photo / Flyer */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">Flyer / Photo</label>
              <div className="flex items-start gap-4">
                <div className="relative w-24 h-24 bg-[#252525] rounded-lg overflow-hidden flex-shrink-0">
                  {photoUrl ? (
                    <Image
                      src={photoUrl}
                      alt="Event flyer"
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500">
                      <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  {uploadingPhoto && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <label className="cursor-pointer bg-[#252525] hover:bg-[#303030] border border-gray-700 rounded-lg px-4 py-2 text-sm text-white transition-colors inline-flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {photoUrl ? 'Change photo' : 'Upload photo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      onChange={handlePhotoChange}
                      disabled={uploadingPhoto}
                      className="hidden"
                    />
                  </label>
                  {photoUrl && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      disabled={uploadingPhoto}
                      className="text-red-400 hover:text-red-300 text-sm transition-colors text-left"
                    >
                      Remove photo
                    </button>
                  )}
                  <p className="text-xs text-gray-500">JPG, PNG, GIF, or WebP. Max 10MB.</p>
                </div>
              </div>
              {photoError && (
                <p className="text-red-400 text-sm mt-2">{photoError}</p>
              )}
            </div>

            {/* Venue — search available venues or type a new name */}
            <div className="mb-4">
              <CreatableChipField<Venue, EventVenueRef>
                label="Venue"
                options={venues}
                selected={eventLinkedVenues}
                optionLabel={(v) => v.location ? `${v.name} (${v.location})` : v.name}
                selectedLabel={(s) => s.venueName}
                optionKey={(v) => v.id}
                selectedKey={(s) => s.venueId || normalizeUsername(s.venueName)}
                toSelected={(v) => {
                  if (!location && v.location) setLocation(v.location);
                  return { venueId: v.id, venueName: v.name };
                }}
                freeTextToSelected={(text) => ({ venueId: '', venueName: text })}
                onChange={setEventLinkedVenues}
                placeholder="Search a venue, or type a new name"
              />
            </div>

            {/* Linked Collectives — search available collectives or type a new name */}
            <div className="mb-4">
              <CreatableChipField<Collective, CollectiveRef>
                label="Linked Collectives"
                options={collectives}
                selected={eventLinkedCollectives}
                optionLabel={(c) => c.location ? `${c.name} (${c.location})` : c.name}
                selectedLabel={(s) => s.collectiveName}
                optionKey={(c) => c.id}
                selectedKey={(s) => s.collectiveId || normalizeUsername(s.collectiveName)}
                toSelected={(c) => ({ collectiveId: c.id, collectiveName: c.name, collectiveSlug: c.slug, collectivePhoto: c.photo || null })}
                freeTextToSelected={(text) => ({ collectiveId: '', collectiveName: text })}
                onChange={setEventLinkedCollectives}
                placeholder="Search a collective, or type a new name"
              />
            </div>

            {/* Location */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">City</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                placeholder="Berlin"
              />
            </div>

            {/* Ticket Link */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Ticket Link</label>
              <input
                type="text"
                value={ticketLink}
                onChange={(e) => setTicketLink(e.target.value)}
                className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                placeholder="https://ra.co/events/..."
              />
            </div>

            {/* Discount Code */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Discount Code</label>
              <input
                type="text"
                value={discountCode}
                onChange={(e) => setDiscountCode(e.target.value)}
                className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                placeholder="e.g. CHANNEL20"
              />
            </div>

            {/* DJs — search available DJs or type a new name */}
            <div className="mb-6">
              <CreatableChipField<DJOption, EventDJRef>
                label="DJs Playing"
                options={djOptions}
                selected={djs}
                optionLabel={(o) => o.label}
                selectedLabel={(s) => s.djUsername ? `${s.djName} @${s.djUsername}` : s.djName}
                optionKey={(o) => o.djUserId || o.djUsername || normalizeUsername(o.djName)}
                selectedKey={(s) => s.djUserId || s.djUsername || normalizeUsername(s.djName)}
                toSelected={(o) => ({ djName: o.djName, djUserId: o.djUserId, djUsername: o.djUsername, djPhotoUrl: o.djPhotoUrl })}
                freeTextToSelected={(text) => ({ djName: text })}
                onChange={setDjs}
                placeholder="Search a DJ, or type a new name"
              />
            </div>

            {/* Scene assignment */}
            <div className="mb-6">
              <label className="block text-sm text-gray-400 mb-2">
                Scenes{' '}
                <span className="text-xs text-gray-600">
                  (inherits from DJs + collectives unless pinned)
                </span>
              </label>
              <ScenePillEditor
                scenes={adminScenes}
                selectedSceneIds={sceneIdsOverride}
                inheritedSceneIds={inheritedEventScenes}
                onToggle={(sceneId) => {
                  const current = Array.isArray(sceneIdsOverride)
                    ? sceneIdsOverride
                    : inheritedEventScenes;
                  setSceneIdsOverride(
                    current.includes(sceneId)
                      ? current.filter((id) => id !== sceneId)
                      : [...current, sceneId]
                  );
                }}
                onReset={() => setSceneIdsOverride(null)}
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingEvent ? 'Update Event' : 'Create Event'}
              </button>
              {editingEvent && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-6 py-3 bg-gray-800 text-gray-300 font-medium rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          {/* Existing Events List */}
          <h2 className="text-lg font-bold mb-4">Existing Events ({events.length})</h2>
          {loadingEvents ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
            </div>
          ) : events.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No events yet</p>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="bg-[#1a1a1a] rounded-lg p-4 flex items-center gap-4"
                >
                  {event.photo ? (
                    <Image
                      src={event.photo}
                      alt={event.name}
                      width={48}
                      height={48}
                      className="w-12 h-12 rounded-lg object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-[#252525] flex items-center justify-center">
                      <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{event.name}</p>
                    <p className="text-gray-500 text-sm truncate">
                      {formatEventDate(event.date)}
                      {event.linkedVenues && event.linkedVenues.length > 0
                        ? <> &middot; {event.linkedVenues.map(v => v.venueName).join(', ')}</>
                        : event.venueName
                          ? <> &middot; {event.venueName}</>
                          : event.location && <> &middot; {event.location}</>
                      }
                    </p>
                    {event.djs.length > 0 && (
                      <p className="text-gray-400 text-sm truncate mt-1">
                        {event.djs.map((dj, i) => (
                          <span key={`${dj.djUsername || dj.djName}-${i}`}>
                            {i > 0 && ', '}
                            {dj.djUsername ? (
                              <Link
                                href={`/dj/${dj.djUsername}`}
                                className="text-gray-300 hover:text-white underline"
                              >
                                {dj.djName}
                              </Link>
                            ) : (
                              <span>{dj.djName}</span>
                            )}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEditing(event)}
                      className="text-sm text-gray-400 hover:text-white px-3 py-1 rounded border border-gray-700 hover:border-gray-500"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(event.id)}
                      disabled={deleting}
                      className="text-sm text-red-400 hover:text-red-300 px-3 py-1 rounded border border-gray-700 hover:border-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
