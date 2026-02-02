'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { HeaderSearch } from '@/components/HeaderSearch';
import { TimeSlotPicker } from '@/components/dj-portal/TimeSlotPicker';
import { DJApplicationFormData, TimeSlot, LocationType } from '@/types/dj-application';
import { AuthModal } from '@/components/AuthModal';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isDJ } from '@/hooks/useUserRole';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

export function StudioJoinClient() {
  const { user, isAuthenticated } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);
  const userIsDJ = isDJ(role);
  const [formData, setFormData] = useState<DJApplicationFormData>({
    djName: '',
    email: '',
    showName: '',
    setDuration: 2, // Default 2 hours
    locationType: 'home',
    venueName: '',
    soundcloud: '',
    instagram: '',
    youtube: '',
    preferredSlots: [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, // Auto-detect user's timezone
    comments: '',
    needsSetupSupport: false,
  });
  const [agreedToDJTerms, setAgreedToDJTerms] = useState(false);
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [upgradingToDJ, setUpgradingToDJ] = useState(false);
  const [upgradeError, setUpgradeError] = useState('');
  // Track which fields came from DJ profile (to disable them)
  const [profileFields, setProfileFields] = useState<{
    djName: boolean;
    soundcloud: boolean;
    instagram: boolean;
    youtube: boolean;
  }>({ djName: false, soundcloud: false, instagram: false, youtube: false });

  // Pre-fill form with user data when logged in
  useEffect(() => {
    if (user) {
      setFormData((prev) => ({
        ...prev,
        email: user.email || prev.email,
        djName: prev.djName || user.displayName || '',
      }));
    }
  }, [user]);

  // Assign DJ role after user signs up through AuthModal on this page
  // The AuthModal includes DJ terms, so signing up = accepting DJ terms
  // Uses the API endpoint which also claims any pending DJ profiles
  useEffect(() => {
    async function assignDJRoleAfterSignup() {
      if (!user || roleLoading) return;

      // Check if we already processed this signup (persists across reloads)
      const signupProcessedKey = `dj-signup-processed-${user.uid}`;
      const alreadyProcessed = sessionStorage.getItem(signupProcessedKey);

      // Only assign if user is not already a DJ and we haven't processed this signup
      if (!userIsDJ && !alreadyProcessed) {
        try {
          // Mark as processed before calling API to prevent loops
          sessionStorage.setItem(signupProcessedKey, 'true');

          // Use the API endpoint which handles claiming pending DJ profiles
          const response = await fetch('/api/users/assign-dj-role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user.email }),
          });

          if (response.ok) {
            // Force page reload to get updated role and profile data
            window.location.reload();
          }
        } catch (error) {
          console.error('Failed to assign DJ role after signup:', error);
          // Clear the flag so they can retry
          sessionStorage.removeItem(signupProcessedKey);
        }
      }
    }

    assignDJRoleAfterSignup();
  }, [user, userIsDJ, roleLoading]);

  // Fetch DJ profile to pre-fill form (for DJ users)
  useEffect(() => {
    async function fetchDJProfile() {
      if (!user || !db || !userIsDJ) return;

      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const data = userSnap.data();
          const chatUsername = data.chatUsername;
          const socialLinks = data.djProfile?.socialLinks || {};

          // Pre-fill form and track which fields came from profile
          setFormData((prev) => ({
            ...prev,
            djName: chatUsername || data.displayName || user.displayName || prev.djName,
            soundcloud: socialLinks.soundcloud || prev.soundcloud,
            instagram: socialLinks.instagram || prev.instagram,
            youtube: socialLinks.youtube || prev.youtube,
          }));

          setProfileFields({
            djName: !!(chatUsername || data.displayName),
            soundcloud: !!socialLinks.soundcloud,
            instagram: !!socialLinks.instagram,
            youtube: !!socialLinks.youtube,
          });
        }
      } catch (error) {
        console.error('Failed to fetch DJ profile:', error);
      }
    }

    fetchDJProfile();
  }, [user, userIsDJ]);

  // Handle upgrade to DJ for logged-in non-DJ users
  const handleUpgradeToDJ = async () => {
    if (!user || !agreedToDJTerms) {
      setUpgradeError('Please accept the DJ Terms to continue');
      return;
    }

    setUpgradingToDJ(true);
    setUpgradeError('');

    try {
      // Use the API endpoint which handles claiming pending DJ profiles
      const response = await fetch('/api/users/assign-dj-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });

      if (!response.ok) {
        throw new Error('Failed to upgrade to DJ');
      }

      // Force page reload to get updated role
      window.location.reload();
    } catch (error) {
      console.error('Failed to upgrade to DJ:', error);
      setUpgradeError('Failed to upgrade. Please try again.');
    } finally {
      setUpgradingToDJ(false);
    }
  };


  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleLocationChange = (locationType: LocationType) => {
    setFormData((prev) => ({ ...prev, locationType, venueName: '' }));
  };

  const handleSlotsChange = (slots: TimeSlot[]) => {
    setFormData((prev) => ({ ...prev, preferredSlots: slots }));
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: checked }));
  };

  const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = parseFloat(e.target.value);
    if (isNaN(rawValue)) return;

    // Round to nearest 0.5 and clamp to valid range
    const roundedValue = Math.round(rawValue * 2) / 2;
    const clampedValue = Math.max(0.5, Math.min(24, roundedValue));

    setFormData((prev) => ({ ...prev, setDuration: clampedValue }));
  };

  const validateForm = (): boolean => {
    if (!formData.djName.trim()) {
      setErrorMessage('DJ name is required');
      return false;
    }
    if (!formData.email.trim()) {
      setErrorMessage('Email is required');
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setErrorMessage('Please enter a valid email address');
      return false;
    }
    if (!formData.showName.trim()) {
      setErrorMessage('Show name is required');
      return false;
    }
    if (!formData.setDuration || formData.setDuration < 0.5 || formData.setDuration > 24) {
      setErrorMessage('Set duration must be between 0.5 and 24 hours');
      return false;
    }
    if ((formData.setDuration * 2) % 1 !== 0) {
      setErrorMessage('Set duration must be in 0.5 hour increments (e.g., 2 or 2.5, not 2.3)');
      return false;
    }
    if (formData.locationType === 'venue' && !formData.venueName?.trim()) {
      setErrorMessage('Please enter the venue name');
      return false;
    }
    if (formData.preferredSlots.length === 0) {
      setErrorMessage('Please select at least one preferred time slot');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!validateForm()) return;

    try {
      setStatus('submitting');

      const response = await fetch('/api/dj-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit application');
      }

      // Save new fields to DJ profile (only if user didn't have them before)
      if (user && db) {
        const updates: Record<string, unknown> = {};

        // Save DJ name to chatUsername if it's new
        if (!profileFields.djName && formData.djName.trim()) {
          updates.chatUsername = formData.djName.trim();
        }

        // Build socialLinks updates
        const socialLinksUpdates: Record<string, string> = {};
        if (!profileFields.soundcloud && formData.soundcloud?.trim()) {
          socialLinksUpdates.soundcloud = formData.soundcloud.trim();
        }
        if (!profileFields.instagram && formData.instagram?.trim()) {
          socialLinksUpdates.instagram = formData.instagram.trim();
        }
        if (!profileFields.youtube && formData.youtube?.trim()) {
          socialLinksUpdates.youtube = formData.youtube.trim();
        }

        // Only update if there's something new to save
        if (Object.keys(updates).length > 0 || Object.keys(socialLinksUpdates).length > 0) {
          try {
            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);
            const currentData = userSnap.data();
            const currentSocialLinks = currentData?.djProfile?.socialLinks || {};

            await setDoc(userRef, {
              ...updates,
              djProfile: {
                ...currentData?.djProfile,
                socialLinks: {
                  ...currentSocialLinks,
                  ...socialLinksUpdates,
                },
              },
            }, { merge: true });
          } catch (profileError) {
            // Don't fail the whole submission if profile update fails
            console.error('Failed to update DJ profile:', profileError);
          }
        }
      }

      setStatus('success');
    } catch (error) {
      console.error('Error submitting application:', error);
      setStatus('error');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Failed to submit application. Please try again or email us directly.'
      );
    }
  };

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-black">
        <Header currentPage="studio" position="sticky" />

        <div className="p-4 md:p-8">
          <div className="max-w-2xl mx-auto text-center py-20">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="text-3xl font-bold mb-4">Application Submitted!</h1>
            <p className="text-gray-400 mb-8">
              Thanks {formData.djName}! We&apos;ll review your application and get back to you soon.
            </p>
            <Link
              href="/"
              className="inline-block bg-white text-black px-8 py-3 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
            >
              Back to Channel
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Show loading state while checking user role (only if authenticated)
  // This prevents flickering between upgrade view and DJ form
  if (isAuthenticated && roleLoading) {
    return (
      <div className="min-h-screen bg-black">
        <Header currentPage="studio" position="sticky" />
        <div className="p-4 md:p-8">
          <div className="max-w-2xl mx-auto flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <Header currentPage="studio" position="sticky" />

      <main className="p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
          {/* Search bar - mobile only */}
          <div className="md:hidden mb-6">
            <HeaderSearch onAuthRequired={() => setShowAuthModal(true)} />
          </div>

          {/* Hero Section - Only show for non-DJs */}
          {!userIsDJ && (
            <div className="mb-12">
              <h1 className="text-3xl font-bold mb-4">DJ Studio</h1>
              <p className="text-xl text-gray-300 mb-6">Create your DJ profile on Channel</p>

              <p className="text-gray-400 leading-relaxed mb-8">
                Think of Channel as SoundCloud + Linktree + live radio — built for DJs and their communities.
              </p>

              <h2 className="text-lg font-semibold mb-4">What you get when you sign up</h2>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="w-6 h-6 flex-shrink-0 mt-0.5">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium">A public DJ profile</p>
                    <p className="text-gray-400 text-sm">
                      Your own DJ page with links, shows, and sets (example →{' '}
                      <Link href="/dj/djcap" className="text-white underline hover:text-gray-300">channel-app.com/dj/djcap</Link>)
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-6 h-6 flex-shrink-0 mt-0.5">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium">Live or recorded sets</p>
                    <p className="text-gray-400 text-sm">Livestream or record sets from home or directly from a venue</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-6 h-6 flex-shrink-0 mt-0.5">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium">Automatic fan notifications</p>
                    <p className="text-gray-400 text-sm">Fans get notified every time you play — live on Channel, on any radio, when you promote a new event, or release a new record</p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="w-6 h-6 flex-shrink-0 mt-0.5">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-medium">Chat &amp; tips</p>
                    <p className="text-gray-400 text-sm">Talk to listeners, receive tips, and reward your community</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sign Up / Upgrade Section - Only show if not already a DJ */}
          {!userIsDJ && (
            <div className="border-t border-gray-800 pt-12 mb-12">
              {isAuthenticated ? (
                // State B: Logged in, NOT a DJ - show upgrade section
                <>
                  <h2 className="text-2xl font-semibold mb-4">Upgrade to DJ Profile</h2>
                  <p className="text-gray-400 mb-6">
                    You&apos;re logged in as {user?.email}. Accept the DJ Terms to unlock your DJ profile.
                  </p>

                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                    <label className="flex items-start gap-3 cursor-pointer mb-4">
                      <input
                        type="checkbox"
                        checked={agreedToDJTerms}
                        onChange={(e) => setAgreedToDJTerms(e.target.checked)}
                        className="mt-1 w-5 h-5 rounded border-gray-600 bg-gray-800 text-white focus:ring-0 focus:ring-offset-0 cursor-pointer"
                      />
                      <span className="text-sm text-gray-300">
                        I have read and agree to the{' '}
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
                      className="bg-white text-black px-8 py-3 rounded-xl font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {upgradingToDJ ? (
                        <>
                          <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                          Upgrading...
                        </>
                      ) : (
                        'Upgrade to DJ'
                      )}
                    </button>
                  </div>
                </>
              ) : (
                // State A: Not logged in - show inline sign up form
                <>
                  <h2 className="text-2xl font-semibold mb-6">Sign up</h2>
                  <div className="max-w-sm">
                    <AuthModal
                      isOpen={true}
                      onClose={() => {}}
                      message="Create your DJ profile"
                      inline
                      includeDjTerms
                    />
                  </div>
                </>
              )}
            </div>
          )}

{/* Channel Broadcast Application Section - Only show for DJs */}
          {userIsDJ && (
            <div className="border-t border-gray-800 pt-12">
              <h2 className="text-2xl font-semibold mb-4">Apply to Channel Broadcast</h2>
              <p className="text-gray-400 mb-4">
                Apply to schedule a live set on our radio. If you&apos;re unsure about your setup, check the{' '}
                <Link href="/streaming-guide" className="text-white underline hover:text-gray-300 transition-colors">
                  streaming guide
                </Link>{' '}
                or reach out at{' '}
                <a href="mailto:info@channel-app.com" className="text-white underline hover:text-gray-300 transition-colors">
                  info@channel-app.com
                </a>.
              </p>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-6 mt-8">
              {/* DJ Name */}
              <div>
                <label
                  htmlFor="djName"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
                  DJ Name *
                </label>
                <input
                  type="text"
                  id="djName"
                  name="djName"
                  value={formData.djName}
                  onChange={handleInputChange}
                  placeholder="Your DJ name"
                  disabled={profileFields.djName}
                  className="w-full px-4 py-3 bg-[#1a1a1a] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              {/* Email */}
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
                  Email *
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="you@example.com"
                  disabled={isAuthenticated}
                  className="w-full px-4 py-3 bg-[#1a1a1a] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors disabled:opacity-60"
                />
              </div>

              {/* Show Name */}
              <div>
                <label
                  htmlFor="showName"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
                  Show Name *
                </label>
                <input
                  type="text"
                  id="showName"
                  name="showName"
                  value={formData.showName}
                  onChange={handleInputChange}
                  placeholder="Name of your show or set"
                  className="w-full px-4 py-3 bg-[#1a1a1a] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors"
                />
              </div>

              {/* Set Duration */}
              <div>
                <label
                  htmlFor="setDuration"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
                  Set Duration (hours) *
                </label>
                <p className="text-sm text-gray-500 mb-3">
                  How long will your set be? All your preferred time slots will use this duration.
                </p>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    id="setDuration"
                    name="setDuration"
                    value={formData.setDuration}
                    onChange={handleDurationChange}
                    min={0.5}
                    max={24}
                    step={0.5}
                    className="w-32 px-4 py-3 bg-[#1a1a1a] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors text-center"
                  />
                  <span className="text-gray-400">hours</span>
                </div>
              </div>

              {/* Location Type */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-3">
                  Where will you be streaming from? *
                </label>
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => handleLocationChange('home')}
                    className={`flex-1 py-3 px-4 rounded-xl border transition-colors ${
                      formData.locationType === 'home'
                        ? 'bg-white text-black border-white'
                        : 'bg-[#1a1a1a] text-gray-300 border-gray-800 hover:border-gray-600'
                    }`}
                  >
                    Home
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLocationChange('venue')}
                    className={`flex-1 py-3 px-4 rounded-xl border transition-colors ${
                      formData.locationType === 'venue'
                        ? 'bg-white text-black border-white'
                        : 'bg-[#1a1a1a] text-gray-300 border-gray-800 hover:border-gray-600'
                    }`}
                  >
                    Venue
                  </button>
                </div>
              </div>

              {/* Venue Name (conditional) */}
              {formData.locationType === 'venue' && (
                <div>
                  <label
                    htmlFor="venueName"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    Venue Name *
                  </label>
                  <input
                    type="text"
                    id="venueName"
                    name="venueName"
                    value={formData.venueName}
                    onChange={handleInputChange}
                    placeholder="Name of the venue"
                    className="w-full px-4 py-3 bg-[#1a1a1a] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors"
                  />
                </div>
              )}

              {/* Setup Support Checkbox */}
              <div className="pt-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="needsSetupSupport"
                    checked={formData.needsSetupSupport}
                    onChange={handleCheckboxChange}
                    className="mt-1 w-5 h-5 rounded border-gray-700 bg-[#1a1a1a] text-white focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                  <span className="text-sm text-gray-300">
                    I need help setting up my livestream
                    <span className="block text-gray-500 mt-1">
                      We&apos;ll reach out to walk you through the setup process before your scheduled time.
                    </span>
                  </span>
                </label>
              </div>

              {/* Social Links */}
              <div className="space-y-4 pt-4">
                <p className="text-sm text-gray-500">Social links (optional)</p>

                <div>
                  <label
                    htmlFor="soundcloud"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    SoundCloud
                  </label>
                  <input
                    type="text"
                    id="soundcloud"
                    name="soundcloud"
                    value={formData.soundcloud}
                    onChange={handleInputChange}
                    placeholder="https://soundcloud.com/yourname"
                    disabled={profileFields.soundcloud}
                    className="w-full px-4 py-3 bg-[#1a1a1a] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>

                <div>
                  <label
                    htmlFor="instagram"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    Instagram
                  </label>
                  <input
                    type="text"
                    id="instagram"
                    name="instagram"
                    value={formData.instagram}
                    onChange={handleInputChange}
                    placeholder="@yourhandle"
                    disabled={profileFields.instagram}
                    className="w-full px-4 py-3 bg-[#1a1a1a] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>

                <div>
                  <label
                    htmlFor="youtube"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    YouTube
                  </label>
                  <input
                    type="text"
                    id="youtube"
                    name="youtube"
                    value={formData.youtube}
                    onChange={handleInputChange}
                    placeholder="https://youtube.com/@yourname"
                    disabled={profileFields.youtube}
                    className="w-full px-4 py-3 bg-[#1a1a1a] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Time Slot Picker */}
              <div className="pt-6">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Preferred Set Times *
                </label>
                <p className="text-sm text-gray-500 mb-4">
                  Click a start time to add a {formData.setDuration}-hour slot. Click again to remove it.
                </p>
                <TimeSlotPicker
                  selectedSlots={formData.preferredSlots}
                  onChange={handleSlotsChange}
                  setDuration={formData.setDuration}
                />
              </div>

              {/* Comments */}
              <div className="pt-6">
                <label
                  htmlFor="comments"
                  className="block text-sm font-medium text-gray-300 mb-2"
                >
                  Comments (optional)
                </label>
                <textarea
                  id="comments"
                  name="comments"
                  value={formData.comments}
                  onChange={handleInputChange}
                  placeholder="Anything else you'd like us to know about your set, style, or availability?"
                  rows={4}
                  className="w-full px-4 py-3 bg-[#1a1a1a] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors resize-none"
                />
              </div>

              {/* Help text */}
              <div className="pt-6 border-t border-gray-800">
                <p className="text-sm text-gray-500 leading-relaxed">
                  If you have questions or aren&apos;t sure whether your setup works, reach out at{' '}
                  <a
                    href="mailto:info@channel-app.com"
                    className="text-white hover:underline"
                  >
                    info@channel-app.com
                  </a>
                </p>
              </div>

              {/* Error message */}
              {errorMessage && (
                <div className="p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-400 text-sm">
                  {errorMessage}
                </div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full bg-white text-black py-4 rounded-xl font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {status === 'submitting' ? (
                  <>
                    <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Apply'
                )}
              </button>
            </form>
          </div>
          )}
        </div>
      </main>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message="Sign in to create your DJ profile"
        includeDjTerms
      />
    </div>
  );
}
