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
import { uploadCollectivePhoto, deleteCollectivePhoto, validatePhoto } from '@/lib/photo-upload';
import { Collective, CollectiveRef, CollectiveVenueRef, EventDJRef, Venue } from '@/types/events';

interface DJOption {
  label: string;
  djName: string;
  djUserId?: string;
  djUsername?: string;
  djPhotoUrl?: string;
  source: 'user' | 'pending';
}

export function CollectivesAdmin() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);

  // Edit mode
  const [editingCollective, setEditingCollective] = useState<Collective | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [genres, setGenres] = useState('');
  const [instagram, setInstagram] = useState('');
  const [soundcloud, setSoundcloud] = useState('');
  const [bandcamp, setBandcamp] = useState('');
  const [website, setWebsite] = useState('');
  const [residentAdvisor, setResidentAdvisor] = useState('');
  const [residentDJs, setResidentDJs] = useState<EventDJRef[]>([{ djName: '' }]);
  const [linkedVenues, setLinkedVenues] = useState<CollectiveVenueRef[]>([]);
  const [linkedCollectives, setLinkedCollectives] = useState<CollectiveRef[]>([]);

  // Photo state
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // UI state
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Available DJs (from pending profiles + DJ users)
  const [djOptions, setDjOptions] = useState<DJOption[]>([]);

  // Available venues for linking
  const [venueOptions, setVenueOptions] = useState<Venue[]>([]);

  // Existing collectives
  const [collectives, setCollectives] = useState<Collective[]>([]);
  const [loadingCollectives, setLoadingCollectives] = useState(true);

  const hasBroadcasterAccess = isBroadcaster(role);

  // Fetch all available DJs (pending profiles + DJ users)
  const fetchDJOptions = useCallback(async () => {
    if (!db) return;
    try {
      const options: DJOption[] = [];
      const seenUsernames = new Set<string>();

      // 1. Pending DJ profiles
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

      // 2. Users with DJ role
      const usersRef = collection(db, 'users');
      const djQuery = query(usersRef, where('role', 'in', ['dj', 'broadcaster', 'admin']));
      const usersSnapshot = await getDocs(djQuery);
      usersSnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const username = data.chatUsernameNormalized || '';
        if (username && seenUsernames.has(username)) return; // skip duplicates
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

  // Fetch venues for linking
  const fetchVenueOptions = useCallback(async () => {
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
      setVenueOptions(venuesList);
    } catch (err) {
      console.error('Error fetching venues:', err);
    }
  }, []);

  // Fetch existing collectives
  const fetchCollectives = useCallback(async () => {
    if (!db) {
      setLoadingCollectives(false);
      return;
    }
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
          photo: data.photo || null,
          location: data.location || null,
          description: data.description || null,
          genres: data.genres || [],
          socialLinks: data.socialLinks || {},
          residentDJs: data.residentDJs || [],
          linkedVenues: data.linkedVenues || [],
          linkedCollectives: data.linkedCollectives || [],
          createdAt: data.createdAt?.toMillis?.() || Date.now(),
          createdBy: data.createdBy,
        });
      });
      collectivesList.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      setCollectives(collectivesList);
    } catch (err) {
      console.error('Error fetching collectives:', err);
    } finally {
      setLoadingCollectives(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && hasBroadcasterAccess) {
      fetchCollectives();
      fetchDJOptions();
      fetchVenueOptions();
    } else {
      setLoadingCollectives(false);
    }
  }, [isAuthenticated, hasBroadcasterAccess, fetchCollectives, fetchDJOptions, fetchVenueOptions]);

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
    setBandcamp('');
    setWebsite('');
    setResidentAdvisor('');
    setResidentDJs([{ djName: '' }]);
    setLinkedVenues([]);
    setLinkedCollectives([]);
    setPhotoUrl(null);
    setPhotoError(null);
    setEditingCollective(null);
    setError(null);
    setSuccess(null);
  };

  const startEditing = (collective: Collective) => {
    setEditingCollective(collective);
    setName(collective.name);
    setDescription(collective.description || '');
    setLocation(collective.location || '');
    setGenres(collective.genres?.join(', ') || '');
    setInstagram(collective.socialLinks?.instagram || '');
    setSoundcloud(collective.socialLinks?.soundcloud || '');
    setBandcamp(collective.socialLinks?.bandcamp || '');
    setWebsite(collective.socialLinks?.website || '');
    setResidentAdvisor(collective.socialLinks?.residentAdvisor || '');
    setResidentDJs(
      collective.residentDJs && collective.residentDJs.length > 0
        ? collective.residentDJs
        : [{ djName: '' }]
    );
    setLinkedVenues(collective.linkedVenues || []);
    setLinkedCollectives(collective.linkedCollectives || []);
    setPhotoUrl(collective.photo || null);
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

    const collectiveId = editingCollective?.id || `temp-${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    setUploadingPhoto(true);
    try {
      const result = await uploadCollectivePhoto(collectiveId, file);
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
    const collectiveId = editingCollective?.id || `temp-${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    setUploadingPhoto(true);
    try {
      await deleteCollectivePhoto(collectiveId, photoUrl);
      setPhotoUrl(null);
    } catch {
      setPhotoError('Failed to remove photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Handle selecting a DJ from the dropdown
  const handleDJSelect = (index: number, value: string) => {
    const updated = [...residentDJs];
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
    setResidentDJs(updated);
  };

  // Handle adding/removing linked venues
  const handleAddVenue = (venueId: string) => {
    if (!venueId) return;
    const venue = venueOptions.find(v => v.id === venueId);
    if (!venue) return;
    // Don't add duplicates
    if (linkedVenues.some(v => v.venueId === venueId)) return;
    setLinkedVenues([...linkedVenues, { venueId: venue.id, venueName: venue.name }]);
  };

  const handleRemoveVenue = (venueId: string) => {
    setLinkedVenues(linkedVenues.filter(v => v.venueId !== venueId));
  };

  // Handle adding/removing linked collectives
  const handleAddCollective = (collectiveId: string) => {
    if (!collectiveId) return;
    const coll = collectives.find(c => c.id === collectiveId);
    if (!coll) return;
    if (linkedCollectives.some(c => c.collectiveId === collectiveId)) return;
    setLinkedCollectives([...linkedCollectives, { collectiveId: coll.id, collectiveName: coll.name, collectiveSlug: coll.slug }]);
  };

  const handleRemoveCollective = (collectiveId: string) => {
    setLinkedCollectives(linkedCollectives.filter(c => c.collectiveId !== collectiveId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError('Collective name is required');
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
      if (bandcamp.trim()) socialLinksData.bandcamp = normalizeUrl(bandcamp.trim());
      if (website.trim()) socialLinksData.website = normalizeUrl(website.trim());
      if (residentAdvisor.trim()) socialLinksData.residentAdvisor = normalizeUrl(residentAdvisor.trim());

      const filteredDJs = residentDJs.filter(dj => dj.djName.trim());

      const payload = {
        ...(editingCollective ? { collectiveId: editingCollective.id } : {}),
        name: name.trim(),
        photo: photoUrl,
        location: location.trim() || null,
        description: description.trim() || null,
        genres: genres.trim() ? genres.split(',').map(g => g.trim()).filter(Boolean) : [],
        socialLinks: socialLinksData,
        residentDJs: filteredDJs,
        linkedVenues,
        linkedCollectives,
      };

      const res = await fetch('/api/admin/collectives', {
        method: editingCollective ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok) {
        setError(result.error || 'Failed to save collective');
        return;
      }

      setSuccess(editingCollective ? 'Collective updated!' : `Collective created! URL: /collective/${result.slug}`);
      resetForm();
      fetchCollectives();
    } catch (err) {
      console.error('Error saving collective:', err);
      setError('Failed to save collective');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (collectiveId: string) => {
    if (!confirm('Are you sure you want to delete this collective?')) return;

    setDeleting(true);
    try {
      const token = await user?.getIdToken();
      if (!token) return;

      const res = await fetch(`/api/admin/collectives?collectiveId=${collectiveId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setSuccess('Collective deleted');
        if (editingCollective?.id === collectiveId) resetForm();
        fetchCollectives();
      } else {
        const result = await res.json();
        setError(result.error || 'Failed to delete collective');
      }
    } catch {
      setError('Failed to delete collective');
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

  // Filter out already-linked venues from the dropdown
  const availableVenues = venueOptions.filter(v => !linkedVenues.some(lv => lv.venueId === v.id));

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
            {editingCollective ? 'Edit Collective' : 'Create Collective'}
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
              <label className="block text-sm text-gray-400 mb-1">Collective Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                placeholder="e.g. Lobster Theremin"
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
                      alt="Collective photo"
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500">
                      <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
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
                placeholder="London"
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
                placeholder="A short description of the collective..."
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
                  value={bandcamp}
                  onChange={(e) => setBandcamp(e.target.value)}
                  className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
                  placeholder="Bandcamp URL"
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

            {/* DJs */}
            <div className="mb-6">
              <label className="block text-sm text-gray-400 mb-3">DJs</label>
              {residentDJs.map((dj, i) => {
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
                          const updated = [...residentDJs];
                          updated[i] = { ...updated[i], djName: e.target.value };
                          setResidentDJs(updated);
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
                );
              })}
              <button
                type="button"
                onClick={() => setResidentDJs([...residentDJs, { djName: '' }])}
                className="text-sm text-gray-400 hover:text-white mt-1"
              >
                + Add DJ
              </button>
            </div>

            {/* Linked Venues */}
            <div className="mb-6">
              <label className="block text-sm text-gray-400 mb-3">Linked Venues</label>
              {linkedVenues.length > 0 && (
                <div className="space-y-2 mb-3">
                  {linkedVenues.map((lv) => (
                    <div key={lv.venueId} className="flex items-center gap-2 bg-[#252525] rounded-lg px-4 py-2">
                      <span className="flex-1 text-white text-sm">{lv.venueName}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveVenue(lv.venueId)}
                        className="text-red-400 hover:text-red-300 text-sm"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {availableVenues.length > 0 && (
                <select
                  value=""
                  onChange={(e) => handleAddVenue(e.target.value)}
                  className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white"
                >
                  <option value="">Add a venue...</option>
                  {availableVenues.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name}{venue.location ? ` (${venue.location})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Linked Collectives */}
            <div className="mb-6">
              <label className="block text-sm text-gray-400 mb-3">Linked Collectives</label>
              {linkedCollectives.length > 0 && (
                <div className="space-y-2 mb-3">
                  {linkedCollectives.map((lc) => (
                    <div key={lc.collectiveId} className="flex items-center gap-2 bg-[#252525] rounded-lg px-4 py-2">
                      <span className="flex-1 text-white text-sm">{lc.collectiveName}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCollective(lc.collectiveId)}
                        className="text-red-400 hover:text-red-300 text-sm"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {(() => {
                const currentId = editingCollective?.id;
                const availableCollectives = collectives.filter(
                  c => c.id !== currentId && !linkedCollectives.some(lc => lc.collectiveId === c.id)
                );
                return availableCollectives.length > 0 ? (
                  <select
                    value=""
                    onChange={(e) => handleAddCollective(e.target.value)}
                    className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white"
                  >
                    <option value="">Add a collective...</option>
                    {availableCollectives.map((coll) => (
                      <option key={coll.id} value={coll.id}>
                        {coll.name}{coll.location ? ` (${coll.location})` : ''}
                      </option>
                    ))}
                  </select>
                ) : null;
              })()}
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingCollective ? 'Update Collective' : 'Create Collective'}
              </button>
              {editingCollective && (
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

          {/* Existing Collectives List */}
          <h2 className="text-lg font-bold mb-4">Existing Collectives ({collectives.length})</h2>
          {loadingCollectives ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
            </div>
          ) : collectives.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No collectives yet</p>
          ) : (
            <div className="space-y-3">
              {collectives.map((collective) => (
                <div
                  key={collective.id}
                  className="bg-[#1a1a1a] rounded-lg p-4 flex items-center gap-4"
                >
                  {collective.photo ? (
                    <Image
                      src={collective.photo}
                      alt={collective.name}
                      width={48}
                      height={48}
                      className="w-12 h-12 rounded-lg object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-[#252525] flex items-center justify-center">
                      <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{collective.name}</p>
                    <p className="text-gray-500 text-sm truncate">
                      {collective.location || 'No location'}
                      {collective.residentDJs && collective.residentDJs.length > 0 && (
                        <> &middot; {collective.residentDJs.length} DJ{collective.residentDJs.length !== 1 ? 's' : ''}</>
                      )}
                      {collective.linkedVenues && collective.linkedVenues.length > 0 && (
                        <> &middot; {collective.linkedVenues.length} venue{collective.linkedVenues.length !== 1 ? 's' : ''}</>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEditing(collective)}
                      className="text-sm text-gray-400 hover:text-white px-3 py-1 rounded border border-gray-700 hover:border-gray-500"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(collective.id)}
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
