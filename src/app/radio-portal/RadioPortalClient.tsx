'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isBroadcaster } from '@/hooks/useUserRole';
import { Header } from '@/components/Header';

type ViewState = 'initial' | 'options' | 'launch-form' | 'feature-form';
type FormStatus = 'idle' | 'submitting' | 'success' | 'error';
type FormType = 'launch' | 'feature' | null;

interface LaunchFormData {
  name: string;
  email: string;
  url: string;
  description: string;
}

interface FeatureFormData {
  name: string;
  email: string;
  radioUrl: string;
  plays24_7: boolean | null;
  message: string;
}

export function RadioPortalClient() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);

  const [viewState, setViewState] = useState<ViewState>('initial');
  const [submittedFormType, setSubmittedFormType] = useState<FormType>(null);
  const [launchFormData, setLaunchFormData] = useState<LaunchFormData>({
    name: '',
    email: '',
    url: '',
    description: '',
  });
  const [featureFormData, setFeatureFormData] = useState<FeatureFormData>({
    name: '',
    email: '',
    radioUrl: '',
    plays24_7: null,
    message: '',
  });
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // Redirect broadcasters to admin dashboard
  useEffect(() => {
    if (!authLoading && !roleLoading && isAuthenticated && isBroadcaster(role)) {
      router.push('/broadcast/admin');
    }
  }, [authLoading, roleLoading, isAuthenticated, role, router]);

  const handleLaunchInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setLaunchFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFeatureInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFeatureFormData((prev) => ({ ...prev, [name]: value }));
  };

  const validateLaunchForm = (): boolean => {
    if (!launchFormData.name.trim()) {
      setErrorMessage('Name is required');
      return false;
    }
    if (!launchFormData.email.trim()) {
      setErrorMessage('Email is required');
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(launchFormData.email)) {
      setErrorMessage('Please enter a valid email address');
      return false;
    }
    if (launchFormData.url.trim()) {
      try {
        new URL(launchFormData.url);
      } catch {
        setErrorMessage('Please enter a valid URL');
        return false;
      }
    }
    return true;
  };

  const validateFeatureForm = (): boolean => {
    if (!featureFormData.name.trim()) {
      setErrorMessage('Name is required');
      return false;
    }
    if (!featureFormData.email.trim()) {
      setErrorMessage('Email is required');
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(featureFormData.email)) {
      setErrorMessage('Please enter a valid email address');
      return false;
    }
    if (!featureFormData.radioUrl.trim()) {
      setErrorMessage('Radio website URL is required');
      return false;
    }
    try {
      new URL(featureFormData.radioUrl);
    } catch {
      setErrorMessage('Please enter a valid radio website URL');
      return false;
    }
    if (featureFormData.plays24_7 === null) {
      setErrorMessage('Please indicate if you play content 24/7');
      return false;
    }
    return true;
  };

  const handleLaunchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!validateLaunchForm()) return;

    try {
      const { db } = await import('@/lib/firebase');
      const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');

      if (!db) {
        throw new Error('Firebase not configured');
      }

      setStatus('submitting');

      await addDoc(collection(db, 'station-applications'), {
        name: launchFormData.name.trim(),
        email: launchFormData.email.trim(),
        url: launchFormData.url.trim() || null,
        description: launchFormData.description.trim() || null,
        applicationType: 'launch-radio',
        submittedAt: serverTimestamp(),
        status: 'pending',
      });

      setSubmittedFormType('launch');
      setStatus('success');
    } catch (error) {
      console.error('Error submitting application:', error);
      setStatus('error');
      setErrorMessage(
        'Failed to submit application. Please try again or email us directly.'
      );
    }
  };

  const handleFeatureSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!validateFeatureForm()) return;

    try {
      const { db } = await import('@/lib/firebase');
      const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');

      if (!db) {
        throw new Error('Firebase not configured');
      }

      setStatus('submitting');

      await addDoc(collection(db, 'station-applications'), {
        name: featureFormData.name.trim(),
        email: featureFormData.email.trim(),
        radioUrl: featureFormData.radioUrl.trim(),
        plays24_7: featureFormData.plays24_7,
        message: featureFormData.message.trim() || null,
        applicationType: 'feature-station',
        submittedAt: serverTimestamp(),
        status: 'pending',
      });

      setSubmittedFormType('feature');
      setStatus('success');
    } catch (error) {
      console.error('Error submitting application:', error);
      setStatus('error');
      setErrorMessage(
        'Failed to submit application. Please try again or email us directly.'
      );
    }
  };

  // Loading state
  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen bg-black">
        <Header currentPage="radio-portal" position="sticky" />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 60px)' }}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      </div>
    );
  }

  // Redirect in progress for broadcasters
  if (isAuthenticated && isBroadcaster(role)) {
    return (
      <div className="min-h-screen bg-black">
        <Header currentPage="radio-portal" position="sticky" />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 60px)' }}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      </div>
    );
  }

  // Success state
  if (status === 'success') {
    const submittedName = submittedFormType === 'feature' ? featureFormData.name : launchFormData.name;
    return (
      <div className="min-h-screen bg-black">
        <Header currentPage="radio-portal" position="sticky" />
        <div className="flex flex-col items-center justify-center p-8" style={{ minHeight: 'calc(100vh - 60px)' }}>
          <div className="max-w-md text-center">
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
              Thanks {submittedName}! We&apos;ll review your application and get back to you soon.
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

  return (
    <div className="min-h-screen bg-black">
      <Header currentPage="radio-portal" position="sticky" />

      <main className="p-8">
        {/* Intro Section */}
        <div className="max-w-xl mx-auto pt-12 pb-12">
          <h1 className="text-3xl font-bold mb-6">Radio Portal</h1>

          {/* First paragraph */}
          <div className="text-gray-400 leading-relaxed mb-8">
            <p>
              Channel features a curated selection of independent radio stations across web and mobile — including both established radios and new ones getting started.
            </p>
          </div>

          {/* Remaining intro text */}
          <div className="space-y-6 text-gray-400 leading-relaxed">
            <p>
              <strong className="text-white">If you&apos;re looking to launch a radio</strong>, Channel provides the tools to do so: live streaming, scheduling, recording, and monetization features, all designed to support live moments and community, without ads.
            </p>
            <p>
              <strong className="text-white">If you already run a radio</strong>, Channel can help you extend your reach beyond your own site, connect with new listeners, activate real-time community chat around your shows, and experiment with direct fan support — all at no cost.
            </p>
          </div>

          {/* Two buttons side by side */}
          <div className="flex flex-col sm:flex-row gap-4 mt-10">
            <button
              onClick={() => setViewState(viewState === 'feature-form' ? 'initial' : 'feature-form')}
              className={`flex-1 px-6 py-4 rounded-xl text-base font-semibold transition-all ${
                viewState === 'feature-form'
                  ? 'bg-white text-black'
                  : 'bg-[#1a1a1a] border border-gray-700 text-white hover:border-gray-500'
              }`}
            >
              I have a radio
            </button>
            <button
              onClick={() => setViewState(viewState === 'launch-form' ? 'initial' : 'launch-form')}
              className={`flex-1 px-6 py-4 rounded-xl text-base font-semibold transition-all ${
                viewState === 'launch-form'
                  ? 'bg-white text-black'
                  : 'bg-[#1a1a1a] border border-gray-700 text-white hover:border-gray-500'
              }`}
            >
              I want to launch a radio
            </button>
          </div>

          {viewState === 'launch-form' && (
            <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6 mt-6">
              <h2 className="text-xl font-semibold mb-6">Launch a Radio</h2>

              <form onSubmit={handleLaunchSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="launch-name"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    Name *
                  </label>
                  <input
                    type="text"
                    id="launch-name"
                    name="name"
                    value={launchFormData.name}
                    onChange={handleLaunchInputChange}
                    placeholder="Your name"
                    className="w-full px-4 py-3 bg-black border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors"
                  />
                </div>

                <div>
                  <label
                    htmlFor="launch-email"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    Email *
                  </label>
                  <input
                    type="email"
                    id="launch-email"
                    name="email"
                    value={launchFormData.email}
                    onChange={handleLaunchInputChange}
                    placeholder="you@example.com"
                    className="w-full px-4 py-3 bg-black border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors"
                  />
                </div>

                <div>
                  <label
                    htmlFor="launch-url"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    URL (optional)
                  </label>
                  <input
                    type="text"
                    id="launch-url"
                    name="url"
                    value={launchFormData.url}
                    onChange={handleLaunchInputChange}
                    placeholder="https://yourwebsite.com"
                    className="w-full px-4 py-3 bg-black border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors"
                  />
                </div>

                <div>
                  <label
                    htmlFor="launch-description"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    Description (optional)
                  </label>
                  <textarea
                    id="launch-description"
                    name="description"
                    value={launchFormData.description}
                    onChange={handleLaunchInputChange}
                    rows={4}
                    placeholder="Tell us about the radio you want to launch..."
                    className="w-full px-4 py-3 bg-black border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors resize-none"
                  />
                </div>

                {errorMessage && (
                  <div className="p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-400 text-sm">
                    {errorMessage}
                  </div>
                )}

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
                    'Submit'
                  )}
                </button>

              </form>
            </div>
          )}

          {viewState === 'feature-form' && (
            <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6 mt-6">
              <h2 className="text-xl font-semibold mb-6">Feature Your Station</h2>

              <form onSubmit={handleFeatureSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="feature-name"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    Name *
                  </label>
                  <input
                    type="text"
                    id="feature-name"
                    name="name"
                    value={featureFormData.name}
                    onChange={handleFeatureInputChange}
                    placeholder="Your name"
                    className="w-full px-4 py-3 bg-black border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors"
                  />
                </div>

                <div>
                  <label
                    htmlFor="feature-email"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    Email *
                  </label>
                  <input
                    type="email"
                    id="feature-email"
                    name="email"
                    value={featureFormData.email}
                    onChange={handleFeatureInputChange}
                    placeholder="you@example.com"
                    className="w-full px-4 py-3 bg-black border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors"
                  />
                </div>

                <div>
                  <label
                    htmlFor="feature-radioUrl"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    Radio Website URL *
                  </label>
                  <input
                    type="url"
                    id="feature-radioUrl"
                    name="radioUrl"
                    value={featureFormData.radioUrl}
                    onChange={handleFeatureInputChange}
                    placeholder="https://yourradio.com"
                    className="w-full px-4 py-3 bg-black border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    Do you play content 24/7? *
                  </label>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setFeatureFormData((prev) => ({ ...prev, plays24_7: true }))}
                      className={`flex-1 py-3 px-4 rounded-xl border transition-colors ${
                        featureFormData.plays24_7 === true
                          ? 'bg-white text-black border-white'
                          : 'bg-black text-gray-300 border-gray-800 hover:border-gray-600'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeatureFormData((prev) => ({ ...prev, plays24_7: false }))}
                      className={`flex-1 py-3 px-4 rounded-xl border transition-colors ${
                        featureFormData.plays24_7 === false
                          ? 'bg-white text-black border-white'
                          : 'bg-black text-gray-300 border-gray-800 hover:border-gray-600'
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="feature-message"
                    className="block text-sm font-medium text-gray-300 mb-2"
                  >
                    Message (optional)
                  </label>
                  <textarea
                    id="feature-message"
                    name="message"
                    value={featureFormData.message}
                    onChange={handleFeatureInputChange}
                    rows={4}
                    placeholder="Tell us about your station..."
                    className="w-full px-4 py-3 bg-black border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 transition-colors resize-none"
                  />
                </div>

                {errorMessage && (
                  <div className="p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-400 text-sm">
                    {errorMessage}
                  </div>
                )}

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
                    'Submit'
                  )}
                </button>

              </form>
            </div>
          )}
        </div>

        {/* Features Section - 3 columns */}
        <div className="max-w-6xl mx-auto py-12 border-t border-gray-800">
          <div className="flex flex-col md:flex-row md:divide-x divide-gray-800">
            {/* Independent */}
            <div className="flex-1 py-8 md:py-0 md:px-8 first:md:pl-0 last:md:pr-0 border-b md:border-b-0 border-gray-800 last:border-b-0 flex flex-col items-center">
              <h2 className="text-xl md:text-2xl font-semibold text-white mb-4 text-center">
                Independent
              </h2>
              <p className="text-gray-400 leading-relaxed text-center text-sm mb-6">
                Launch and run your own radio, on your own terms. Each radio on Channel has a dedicated page across web and mobile, with its schedule, shows, and identity clearly presented — and customizable to reflect your crew.
              </p>
              <div className="flex w-full justify-center items-center gap-3 h-40">
                <img
                  src="/radio-portal/independent.png"
                  alt="Channel mobile app showing radio schedule"
                  className="w-20 rounded-lg shadow-lg"
                />
                <img
                  src="/radio-portal/independent2.png"
                  alt="Radio station page"
                  className="w-40 rounded-lg shadow-lg"
                />
              </div>
            </div>

            {/* Seamless */}
            <div className="flex-1 py-8 md:py-0 md:px-8 first:md:pl-0 last:md:pr-0 border-b md:border-b-0 border-gray-800 last:border-b-0 flex flex-col items-center">
              <h2 className="text-xl md:text-2xl font-semibold text-white mb-4 text-center">
                Seamless
              </h2>
              <p className="text-gray-400 leading-relaxed text-center text-sm mb-6">
                Schedule and broadcast live shows from anywhere — a venue, a studio, or a home setup — and deliver a premium experience for listeners on web and mobile. Channel features ensure every show feels live, shared, and present.
              </p>
              <div className="flex w-full justify-center items-end gap-3 h-40">
                <img
                  src="/radio-portal/seamless.png"
                  alt="Livestream setup options"
                  className="w-32 rounded-lg shadow-lg self-start"
                />
                <img
                  src="/radio-portal/seamless2.png"
                  alt="Create a show form"
                  className="w-28 rounded-lg shadow-lg self-end"
                />
              </div>
            </div>

            {/* Sustainable */}
            <div className="flex-1 py-8 md:py-0 md:px-8 first:md:pl-0 last:md:pr-0 border-b md:border-b-0 border-gray-800 last:border-b-0 flex flex-col items-center">
              <h2 className="text-xl md:text-2xl font-semibold text-white mb-4 text-center">
                Sustainable
              </h2>
              <p className="text-gray-400 leading-relaxed text-center text-sm mb-6">
                Enable direct support through tipping, exclusive content, and sales. Support flows from listeners to the people behind the radio — DJs, producers, and hosts — without ads and without intermediaries.
              </p>
              <div className="flex justify-center h-40 items-center">
                <img
                  src="/radio-portal/sustainable2.png"
                  alt="Tips, merch, and Bandcamp sales"
                  className="h-full w-auto rounded-lg shadow-lg"
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
