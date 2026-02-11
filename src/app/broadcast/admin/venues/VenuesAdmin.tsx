'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isBroadcaster } from '@/hooks/useUserRole';
import { BroadcastHeader } from '@/components/BroadcastHeader';
import { normalizeUrl } from '@/lib/url';
import { uploadVenuePhoto, deleteVenuePhoto, validatePhoto } from '@/lib/photo-upload';
import { Venue, EventDJRef } from '@/types/events';

export function VenuesAdmin() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);

  // Edit mode
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [genres, setGenres] = useState('');
  const [instagram, setInstagram] = useState('');
  const [soundcloud, setSoundcloud] = useState('');
  const [website, setWebsite] = useState('');
  const [residentAdvisor, setResidentAdvisor] = useState('');
  const [residentDJs, setResidentDJs] = useState<EventDJRef[]>([{ djName: '', djEmail: '' }]);

  // Photo state
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // UI state
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Existing venues
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loadingVenues, setLoadingVenues] = useState(true);

  const hasBroadcasterAccess = isBroadcaster(role);

  // Fetch existing venues
  const fetchVenues = useCallback(async () => {
    if (!db) {
      setLoadingVenues(false);
      return;
    }
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
          photo: data.photo || null,
          location: data.location || null,
          description: data.description || null,
          genres: data.genres || [],
          socialLinks: data.socialLinks || {},
          residentDJs: data.residentDJs || [],
          createdAt: data.createdAt?.toMillis?.() || Date.now(),
          createdBy: data.createdBy,
        });
      });
      venuesList.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      setVenues(venuesList);
    } catch (err) {
      console.error('Error fetching venues:', err);
    } finally {
      setLoadingVenues(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && hasBroadcasterAccess) {
      fetchVenues();
    } else {
      setLoadingVenues(false);
    }
  }, [isAuthenticated, hasBroadcasterAccess, fetchVenues]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/radio-portal');
    }
  }, [authLoading, isAuthenticated, router]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setLocation('');
    setGenres('');
    setInstagram('');
    setSoundcloud('');
    setWebsite('');
    setResidentAdvisor('');
    setResidentDJs([{ djName: '', djEmail: '' }]);
    setPhotoUrl(null);
    setPhotoError(null);
    setEditingVenue(null);
    setError(null);
    setSuccess(null);
  };

  const startEditing = (venue: Venue) => {
    setEditingVenue(venue);
    setName(venue.name);
    setDescription(venue.description || '');
    setLocation(venue.location || '');
    setGenres(venue.genres?.join(', ') || '');
    setInstagram(venue.socialLinks?.instagram || '');
    setSoundcloud(venue.socialLinks?.soundcloud || '');
    setWebsite(venue.socialLinks?.website || '');
    setResidentAdvisor(venue.socialLinks?.residentAdvisor || '');
    setResidentDJs(
      venue.residentDJs && venue.residentDJs.length > 0
        ? venue.residentDJs
        : [{ djName: '', djEmail: '' }]
    );
    setPhotoUrl(venue.photo || null);
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

    const venueId = editingVenue?.id || `temp-${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    setUploadingPhoto(true);
    try {
      const result = await uploadVenuePhoto(venueId, file);
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
    const venueId = editingVenue?.id || `temp-${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    setUploadingPhoto(true);
    try {
      await deleteVenuePhoto(venueId, photoUrl);
      setPhotoUrl(null);
    } catch {
      setPhotoError('Failed to remove photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Lookup DJ profile by email
  const lookupDJ = async (index: number) => {
    const dj = residentDJs[index];
    if (!dj.djEmail) return;

    try {
      const res = await fetch(`/api/users/lookup-by-email?email=${encodeURIComponent(dj.djEmail)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          const updated = [...residentDJs];
          updated[index] = {
            ...updated[index],
            djUserId: data.user.uid,
            djUsername: data.user.chatUsernameNormalized || data.user.chatUsername,
            djPhotoUrl: data.user.djProfile?.photoUrl || undefined,
            djName: updated[index].djName || data.user.chatUsername || data.user.displayName,
          };
          setResidentDJs(updated);
        }
      }
    } catch (err) {
      console.error('Error looking up DJ:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError('Venue name is required');
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

      const socialLinksData: Record<string, string> = {};
      if (instagram.trim()) socialLinksData.instagram = instagram.trim();
      if (soundcloud.trim()) socialLinksData.soundcloud = normalizeUrl(soundcloud.trim());
      if (website.trim()) socialLinksData.website = normalizeUrl(website.trim());
      if (residentAdvisor.trim()) socialLinksData.residentAdvisor = normalizeUrl(residentAdvisor.trim());

      const filteredDJs = residentDJs.filter(dj => dj.djName.trim() || dj.djEmail?.trim());

      const payload = {
        ...(editingVenue ? { venueId: editingVenue.id } : {}),
        name: name.trim(),
        photo: photoUrl,
        location: location.trim() || null,
        description: description.trim() || null,
        genres: genres.trim() ? genres.split(',').map(g => g.trim()).filter(Boolean) : [],
        socialLinks: socialLinksData,
        residentDJs: filteredDJs,
      };

      const res = await fetch('/api/admin/venues', {
        method: editingVenue ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok) {
        setError(result.error || 'Failed to save venue');
        return;
      }

      setSuccess(editingVenue ? 'Venue updated!' : `Venue created! URL: /venue/${result.slug}`);
      resetForm();
      fetchVenues();
    } catch (err) {
      console.error('Error saving venue:', err);
      setError('Failed to save venue');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (venueId: string) => {
    if (!confirm('Are you sure you want to delete this venue?')) return;

    setDeleting(true);
    try {
      const token = await user?.getIdToken();
      if (!token) return;

      const res = await fetch(`/api/admin/venues?venueId=${venueId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setSuccess('Venue deleted');
        if (editingVenue?.id === venueId) resetForm();
        fetchVenues();
      } else {
        const result = await res.json();
        setError(result.error || 'Failed to delete venue');
      }
    } catch {
      setError('Failed to delete venue');
    } finally {
      setDeleting(false);
    }
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
            {editingVenue ? 'Edit Venue' : 'Create Venue'}
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
              <label className="block text-sm text-gray-400 mb-1">Venue Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                placeholder="e.g. Berghain"
                required
              />
            </div>

            {/* Photo */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">Photo</label>
              <div className="flex items-start gap-4">
                <div className="relative w-24 h-24 bg-[#252525] rounded-lg overflow-hidden flex-shrink-0">
                  {photoUrl ? (
                    <Image
                      src={photoUrl}
                      alt="Venue photo"
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500">
                      <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
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
                maxLength={500}
                rows={3}
                className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white resize-none"
                placeholder="A short description of the venue..."
              />
              <p className="text-xs text-gray-500 mt-1">{description.length}/500</p>
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

            {/* Social Links */}
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-3">Social Links</label>
              <div className="space-y-3">
                <input
                  type="text"
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value)}
                  className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                  placeholder="Instagram @username"
                />
                <input
                  type="text"
                  value={soundcloud}
                  onChange={(e) => setSoundcloud(e.target.value)}
                  className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                  placeholder="SoundCloud URL"
                />
                <input
                  type="text"
                  value={residentAdvisor}
                  onChange={(e) => setResidentAdvisor(e.target.value)}
                  className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                  placeholder="Resident Advisor URL"
                />
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                  placeholder="Website URL"
                />
              </div>
            </div>

            {/* Resident DJs */}
            <div className="mb-6">
              <label className="block text-sm text-gray-400 mb-3">Resident DJs</label>
              {residentDJs.map((dj, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={dj.djName}
                    onChange={(e) => {
                      const updated = [...residentDJs];
                      updated[i] = { ...updated[i], djName: e.target.value };
                      setResidentDJs(updated);
                    }}
                    className="flex-1 bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                    placeholder="DJ Name"
                  />
                  <input
                    type="email"
                    value={dj.djEmail || ''}
                    onChange={(e) => {
                      const updated = [...residentDJs];
                      updated[i] = { ...updated[i], djEmail: e.target.value };
                      setResidentDJs(updated);
                    }}
                    onBlur={() => lookupDJ(i)}
                    className="flex-1 bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                    placeholder="Email (for profile lookup)"
                  />
                  {dj.djUsername && (
                    <span className="flex items-center text-green-400 text-xs px-2">
                      @{dj.djUsername}
                    </span>
                  )}
                  {residentDJs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setResidentDJs(residentDJs.filter((_, j) => j !== i))}
                      className="text-red-400 hover:text-red-300 px-2"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setResidentDJs([...residentDJs, { djName: '', djEmail: '' }])}
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
                {saving ? 'Saving...' : editingVenue ? 'Update Venue' : 'Create Venue'}
              </button>
              {editingVenue && (
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

          {/* Existing Venues List */}
          <h2 className="text-lg font-bold mb-4">Existing Venues ({venues.length})</h2>
          {loadingVenues ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
            </div>
          ) : venues.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No venues yet</p>
          ) : (
            <div className="space-y-3">
              {venues.map((venue) => (
                <div
                  key={venue.id}
                  className="bg-[#1a1a1a] rounded-lg p-4 flex items-center gap-4"
                >
                  {venue.photo ? (
                    <Image
                      src={venue.photo}
                      alt={venue.name}
                      width={48}
                      height={48}
                      className="w-12 h-12 rounded-lg object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-[#252525] flex items-center justify-center">
                      <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{venue.name}</p>
                    <p className="text-gray-500 text-sm truncate">
                      {venue.location || 'No location'}
                      {venue.residentDJs && venue.residentDJs.length > 0 && (
                        <> &middot; {venue.residentDJs.length} resident DJ{venue.residentDJs.length !== 1 ? 's' : ''}</>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEditing(venue)}
                      className="text-sm text-gray-400 hover:text-white px-3 py-1 rounded border border-gray-700 hover:border-gray-500"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(venue.id)}
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
