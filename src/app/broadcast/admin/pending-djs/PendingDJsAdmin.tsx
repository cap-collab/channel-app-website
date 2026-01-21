'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { collection, query, where, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isBroadcaster } from '@/hooks/useUserRole';
import { BroadcastHeader } from '@/components/BroadcastHeader';
import { normalizeUrl } from '@/lib/url';

interface PendingProfile {
  id: string;
  email: string;
  chatUsername: string;
  chatUsernameNormalized: string;
  djProfile: {
    bio?: string | null;
    photoUrl?: string | null;
    location?: string | null;
    genres?: string[];
    promoText?: string | null;
    promoHyperlink?: string | null;
    socialLinks?: {
      instagram?: string;
      soundcloud?: string;
      youtube?: string;
    };
  };
  status: string;
  createdAt: Date;
}

export function PendingDJsAdmin() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);

  // Edit mode state
  const [editingProfile, setEditingProfile] = useState<PendingProfile | null>(null);

  // Form state
  const [email, setEmail] = useState('');
  const [djName, setDjName] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [genres, setGenres] = useState('');
  const [promoText, setPromoText] = useState('');
  const [promoHyperlink, setPromoHyperlink] = useState('');
  const [instagram, setInstagram] = useState('');
  const [soundcloud, setSoundcloud] = useState('');
  const [youtube, setYoutube] = useState('');

  // UI state
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Existing pending profiles
  const [pendingProfiles, setPendingProfiles] = useState<PendingProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);

  // Check if user has broadcaster access
  const hasBroadcasterAccess = isBroadcaster(role);

  // Fetch existing pending profiles
  const fetchPendingProfiles = useCallback(async () => {
    console.log('[pending-djs] fetchPendingProfiles called, db:', db ? 'initialized' : 'null');
    if (!db) {
      console.log('[pending-djs] No db available');
      setError('Database not initialized. Check Firebase configuration.');
      setLoadingProfiles(false);
      return;
    }
    try {
      console.log('[pending-djs] Creating collection reference...');
      const pendingRef = collection(db, 'pending-dj-profiles');
      console.log('[pending-djs] Collection ref created, fetching docs...');

      // Fetch all documents and filter client-side to avoid any index issues
      const snapshot = await getDocs(pendingRef);
      console.log('[pending-djs] Snapshot received, total documents:', snapshot.size, 'empty:', snapshot.empty);

      const profiles: PendingProfile[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        console.log('[pending-djs] Document:', docSnap.id, 'data:', JSON.stringify(data));
        // Only include pending profiles
        if (data.status === 'pending') {
          profiles.push({
            id: docSnap.id,
            email: data.email,
            chatUsername: data.chatUsername,
            chatUsernameNormalized: data.chatUsernameNormalized,
            djProfile: data.djProfile || {},
            status: data.status,
            createdAt: data.createdAt?.toDate() || new Date(),
          });
        }
      });
      console.log('[pending-djs] Filtered pending profiles:', profiles.length);
      // Sort client-side by createdAt descending
      profiles.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setPendingProfiles(profiles);
    } catch (err: unknown) {
      console.error('[pending-djs] Error fetching pending profiles:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('[pending-djs] Error message:', errorMessage);
      setError(`Failed to load pending profiles: ${errorMessage}`);
    } finally {
      setLoadingProfiles(false);
    }
  }, []);

  useEffect(() => {
    console.log('[pending-djs] useEffect triggered - isAuthenticated:', isAuthenticated, 'hasBroadcasterAccess:', hasBroadcasterAccess);
    if (isAuthenticated && hasBroadcasterAccess) {
      console.log('[pending-djs] Conditions met, calling fetchPendingProfiles');
      fetchPendingProfiles();
    } else {
      console.log('[pending-djs] Conditions NOT met, not fetching');
      setLoadingProfiles(false);
    }
  }, [isAuthenticated, hasBroadcasterAccess, fetchPendingProfiles]);

  // Redirect to radio portal if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/radio-portal');
    }
  }, [authLoading, isAuthenticated, router]);

  // Reset form
  const resetForm = () => {
    setEmail('');
    setDjName('');
    setBio('');
    setLocation('');
    setGenres('');
    setPromoText('');
    setPromoHyperlink('');
    setInstagram('');
    setSoundcloud('');
    setYoutube('');
    setEditingProfile(null);
    setError(null);
    setSuccess(null);
  };

  // Load profile into form for editing
  const startEditing = (profile: PendingProfile) => {
    setEditingProfile(profile);
    setEmail(profile.email);
    setDjName(profile.chatUsername);
    setBio(profile.djProfile.bio || '');
    setLocation(profile.djProfile.location || '');
    setGenres(profile.djProfile.genres?.join(', ') || '');
    setPromoText(profile.djProfile.promoText || '');
    setPromoHyperlink(profile.djProfile.promoHyperlink || '');
    setInstagram(profile.djProfile.socialLinks?.instagram || '');
    setSoundcloud(profile.djProfile.socialLinks?.soundcloud || '');
    setYoutube(profile.djProfile.socialLinks?.youtube || '');
    setError(null);
    setSuccess(null);

    // Scroll to form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handle form submission (create or update)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    if (!djName.trim()) {
      setError('DJ Name is required');
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

      if (editingProfile) {
        // Update existing profile directly in Firestore
        if (!db) {
          setError('Database not available');
          setSaving(false);
          return;
        }

        const profileRef = doc(db, 'pending-dj-profiles', editingProfile.id);
        await updateDoc(profileRef, {
          djProfile: {
            bio: bio.trim() || null,
            location: location.trim() || null,
            genres: genres.trim() ? genres.split(',').map((g) => g.trim()).filter(Boolean) : [],
            promoText: promoText.trim() || null,
            promoHyperlink: promoHyperlink.trim() ? normalizeUrl(promoHyperlink.trim()) : null,
            photoUrl: editingProfile.djProfile.photoUrl || null,
            socialLinks: {
              instagram: instagram.trim() || undefined,
              soundcloud: soundcloud.trim() ? normalizeUrl(soundcloud.trim()) : undefined,
              youtube: youtube.trim() ? normalizeUrl(youtube.trim()) : undefined,
            },
          },
        });

        setSuccess(`Updated DJ profile for ${djName}`);
        resetForm();
        fetchPendingProfiles();
      } else {
        // Create new profile via API
        const response = await fetch('/api/admin/create-pending-dj-profile', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            username: djName.trim(),
            djProfile: {
              bio: bio.trim() || null,
              location: location.trim() || null,
              genres: genres.trim() ? genres.split(',').map((g) => g.trim()).filter(Boolean) : [],
              promoText: promoText.trim() || null,
              promoHyperlink: promoHyperlink.trim() ? normalizeUrl(promoHyperlink.trim()) : null,
              socialLinks: {
                instagram: instagram.trim() || undefined,
                soundcloud: soundcloud.trim() ? normalizeUrl(soundcloud.trim()) : undefined,
                youtube: youtube.trim() ? normalizeUrl(youtube.trim()) : undefined,
              },
            },
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          setError(result.error || 'Failed to create pending profile');
          setSaving(false);
          return;
        }

        setSuccess(`Created pending DJ profile for ${djName}. Profile URL: /dj/${result.username}`);
        resetForm();
        fetchPendingProfiles();
      }
    } catch (err) {
      console.error('Error saving pending profile:', err);
      setError('Failed to save pending profile');
    } finally {
      setSaving(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!editingProfile || !db) return;

    if (!confirm(`Are you sure you want to delete the pending profile for ${editingProfile.chatUsername}?`)) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      // Delete the pending profile
      const profileRef = doc(db, 'pending-dj-profiles', editingProfile.id);
      await deleteDoc(profileRef);

      // Also delete the reserved username
      const usernameRef = doc(db, 'usernames', editingProfile.chatUsernameNormalized);
      await deleteDoc(usernameRef);

      setSuccess(`Deleted pending profile for ${editingProfile.chatUsername}`);
      resetForm();
      fetchPendingProfiles();
    } catch (err) {
      console.error('Error deleting pending profile:', err);
      setError('Failed to delete pending profile');
    } finally {
      setDeleting(false);
    }
  };

  // Auth or role loading
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

  // Not authenticated
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

  // Not a broadcaster
  if (!hasBroadcasterAccess) {
    return (
      <div className="min-h-screen bg-[#1a1a1a]">
        <BroadcastHeader />
        <div className="flex items-center justify-center p-8" style={{ minHeight: 'calc(100vh - 60px)' }}>
          <div className="bg-[#252525] rounded-xl p-8 max-w-md text-center">
            <div className="w-16 h-16 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Access Denied</h1>
            <p className="text-gray-400 mb-4">
              You don&apos;t have broadcaster permissions.
            </p>
            <p className="text-gray-500 text-sm">
              Signed in as: {user?.email}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <BroadcastHeader />
      <div className="p-4 md:p-8">
        <div className="max-w-4xl mx-auto">
          {/* Back link */}
          <Link
            href="/broadcast/admin"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Admin
          </Link>

          <h1 className="text-2xl font-bold mb-2">
            {editingProfile ? `Edit: ${editingProfile.chatUsername}` : 'Create Pending DJ Profile'}
          </h1>
          <p className="text-gray-400 mb-8">
            {editingProfile
              ? 'Update the DJ profile information below.'
              : "Create a DJ profile page for someone who hasn't signed up yet. When they sign up with the same email, the profile will automatically link to their account."}
          </p>

          {/* Success/Error messages */}
          {error && (
            <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-900/50 border border-green-500 text-green-200 px-4 py-3 rounded-lg mb-6">
              {success}
            </div>
          )}

          {/* Create/Edit form */}
          <form onSubmit={handleSubmit} className="bg-[#1a1a1a] rounded-xl p-6 mb-8">
            <div className="space-y-6">
              {/* Required fields */}
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Email <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="dj@example.com"
                    disabled={!!editingProfile}
                    className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {editingProfile ? 'Email cannot be changed' : 'Used to link profile when they sign up'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    DJ Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={djName}
                    onChange={(e) => setDjName(e.target.value)}
                    placeholder="DJ Name"
                    maxLength={20}
                    disabled={!!editingProfile}
                    className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {editingProfile
                      ? `Profile URL: /dj/${editingProfile.chatUsernameNormalized}`
                      : `Profile URL: /dj/${djName.trim().replace(/[\s-]+/g, '').toLowerCase() || 'djname'}`}
                  </p>
                </div>
              </div>

              {/* Bio */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Bio
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="A short bio about the DJ..."
                  maxLength={500}
                  rows={3}
                  className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors resize-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {bio.length}/500 characters
                </p>
              </div>

              {/* Location & Genres */}
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Location
                  </label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="City, Country"
                    maxLength={100}
                    className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Genres / Vibes
                  </label>
                  <input
                    type="text"
                    value={genres}
                    onChange={(e) => setGenres(e.target.value)}
                    placeholder="House, Techno, Disco"
                    className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Comma-separated
                  </p>
                </div>
              </div>

              {/* Promo */}
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Promo Text
                  </label>
                  <input
                    type="text"
                    value={promoText}
                    onChange={(e) => setPromoText(e.target.value)}
                    placeholder="Check out my latest mix!"
                    maxLength={200}
                    className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Promo Link
                  </label>
                  <input
                    type="url"
                    value={promoHyperlink}
                    onChange={(e) => setPromoHyperlink(e.target.value)}
                    placeholder="https://soundcloud.com/dj/mix"
                    className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors"
                  />
                </div>
              </div>

              {/* Social Links */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">
                  Social Links
                </label>
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Instagram</label>
                    <input
                      type="text"
                      value={instagram}
                      onChange={(e) => setInstagram(e.target.value)}
                      placeholder="@username"
                      className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">SoundCloud</label>
                    <input
                      type="url"
                      value={soundcloud}
                      onChange={(e) => setSoundcloud(e.target.value)}
                      placeholder="soundcloud.com/dj"
                      className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">YouTube</label>
                    <input
                      type="url"
                      value={youtube}
                      onChange={(e) => setYoutube(e.target.value)}
                      placeholder="youtube.com/@channel"
                      className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Submit / Cancel / Delete */}
              <div className="pt-4 flex gap-3">
                {editingProfile && (
                  <>
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-6 py-3 rounded-lg font-medium bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="px-6 py-3 rounded-lg font-medium bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {deleting ? 'Deleting...' : 'Delete'}
                    </button>
                  </>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-white text-black font-medium py-3 px-6 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                      {editingProfile ? 'Saving...' : 'Creating...'}
                    </span>
                  ) : editingProfile ? (
                    'Save Changes'
                  ) : (
                    'Create Pending DJ Profile'
                  )}
                </button>
              </div>
            </div>
          </form>

          {/* Existing pending profiles */}
          <div>
            <h2 className="text-lg font-semibold mb-4">Existing Pending Profiles</h2>
            {loadingProfiles ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
              </div>
            ) : pendingProfiles.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No pending profiles yet</p>
            ) : (
              <div className="space-y-3">
                {pendingProfiles.map((profile) => (
                  <div
                    key={profile.id}
                    className={`bg-[#1a1a1a] rounded-lg p-4 flex items-center gap-4 ${
                      editingProfile?.id === profile.id ? 'ring-2 ring-white' : ''
                    }`}
                  >
                    <div className="w-12 h-12 rounded-full bg-gray-700 flex-shrink-0 overflow-hidden flex items-center justify-center">
                      {profile.djProfile.photoUrl ? (
                        <Image
                          src={profile.djProfile.photoUrl}
                          alt={profile.chatUsername}
                          width={48}
                          height={48}
                          className="w-full h-full object-cover"
                          unoptimized
                        />
                      ) : (
                        <span className="text-white text-lg font-medium">
                          {profile.chatUsername.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium">{profile.chatUsername}</p>
                      <p className="text-gray-400 text-sm truncate">{profile.email}</p>
                      {profile.djProfile.location && (
                        <p className="text-gray-500 text-xs">{profile.djProfile.location}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => startEditing(profile)}
                        className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                      >
                        Edit
                      </button>
                      <Link
                        href={`/dj/${profile.chatUsernameNormalized}`}
                        target="_blank"
                        className="text-gray-400 hover:text-white text-sm"
                      >
                        View
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
