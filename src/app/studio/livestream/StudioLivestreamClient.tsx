'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { DJApplicationFormData } from '@/types/dj-application';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isDJ } from '@/hooks/useUserRole';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

export function StudioLivestreamClient() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);
  const userIsDJ = isDJ(role);

  const [formData, setFormData] = useState<DJApplicationFormData>({
    djName: '',
    email: '',
    showName: '',
  });
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  // Track whether djName came from the DJ profile (to disable it)
  const [djNameFromProfile, setDjNameFromProfile] = useState(false);

  // Redirect non-DJs (logged out or logged in without DJ role) to /studio/join
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace('/studio/join');
      return;
    }
    if (!roleLoading && !userIsDJ) {
      router.replace('/studio/join');
    }
  }, [authLoading, isAuthenticated, roleLoading, userIsDJ, router]);

  // Pre-fill form with user data when logged in
  useEffect(() => {
    if (user) {
      setFormData((prev) => ({
        ...prev,
        email: user.email || prev.email,
      }));
    }
  }, [user]);

  // Fetch DJ profile to pre-fill curator name
  useEffect(() => {
    async function fetchDJProfile() {
      if (!user || !db || !userIsDJ) return;

      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const data = userSnap.data();
          const chatUsername = data.chatUsername;

          setFormData((prev) => ({
            ...prev,
            djName: chatUsername || prev.djName,
          }));
          setDjNameFromProfile(!!chatUsername);
        }
      } catch (error) {
        console.error('Failed to fetch DJ profile:', error);
      }
    }

    fetchDJProfile();
  }, [user, userIsDJ]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const validateForm = (): boolean => {
    if (!formData.djName.trim()) {
      setErrorMessage('Curator name is required');
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
    if (!formData.showName?.trim()) {
      setErrorMessage('Show name is required');
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
        body: JSON.stringify({
          ...formData,
          source: 'show-request',
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit application');
      }

      // Save curator name to profile if it wasn't already set
      if (user && db && !djNameFromProfile && formData.djName.trim()) {
        try {
          const userRef = doc(db, 'users', user.uid);
          await setDoc(
            userRef,
            { chatUsername: formData.djName.trim() },
            { merge: true }
          );
        } catch (profileError) {
          console.error('Failed to update DJ profile:', profileError);
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
            <h1 className="text-3xl font-bold mb-4">Thank you!</h1>
            <p className="text-gray-400 mb-8">
              Thanks {formData.djName}! We&apos;ll get back to you within 3 business days.
            </p>
            <Link
              href="/"
              className="inline-block bg-white text-black px-8 py-3 rounded font-semibold hover:bg-gray-200 transition-colors"
            >
              Back to Channel
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Show spinner while resolving auth/role, or while redirecting non-DJs to /studio/join
  if (authLoading || !isAuthenticated || roleLoading || !userIsDJ) {
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
          <h2 className="text-2xl font-semibold mb-4">Book your next show</h2>
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
            {/* Curator Name */}
            <div>
              <label
                htmlFor="djName"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Curator Name *
              </label>
              <input
                type="text"
                id="djName"
                name="djName"
                value={formData.djName}
                onChange={handleInputChange}
                placeholder="Your curator name"
                disabled={djNameFromProfile}
                className="w-full px-4 py-3 bg-[#1a1a1a] border border-gray-800 rounded text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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
                className="w-full px-4 py-3 bg-[#1a1a1a] border border-gray-800 rounded text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors disabled:opacity-60"
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
                className="w-full px-4 py-3 bg-[#1a1a1a] border border-gray-800 rounded text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors"
              />
            </div>

            <p className="text-sm text-gray-500 leading-relaxed pt-4">
              Questions? Reach out at{' '}
              <a
                href="mailto:info@channel-app.com"
                className="text-white hover:underline"
              >
                info@channel-app.com
              </a>
            </p>

            {/* Error message */}
            {errorMessage && (
              <div className="p-4 bg-red-900/30 border border-red-800 rounded text-red-400 text-sm">
                {errorMessage}
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full bg-white text-black py-4 rounded font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {status === 'submitting' ? (
                <>
                  <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit'
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
