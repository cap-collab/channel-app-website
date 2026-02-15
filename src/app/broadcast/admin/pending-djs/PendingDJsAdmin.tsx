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
import { uploadPendingDJPhoto, deletePendingDJPhoto, validatePhoto } from '@/lib/photo-upload';

interface CustomLink {
  label: string;
  url: string;
}

interface IrlShow {
  url: string;
  date: string;
}

interface EventDJRef {
  djName: string;
  djUserId?: string;
  djUsername?: string;
  djPhotoUrl?: string;
}

interface VenueOption {
  id: string;
  name: string;
  residentDJs: EventDJRef[];
}

interface CollectiveOption {
  id: string;
  name: string;
  residentDJs: EventDJRef[];
}

interface EventOption {
  id: string;
  name: string;
  date: number;
  djs: EventDJRef[];
}

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
      bandcamp?: string;
      youtube?: string;
      bookingEmail?: string;
      mixcloud?: string;
      residentAdvisor?: string;
      website?: string;
      customLinks?: CustomLink[];
    };
    irlShows?: IrlShow[];
    myRecs?: {
      bandcampLinks?: string[];
      eventLinks?: string[];
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
  const [bandcamp, setBandcamp] = useState('');
  const [youtube, setYoutube] = useState('');
  const [bookingEmail, setBookingEmail] = useState('');
  const [mixcloud, setMixcloud] = useState('');
  const [residentAdvisor, setResidentAdvisor] = useState('');
  const [website, setWebsite] = useState('');
  const [customLinks, setCustomLinks] = useState<CustomLink[]>([]);

  // IRL Shows state
  const [irlShows, setIrlShows] = useState<IrlShow[]>([{ url: '', date: '' }, { url: '', date: '' }]);

  // My Recs state
  const [bandcampRecs, setBandcampRecs] = useState<string[]>(['']);
  const [eventRecs, setEventRecs] = useState<string[]>(['']);

  // Photo upload state
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Entity linking state
  const [venueOptions, setVenueOptions] = useState<VenueOption[]>([]);
  const [collectiveOptions, setCollectiveOptions] = useState<CollectiveOption[]>([]);
  const [eventOptions, setEventOptions] = useState<EventOption[]>([]);
  const [linkedVenueIds, setLinkedVenueIds] = useState<string[]>([]);
  const [linkedCollectiveIds, setLinkedCollectiveIds] = useState<string[]>([]);
  const [linkedEventIds, setLinkedEventIds] = useState<string[]>([]);
  const [originalLinkedVenueIds, setOriginalLinkedVenueIds] = useState<string[]>([]);
  const [originalLinkedCollectiveIds, setOriginalLinkedCollectiveIds] = useState<string[]>([]);
  const [originalLinkedEventIds, setOriginalLinkedEventIds] = useState<string[]>([]);

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
      // Sort alphabetically by DJ name
      profiles.sort((a, b) =>
        a.chatUsername.toLowerCase().localeCompare(b.chatUsername.toLowerCase())
      );
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

  // Fetch venue options for linking
  const fetchVenueOptions = useCallback(async () => {
    if (!db) return;
    try {
      const snapshot = await getDocs(collection(db, 'venues'));
      const list: VenueOption[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          name: data.name,
          residentDJs: data.residentDJs || [],
        });
      });
      list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      setVenueOptions(list);
    } catch (err) {
      console.error('Error fetching venue options:', err);
    }
  }, []);

  // Fetch collective options for linking
  const fetchCollectiveOptions = useCallback(async () => {
    if (!db) return;
    try {
      const snapshot = await getDocs(collection(db, 'collectives'));
      const list: CollectiveOption[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          name: data.name,
          residentDJs: data.residentDJs || [],
        });
      });
      list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      setCollectiveOptions(list);
    } catch (err) {
      console.error('Error fetching collective options:', err);
    }
  }, []);

  // Fetch event options for linking
  const fetchEventOptions = useCallback(async () => {
    if (!db) return;
    try {
      const snapshot = await getDocs(collection(db, 'events'));
      const list: EventOption[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          name: data.name,
          date: data.date,
          djs: data.djs || [],
        });
      });
      list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      setEventOptions(list);
    } catch (err) {
      console.error('Error fetching event options:', err);
    }
  }, []);

  useEffect(() => {
    console.log('[pending-djs] useEffect triggered - isAuthenticated:', isAuthenticated, 'hasBroadcasterAccess:', hasBroadcasterAccess);
    if (isAuthenticated && hasBroadcasterAccess) {
      console.log('[pending-djs] Conditions met, calling fetchPendingProfiles');
      fetchPendingProfiles();
      fetchVenueOptions();
      fetchCollectiveOptions();
      fetchEventOptions();
    } else {
      console.log('[pending-djs] Conditions NOT met, not fetching');
      setLoadingProfiles(false);
    }
  }, [isAuthenticated, hasBroadcasterAccess, fetchPendingProfiles, fetchVenueOptions, fetchCollectiveOptions, fetchEventOptions]);

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
    setBandcamp('');
    setYoutube('');
    setBookingEmail('');
    setMixcloud('');
    setResidentAdvisor('');
    setWebsite('');
    setCustomLinks([]);
    setIrlShows([{ url: '', date: '' }, { url: '', date: '' }]);
    setBandcampRecs(['']);
    setEventRecs(['']);
    setPhotoUrl(null);
    setPhotoError(null);
    setLinkedVenueIds([]);
    setLinkedCollectiveIds([]);
    setLinkedEventIds([]);
    setOriginalLinkedVenueIds([]);
    setOriginalLinkedCollectiveIds([]);
    setOriginalLinkedEventIds([]);
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
    setBandcamp(profile.djProfile.socialLinks?.bandcamp || '');
    setYoutube(profile.djProfile.socialLinks?.youtube || '');
    setBookingEmail(profile.djProfile.socialLinks?.bookingEmail || '');
    setMixcloud(profile.djProfile.socialLinks?.mixcloud || '');
    setResidentAdvisor(profile.djProfile.socialLinks?.residentAdvisor || '');
    setWebsite(profile.djProfile.socialLinks?.website || '');
    setCustomLinks(profile.djProfile.socialLinks?.customLinks || []);
    // IRL Shows - ensure we always have 2 fields
    const existingIrlShows = profile.djProfile.irlShows || [];
    setIrlShows([
      existingIrlShows[0] || { url: '', date: '' },
      existingIrlShows[1] || { url: '', date: '' },
    ]);
    // My Recs - ensure at least one empty field
    const existingBandcampRecs = profile.djProfile.myRecs?.bandcampLinks || [];
    setBandcampRecs(existingBandcampRecs.length > 0 ? existingBandcampRecs : ['']);
    const existingEventRecs = profile.djProfile.myRecs?.eventLinks || [];
    setEventRecs(existingEventRecs.length > 0 ? existingEventRecs : ['']);
    // Photo
    setPhotoUrl(profile.djProfile.photoUrl || null);
    setPhotoError(null);
    setError(null);
    setSuccess(null);

    // Find existing entity links by checking which venues/collectives/events contain this DJ
    const djUsername = profile.chatUsernameNormalized;
    const matchesDJ = (djs: EventDJRef[]) =>
      djs.some(d => d.djUsername === djUsername || d.djName === profile.chatUsername);

    const venueIds = venueOptions.filter(v => matchesDJ(v.residentDJs)).map(v => v.id);
    setLinkedVenueIds(venueIds);
    setOriginalLinkedVenueIds(venueIds);

    const collectiveIds = collectiveOptions.filter(c => matchesDJ(c.residentDJs)).map(c => c.id);
    setLinkedCollectiveIds(collectiveIds);
    setOriginalLinkedCollectiveIds(collectiveIds);

    const eventIds = eventOptions.filter(e => matchesDJ(e.djs)).map(e => e.id);
    setLinkedEventIds(eventIds);
    setOriginalLinkedEventIds(eventIds);

    // Scroll to form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handle photo upload
  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoError(null);

    const validation = validatePhoto(file);
    if (!validation.valid) {
      setPhotoError(validation.error || 'Invalid file');
      return;
    }

    // For new profiles, we need a profile ID first - use a temp ID based on email
    const profileId = editingProfile?.id || `temp-${email.trim().toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    setUploadingPhoto(true);
    try {
      const result = await uploadPendingDJPhoto(profileId, file);
      if (!result.success) {
        setPhotoError(result.error || 'Upload failed');
        return;
      }
      setPhotoUrl(result.url || null);
    } catch (err) {
      console.error('Error uploading photo:', err);
      setPhotoError('Failed to upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Handle photo removal
  const handleRemovePhoto = async () => {
    if (!photoUrl) return;

    const profileId = editingProfile?.id || `temp-${email.trim().toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    setUploadingPhoto(true);
    setPhotoError(null);
    try {
      await deletePendingDJPhoto(profileId, photoUrl);
      setPhotoUrl(null);
    } catch (err) {
      console.error('Error removing photo:', err);
      setPhotoError('Failed to remove photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Handle form submission (create or update)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

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

      // Build social links object
      const validCustomLinks = customLinks.filter(
        (link) => link.label.trim() && link.url.trim()
      ).map((link) => ({
        label: link.label.trim(),
        url: normalizeUrl(link.url.trim()),
      }));

      const socialLinksData = {
        instagram: instagram.trim() || undefined,
        soundcloud: soundcloud.trim() ? normalizeUrl(soundcloud.trim()) : undefined,
        bandcamp: bandcamp.trim() ? normalizeUrl(bandcamp.trim()) : undefined,
        youtube: youtube.trim() ? normalizeUrl(youtube.trim()) : undefined,
        bookingEmail: bookingEmail.trim() || undefined,
        mixcloud: mixcloud.trim() ? normalizeUrl(mixcloud.trim()) : undefined,
        residentAdvisor: residentAdvisor.trim() ? normalizeUrl(residentAdvisor.trim()) : undefined,
        website: website.trim() ? normalizeUrl(website.trim()) : undefined,
        customLinks: validCustomLinks.length > 0 ? validCustomLinks : undefined,
      };

      // Build IRL shows data
      const validIrlShows = irlShows.filter(
        (show) => show.url.trim() || show.date.trim()
      ).map((show) => ({
        url: show.url.trim() ? normalizeUrl(show.url.trim()) : '',
        date: show.date.trim(),
      }));

      // Build my recs data
      const validBandcampRecs = bandcampRecs.filter((url) => url.trim()).map((url) => normalizeUrl(url.trim()));
      const validEventRecs = eventRecs.filter((url) => url.trim()).map((url) => normalizeUrl(url.trim()));

      if (editingProfile) {
        // Build request body
        const requestBody: Record<string, unknown> = {
          profileId: editingProfile.id,
          djProfile: {
            bio: bio.trim() || null,
            location: location.trim() || null,
            genres: genres.trim() ? genres.split(',').map((g) => g.trim()).filter(Boolean) : [],
            promoText: promoText.trim() || null,
            promoHyperlink: promoHyperlink.trim() ? normalizeUrl(promoHyperlink.trim()) : null,
            photoUrl: photoUrl || null,
            socialLinks: socialLinksData,
            irlShows: validIrlShows.length > 0 ? validIrlShows : undefined,
            myRecs: (validBandcampRecs.length > 0 || validEventRecs.length > 0) ? {
              bandcampLinks: validBandcampRecs.length > 0 ? validBandcampRecs : undefined,
              eventLinks: validEventRecs.length > 0 ? validEventRecs : undefined,
            } : undefined,
          },
        };

        // Include email if profile had no email and one was added
        if (!editingProfile.email && email.trim()) {
          requestBody.email = email.trim().toLowerCase();
        }

        // Update existing profile via API
        const response = await fetch('/api/admin/create-pending-dj-profile', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(requestBody),
        });

        const result = await response.json();

        if (!response.ok) {
          setError(result.error || 'Failed to update pending profile');
          setSaving(false);
          return;
        }

        // Sync entity links (add/remove DJ from venues, collectives, events)
        const djRef: EventDJRef = {
          djName: editingProfile.chatUsername,
          djUsername: editingProfile.chatUsernameNormalized,
          djPhotoUrl: photoUrl || undefined,
        };

        const addedVenues = linkedVenueIds.filter(id => !originalLinkedVenueIds.includes(id));
        const removedVenues = originalLinkedVenueIds.filter(id => !linkedVenueIds.includes(id));
        const addedCollectives = linkedCollectiveIds.filter(id => !originalLinkedCollectiveIds.includes(id));
        const removedCollectives = originalLinkedCollectiveIds.filter(id => !linkedCollectiveIds.includes(id));
        const addedEvents = linkedEventIds.filter(id => !originalLinkedEventIds.includes(id));
        const removedEvents = originalLinkedEventIds.filter(id => !linkedEventIds.includes(id));

        // Update venues
        for (const venueId of addedVenues) {
          const venue = venueOptions.find(v => v.id === venueId);
          if (!venue) continue;
          const updatedDJs = [...venue.residentDJs, djRef];
          await fetch('/api/admin/venues', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ venueId, residentDJs: updatedDJs }),
          });
        }
        for (const venueId of removedVenues) {
          const venue = venueOptions.find(v => v.id === venueId);
          if (!venue) continue;
          const updatedDJs = venue.residentDJs.filter(d => d.djUsername !== editingProfile.chatUsernameNormalized && d.djName !== editingProfile.chatUsername);
          await fetch('/api/admin/venues', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ venueId, residentDJs: updatedDJs }),
          });
        }

        // Update collectives
        for (const collectiveId of addedCollectives) {
          const coll = collectiveOptions.find(c => c.id === collectiveId);
          if (!coll) continue;
          const updatedDJs = [...coll.residentDJs, djRef];
          await fetch('/api/admin/collectives', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ collectiveId, residentDJs: updatedDJs }),
          });
        }
        for (const collectiveId of removedCollectives) {
          const coll = collectiveOptions.find(c => c.id === collectiveId);
          if (!coll) continue;
          const updatedDJs = coll.residentDJs.filter(d => d.djUsername !== editingProfile.chatUsernameNormalized && d.djName !== editingProfile.chatUsername);
          await fetch('/api/admin/collectives', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ collectiveId, residentDJs: updatedDJs }),
          });
        }

        // Update events
        for (const eventId of addedEvents) {
          const evt = eventOptions.find(e => e.id === eventId);
          if (!evt) continue;
          const updatedDJs = [...evt.djs, djRef];
          await fetch('/api/admin/events', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ eventId, djs: updatedDJs }),
          });
        }
        for (const eventId of removedEvents) {
          const evt = eventOptions.find(e => e.id === eventId);
          if (!evt) continue;
          const updatedDJs = evt.djs.filter(d => d.djUsername !== editingProfile.chatUsernameNormalized && d.djName !== editingProfile.chatUsername);
          await fetch('/api/admin/events', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ eventId, djs: updatedDJs }),
          });
        }

        setSuccess(`Updated DJ profile for ${djName}`);
        resetForm();
        fetchPendingProfiles();
        fetchVenueOptions();
        fetchCollectiveOptions();
        fetchEventOptions();
      } else {
        // Create new profile via API
        const response = await fetch('/api/admin/create-pending-dj-profile', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            ...(email.trim() ? { email: email.trim().toLowerCase() } : {}),
            username: djName.trim(),
            djProfile: {
              bio: bio.trim() || null,
              location: location.trim() || null,
              genres: genres.trim() ? genres.split(',').map((g) => g.trim()).filter(Boolean) : [],
              promoText: promoText.trim() || null,
              promoHyperlink: promoHyperlink.trim() ? normalizeUrl(promoHyperlink.trim()) : null,
              photoUrl: photoUrl || null,
              socialLinks: socialLinksData,
              irlShows: validIrlShows.length > 0 ? validIrlShows : undefined,
              myRecs: (validBandcampRecs.length > 0 || validEventRecs.length > 0) ? {
                bandcampLinks: validBandcampRecs.length > 0 ? validBandcampRecs : undefined,
                eventLinks: validEventRecs.length > 0 ? validEventRecs : undefined,
              } : undefined,
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

  // Send claim profile email to DJ
  const sendClaimProfileEmail = (profile: PendingProfile) => {
    if (!profile.email) {
      setError('Cannot send email: no email address set for this profile');
      return;
    }

    const signUpUrl = `${window.location.origin}/studio/join`;
    const profileUrl = `${window.location.origin}/dj/${profile.chatUsernameNormalized}`;

    const subject = `Claim your DJ profile on Channel`;
    const body = `Hi ${profile.chatUsername},

Your DJ profile is ready on Channel!

To claim it:
1. Go to: ${signUpUrl}
2. Sign up or log in using THIS email address: ${profile.email}
   (You must use this exact email for the profile to link automatically)
3. Once logged in, your DJ profile will be automatically connected to your account

Your public DJ profile page: ${profileUrl}

After claiming, you'll be able to:
- Edit your bio, photo, and social links
- Have your followers notified each time you are doing a show on the radio or IRL
- Chat with your audience
- Receive tips from listeners

See you on Channel!
- Channel Team`;

    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(profile.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, '_blank');
  };

  // Handle delete
  const handleDelete = async () => {
    if (!editingProfile) return;

    if (!confirm(`Are you sure you want to delete the pending profile for ${editingProfile.chatUsername}?`)) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const token = await user?.getIdToken();
      if (!token) {
        setError('Not authenticated');
        setDeleting(false);
        return;
      }

      const response = await fetch(`/api/admin/create-pending-dj-profile?profileId=${editingProfile.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || 'Failed to delete pending profile');
        setDeleting(false);
        return;
      }

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
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="dj@example.com"
                    disabled={!!editingProfile && !!editingProfile.email}
                    className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    required={false}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {editingProfile
                      ? (editingProfile.email
                          ? 'Email cannot be changed'
                          : 'Add email to enable profile claiming')
                      : 'Optional - used to link profile when they sign up'}
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

              {/* Profile Photo */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Profile Photo
                </label>
                <div className="flex items-start gap-4">
                  <div className="relative w-24 h-24 bg-[#252525] rounded-full overflow-hidden flex-shrink-0">
                    {photoUrl ? (
                      <Image
                        src={photoUrl}
                        alt="Profile photo"
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-500">
                        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
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
                    <p className="text-xs text-gray-500">
                      JPG, PNG, GIF, or WebP. Max 5MB.
                    </p>
                  </div>
                </div>
                {photoError && (
                  <p className="text-red-400 text-sm mt-2">{photoError}</p>
                )}
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
                    <label className="block text-xs text-gray-500 mb-1">Bandcamp</label>
                    <input
                      type="url"
                      value={bandcamp}
                      onChange={(e) => setBandcamp(e.target.value)}
                      placeholder="yourname.bandcamp.com"
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
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Mixcloud</label>
                    <input
                      type="url"
                      value={mixcloud}
                      onChange={(e) => setMixcloud(e.target.value)}
                      placeholder="mixcloud.com/yourname"
                      className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Resident Advisor</label>
                    <input
                      type="url"
                      value={residentAdvisor}
                      onChange={(e) => setResidentAdvisor(e.target.value)}
                      placeholder="ra.co/dj/yourname"
                      className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Booking Email</label>
                    <input
                      type="email"
                      value={bookingEmail}
                      onChange={(e) => setBookingEmail(e.target.value)}
                      placeholder="booking@example.com"
                      className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Website</label>
                    <input
                      type="url"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="yourwebsite.com"
                      className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors text-sm"
                    />
                  </div>
                </div>

                {/* Custom Links */}
                <div className="mt-4 pt-4 border-t border-gray-700">
                  <label className="block text-xs text-gray-500 mb-2">Other Links</label>
                  <div className="space-y-2">
                    {customLinks.map((link, index) => (
                      <div key={index} className="flex gap-2">
                        <input
                          type="text"
                          value={link.label}
                          onChange={(e) => {
                            const updated = [...customLinks];
                            updated[index] = { ...updated[index], label: e.target.value };
                            setCustomLinks(updated);
                          }}
                          placeholder="Label"
                          className="w-1/3 bg-[#252525] border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors text-sm"
                        />
                        <input
                          type="url"
                          value={link.url}
                          onChange={(e) => {
                            const updated = [...customLinks];
                            updated[index] = { ...updated[index], url: e.target.value };
                            setCustomLinks(updated);
                          }}
                          placeholder="URL"
                          className="flex-1 bg-[#252525] border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = customLinks.filter((_, i) => i !== index);
                            setCustomLinks(updated);
                          }}
                          className="px-2 text-gray-500 hover:text-red-400 transition-colors"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCustomLinks([...customLinks, { label: '', url: '' }])}
                      className="text-gray-400 hover:text-white text-sm transition-colors flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Link
                    </button>
                  </div>
                </div>
              </div>

              {/* IRL Shows */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  IRL Shows
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  Promote upcoming in-person gigs
                </p>
                <div className="space-y-3">
                  {irlShows.map((show, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="url"
                        value={show.url}
                        onChange={(e) => {
                          const updated = [...irlShows];
                          updated[index] = { ...updated[index], url: e.target.value };
                          setIrlShows(updated);
                        }}
                        placeholder="Event URL (e.g., ra.co/events/...)"
                        className="flex-1 bg-[#252525] border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors text-sm"
                      />
                      <input
                        type="text"
                        value={show.date}
                        onChange={(e) => {
                          const updated = [...irlShows];
                          updated[index] = { ...updated[index], date: e.target.value };
                          setIrlShows(updated);
                        }}
                        placeholder="Date"
                        className="w-28 bg-[#252525] border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* My Recs */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  My Recs
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  Share music and events recommendations
                </p>

                {/* Bandcamp Recs */}
                <div className="mb-4">
                  <label className="block text-xs text-gray-500 mb-2">Bandcamp</label>
                  <div className="space-y-2">
                    {bandcampRecs.map((url, index) => (
                      <div key={index} className="flex gap-2">
                        <input
                          type="url"
                          value={url}
                          onChange={(e) => {
                            const updated = [...bandcampRecs];
                            updated[index] = e.target.value;
                            setBandcampRecs(updated);
                          }}
                          placeholder="https://artist.bandcamp.com/album"
                          className="flex-1 bg-[#252525] border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors text-sm"
                        />
                        {bandcampRecs.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = bandcampRecs.filter((_, i) => i !== index);
                              setBandcampRecs(updated);
                            }}
                            className="px-2 text-gray-500 hover:text-red-400 transition-colors"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setBandcampRecs([...bandcampRecs, ''])}
                      className="text-gray-400 hover:text-white text-sm transition-colors flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Bandcamp Link
                    </button>
                  </div>
                </div>

                {/* Event Recs */}
                <div>
                  <label className="block text-xs text-gray-500 mb-2">Events</label>
                  <div className="space-y-2">
                    {eventRecs.map((url, index) => (
                      <div key={index} className="flex gap-2">
                        <input
                          type="url"
                          value={url}
                          onChange={(e) => {
                            const updated = [...eventRecs];
                            updated[index] = e.target.value;
                            setEventRecs(updated);
                          }}
                          placeholder="https://ra.co/events/..."
                          className="flex-1 bg-[#252525] border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white transition-colors text-sm"
                        />
                        {eventRecs.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = eventRecs.filter((_, i) => i !== index);
                              setEventRecs(updated);
                            }}
                            className="px-2 text-gray-500 hover:text-red-400 transition-colors"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setEventRecs([...eventRecs, ''])}
                      className="text-gray-400 hover:text-white text-sm transition-colors flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Event Link
                    </button>
                  </div>
                </div>
              </div>

              {/* Entity Linking (only when editing) */}
              {editingProfile && (
                <div className="border-t border-gray-700 pt-6">
                  <label className="block text-sm font-medium text-gray-300 mb-4">
                    Linked Entities
                  </label>

                  {/* Linked Venues */}
                  <div className="mb-4">
                    <label className="block text-xs text-gray-500 mb-2">Venues</label>
                    {linkedVenueIds.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {linkedVenueIds.map(id => {
                          const venue = venueOptions.find(v => v.id === id);
                          return (
                            <span key={id} className="inline-flex items-center gap-1 bg-[#252525] border border-gray-700 rounded-full px-3 py-1 text-sm text-white">
                              {venue?.name || id}
                              <button
                                type="button"
                                onClick={() => setLinkedVenueIds(linkedVenueIds.filter(v => v !== id))}
                                className="text-gray-500 hover:text-red-400 ml-1"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value && !linkedVenueIds.includes(e.target.value)) {
                          setLinkedVenueIds([...linkedVenueIds, e.target.value]);
                        }
                      }}
                      className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-white transition-colors"
                    >
                      <option value="">Add venue...</option>
                      {venueOptions
                        .filter(v => !linkedVenueIds.includes(v.id))
                        .map(v => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                    </select>
                  </div>

                  {/* Linked Collectives */}
                  <div className="mb-4">
                    <label className="block text-xs text-gray-500 mb-2">Collectives</label>
                    {linkedCollectiveIds.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {linkedCollectiveIds.map(id => {
                          const coll = collectiveOptions.find(c => c.id === id);
                          return (
                            <span key={id} className="inline-flex items-center gap-1 bg-[#252525] border border-gray-700 rounded-full px-3 py-1 text-sm text-white">
                              {coll?.name || id}
                              <button
                                type="button"
                                onClick={() => setLinkedCollectiveIds(linkedCollectiveIds.filter(c => c !== id))}
                                className="text-gray-500 hover:text-red-400 ml-1"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value && !linkedCollectiveIds.includes(e.target.value)) {
                          setLinkedCollectiveIds([...linkedCollectiveIds, e.target.value]);
                        }
                      }}
                      className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-white transition-colors"
                    >
                      <option value="">Add collective...</option>
                      {collectiveOptions
                        .filter(c => !linkedCollectiveIds.includes(c.id))
                        .map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                  </div>

                  {/* Linked Events */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-2">Events</label>
                    {linkedEventIds.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {linkedEventIds.map(id => {
                          const evt = eventOptions.find(e => e.id === id);
                          return (
                            <span key={id} className="inline-flex items-center gap-1 bg-[#252525] border border-gray-700 rounded-full px-3 py-1 text-sm text-white">
                              {evt?.name || id}
                              <button
                                type="button"
                                onClick={() => setLinkedEventIds(linkedEventIds.filter(e => e !== id))}
                                className="text-gray-500 hover:text-red-400 ml-1"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value && !linkedEventIds.includes(e.target.value)) {
                          setLinkedEventIds([...linkedEventIds, e.target.value]);
                        }
                      }}
                      className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-white transition-colors"
                    >
                      <option value="">Add event...</option>
                      {eventOptions
                        .filter(e => !linkedEventIds.includes(e.id))
                        .map(e => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                    </select>
                  </div>
                </div>
              )}

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
                      {profile.email && (
                        <button
                          onClick={() => sendClaimProfileEmail(profile)}
                          className="text-green-400 hover:text-green-300 text-sm font-medium"
                        >
                          Invite
                        </button>
                      )}
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
