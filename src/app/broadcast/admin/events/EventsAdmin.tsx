'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isBroadcaster } from '@/hooks/useUserRole';
import { BroadcastHeader } from '@/components/BroadcastHeader';
import { normalizeUrl } from '@/lib/url';
import { uploadEventPhoto, deleteEventPhoto, validatePhoto } from '@/lib/photo-upload';
import { Event, EventDJRef, Venue } from '@/types/events';

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

  // Edit mode
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [venueId, setVenueId] = useState('');
  const [location, setLocation] = useState('');
  const [genres, setGenres] = useState('');
  const [ticketLink, setTicketLink] = useState('');
  const [djs, setDjs] = useState<EventDJRef[]>([{ djName: '' }]);

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
  const [djOptions, setDjOptions] = useState<DJOption[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

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
          djs: data.djs || [],
          genres: data.genres || [],
          location: data.location || null,
          ticketLink: data.ticketLink || null,
          createdAt: data.createdAt?.toMillis?.() || Date.now(),
          createdBy: data.createdBy,
        });
      });
      // Sort by date descending (newest first)
      eventsList.sort((a, b) => b.date - a.date);
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
      fetchEvents();
      fetchDJOptions();
    } else {
      setLoadingEvents(false);
    }
  }, [isAuthenticated, hasBroadcasterAccess, fetchVenues, fetchEvents, fetchDJOptions]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/radio-portal');
    }
  }, [authLoading, isAuthenticated, router]);

  // Convert Unix ms to datetime-local string
  const msToDatetimeLocal = (ms: number) => {
    const d = new Date(ms);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60 * 1000);
    return local.toISOString().slice(0, 16);
  };

  // Convert datetime-local string to Unix ms
  const datetimeLocalToMs = (val: string) => {
    return new Date(val).getTime();
  };

  const resetForm = () => {
    setName('');
    setDate('');
    setEndDate('');
    setDescription('');
    setVenueId('');
    setLocation('');
    setGenres('');
    setTicketLink('');
    setDjs([{ djName: '' }]);
    setPhotoUrl(null);
    setPhotoError(null);
    setEditingEvent(null);
    setError(null);
    setSuccess(null);
  };

  const startEditing = (event: Event) => {
    setEditingEvent(event);
    setName(event.name);
    setDate(msToDatetimeLocal(event.date));
    setEndDate(event.endDate ? msToDatetimeLocal(event.endDate) : '');
    setDescription(event.description || '');
    setVenueId(event.venueId || '');
    setLocation(event.location || '');
    setGenres(event.genres?.join(', ') || '');
    setTicketLink(event.ticketLink || '');
    setDjs(event.djs.length > 0 ? event.djs : [{ djName: '' }]);
    setPhotoUrl(event.photo || null);
    setPhotoError(null);
    setError(null);
    setSuccess(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // When venue is selected, auto-fill location
  const handleVenueChange = (selectedVenueId: string) => {
    setVenueId(selectedVenueId);
    if (selectedVenueId) {
      const venue = venues.find(v => v.id === selectedVenueId);
      if (venue?.location && !location) {
        setLocation(venue.location);
      }
    }
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

  // Handle selecting a DJ from the dropdown
  const handleDJSelect = (index: number, value: string) => {
    const updated = [...djs];
    if (value === '__manual__') {
      updated[index] = { djName: '' };
    } else {
      const option = djOptions.find(o => (o.djUsername || o.djName) === value);
      if (option) {
        updated[index] = {
          djName: option.djName,
          djUserId: option.djUserId,
          djUsername: option.djUsername,
          djPhotoUrl: option.djPhotoUrl,
        };
      }
    }
    setDjs(updated);
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
        date: datetimeLocalToMs(date),
        endDate: endDate ? datetimeLocalToMs(endDate) : null,
        photo: photoUrl,
        description: description.trim() || null,
        venueId: venueId || null,
        djs: filteredDJs,
        genres: genres.trim() ? genres.split(',').map(g => g.trim()).filter(Boolean) : [],
        location: location.trim() || null,
        ticketLink: ticketLink.trim() ? normalizeUrl(ticketLink.trim()) : null,
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

  // Format date for display
  const formatEventDate = (ms: number) => {
    return new Date(ms).toLocaleDateString('en-US', {
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
        <BroadcastHeader />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 60px)' }}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <BroadcastHeader />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 60px)' }}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      </div>
    );
  }

  if (!hasBroadcasterAccess) {
    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <BroadcastHeader />
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
      <BroadcastHeader />
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

            {/* Date / End Date */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Date & Time *</label>
                <input
                  type="datetime-local"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">End Date & Time</label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white"
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
                  <p className="text-xs text-gray-500">JPG, PNG, GIF, or WebP. Max 5MB.</p>
                </div>
              </div>
              {photoError && (
                <p className="text-red-400 text-sm mt-2">{photoError}</p>
              )}
            </div>

            {/* Venue */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Venue</label>
              <select
                value={venueId}
                onChange={(e) => handleVenueChange(e.target.value)}
                className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white"
              >
                <option value="">TBD</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}{venue.location ? ` (${venue.location})` : ''}
                  </option>
                ))}
              </select>
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

            {/* Description */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white resize-none"
                placeholder="Event description..."
              />
            </div>

            {/* Genres */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-1">Genres / Vibes</label>
              <input
                type="text"
                value={genres}
                onChange={(e) => setGenres(e.target.value)}
                className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                placeholder="Techno, House, Ambient"
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

            {/* DJs */}
            <div className="mb-6">
              <label className="block text-sm text-gray-400 mb-3">DJs Playing</label>
              {djs.map((dj, i) => {
                const isManual = !djOptions.some(o => (o.djUsername || o.djName) === (dj.djUsername || dj.djName)) && dj.djName;
                return (
                  <div key={i} className="flex gap-2 mb-2">
                    <select
                      value={isManual ? '__manual__' : (dj.djUsername || dj.djName || '')}
                      onChange={(e) => handleDJSelect(i, e.target.value)}
                      className="flex-1 bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white"
                    >
                      <option value="">Select DJ...</option>
                      {djOptions.map((option) => (
                        <option key={option.djUsername || option.djName} value={option.djUsername || option.djName}>
                          {option.label}
                        </option>
                      ))}
                      <option value="__manual__">Other (type name)</option>
                    </select>
                    {isManual && (
                      <input
                        type="text"
                        value={dj.djName}
                        onChange={(e) => {
                          const updated = [...djs];
                          updated[i] = { ...updated[i], djName: e.target.value };
                          setDjs(updated);
                        }}
                        className="flex-1 bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                        placeholder="DJ Name"
                      />
                    )}
                    {dj.djUsername && (
                      <span className="flex items-center text-green-400 text-xs px-2">
                        @{dj.djUsername}
                      </span>
                    )}
                    {djs.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setDjs(djs.filter((_, j) => j !== i))}
                        className="text-red-400 hover:text-red-300 px-2"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => setDjs([...djs, { djName: '' }])}
                className="text-sm text-gray-400 hover:text-white mt-1"
              >
                + Add DJ
              </button>
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
                      {event.venueName && <> &middot; {event.venueName}</>}
                      {!event.venueName && event.location && <> &middot; {event.location}</>}
                      {event.djs.length > 0 && (
                        <> &middot; {event.djs.length} DJ{event.djs.length !== 1 ? 's' : ''}</>
                      )}
                    </p>
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
