'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { InfoCard } from './components/InfoCard';
import { SetupGuide } from './components/SetupGuide';

type StreamingPath = 'computer' | 'dj_gear';
type View = 'picker' | 'need-interface' | 'guide';

// URL parameter values for direct linking
type SetupParam = 'computer' | 'dj-gear' | 'need-interface';

function getInitialView(setup: SetupParam | null): { view: View; streamingPath: StreamingPath | null } {
  switch (setup) {
    case 'computer':
      return { view: 'guide', streamingPath: 'computer' };
    case 'dj-gear':
      return { view: 'guide', streamingPath: 'dj_gear' };
    case 'need-interface':
      return { view: 'need-interface', streamingPath: 'dj_gear' };
    default:
      return { view: 'picker', streamingPath: null };
  }
}

export function StreamingGuideClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const setupParam = searchParams.get('setup') as SetupParam | null;

  const [view, setView] = useState<View>('picker');
  const [streamingPath, setStreamingPath] = useState<StreamingPath | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Initialize state from URL params on mount
  useEffect(() => {
    if (!initialized) {
      const initial = getInitialView(setupParam);
      setView(initial.view);
      setStreamingPath(initial.streamingPath);
      setInitialized(true);
    }
  }, [setupParam, initialized]);

  const updateUrl = (setup: SetupParam | null) => {
    const url = new URL(window.location.href);
    if (setup) {
      url.searchParams.set('setup', setup);
    } else {
      url.searchParams.delete('setup');
    }
    router.replace(url.pathname + url.search, { scroll: false });
  };

  const handlePickOption = (option: 'dj-gear' | 'need-interface' | 'computer') => {
    updateUrl(option);
    if (option === 'need-interface') {
      setView('need-interface');
      setStreamingPath('dj_gear');
    } else {
      setView('guide');
      setStreamingPath(option === 'dj-gear' ? 'dj_gear' : 'computer');
    }
  };

  const handleContinueToGuide = () => {
    updateUrl('dj-gear');
    setView('guide');
  };

  const handleBack = () => {
    updateUrl(null);
    setView('picker');
    setStreamingPath(null);
  };

  // For direct links, show path-specific title
  const isDirectLink = setupParam === 'dj-gear' || setupParam === 'computer';
  const getTitle = () => {
    if (view === 'guide' && streamingPath === 'dj_gear') return 'DJ Gear Setup';
    if (view === 'guide' && streamingPath === 'computer') return 'Computer Streaming Setup';
    if (view === 'need-interface') return 'Audio Interface Required';
    return 'Streaming Setup Guide';
  };

  return (
    <div className="min-h-screen bg-black">
      <Header currentPage="streaming-guide" position="sticky" />

      <main className="p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
          {/* Back link at top for non-picker views */}
          {view !== 'picker' && (
            <button
              onClick={handleBack}
              className="text-gray-500 hover:text-gray-300 text-sm transition-colors mb-4"
            >
              ← Back to streaming guide menu
            </button>
          )}

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold">{getTitle()}</h1>
          </div>

          {/* Picker View */}
          {view === 'picker' && (
            <div className="space-y-6 animate-fadeIn">
              <p className="text-gray-400">How do you want to stream?</p>

              <div className="space-y-3">
                {/* Option 1: DJ Gear with USB */}
                <button
                  onClick={() => handlePickOption('dj-gear')}
                  className="w-full text-left p-4 bg-[#1a1a1a] border border-gray-800 rounded-xl hover:border-gray-600 transition-colors"
                >
                  <p className="text-white font-medium">DJ Gear with USB</p>
                  <p className="text-gray-400 text-sm mt-1">
                    Your mixer, controller, or audio interface connects via USB
                  </p>
                </button>

                {/* Option 2: Audio Gear (no USB) */}
                <button
                  onClick={() => handlePickOption('need-interface')}
                  className="w-full text-left p-4 bg-[#1a1a1a] border border-gray-800 rounded-xl hover:border-gray-600 transition-colors"
                >
                  <p className="text-white font-medium">Audio Gear (no USB)</p>
                  <p className="text-gray-400 text-sm mt-1">
                    You need an audio interface to connect your gear
                  </p>
                </button>

                {/* Option 3: Computer Audio */}
                <button
                  onClick={() => handlePickOption('computer')}
                  className="w-full text-left p-4 bg-[#1a1a1a] border border-gray-800 rounded-xl hover:border-gray-600 transition-colors"
                >
                  <p className="text-white font-medium">Computer Audio</p>
                  <p className="text-gray-400 text-sm mt-1">
                    Stream from Spotify, browser, or other apps
                  </p>
                </button>
              </div>

              {/* Support contact */}
              <div className="pt-6 border-t border-gray-800">
                <p className="text-gray-500 text-sm">
                  Not sure? Contact{' '}
                  <a
                    href="mailto:support@channel-app.com"
                    className="text-white underline hover:text-gray-300"
                  >
                    support@channel-app.com
                  </a>
                </p>
                <p className="text-gray-500 text-sm mt-1">
                  Let us know what you have — maybe send a picture of what can come out of your equipment.
                </p>
              </div>
            </div>
          )}

          {/* Need Interface View */}
          {view === 'need-interface' && (
            <div className="animate-fadeIn">
              <InfoCard
                type="warning"
                title="You need an audio interface"
                message="There is no workaround."
                isVisible={true}
                actionLabel="Continue to setup"
                onAction={handleContinueToGuide}
              >
                <div className="mt-6 space-y-6">
                  <h4 className="text-white font-medium">What to buy</h4>

                  <div className="space-y-4">
                    <div>
                      <p className="text-gray-300 font-medium">1. Audio interface</p>
                      <p className="text-gray-400 text-sm mt-1">
                        <a
                          href="https://www.amazon.com/dp/B087QL8SLN"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-white underline hover:text-gray-300"
                        >
                          MOTU M2
                        </a>
                        {' '}— the only reliable option for proper sound I know so far
                      </p>
                    </div>

                    <div>
                      <p className="text-gray-300 font-medium">2. USB-C to USB-C cable</p>
                      <p className="text-gray-400 text-sm mt-1">
                        To connect your audio interface to Mac (MOTU M2 only comes with USB-C to USB-A).
                      </p>
                      <p className="text-gray-400 text-sm mt-1">
                        Must support data transfer, not charging only. Test: plug a phone to your computer — if it recognizes the phone/can read content, the cable works.
                      </p>
                      <p className="text-gray-400 text-sm mt-1">
                        <a
                          href="https://www.amazon.com/dp/B0D44Q73JP"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-white underline hover:text-gray-300"
                        >
                          Recommended cable
                        </a>
                      </p>
                    </div>

                    <div>
                      <p className="text-gray-300 font-medium">3. Cables from your mixer/amp to your audio interface</p>
                      <p className="text-gray-400 text-sm mt-1">Depending on your mixer&apos;s output:</p>
                      <ul className="text-gray-400 text-sm mt-1 list-disc list-inside space-y-1">
                        <li>
                          <a
                            href="https://www.amazon.com/dp/B083R6G1DQ"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white underline hover:text-gray-300"
                          >
                            Dual 1/4 inch TS to Dual RCA Cable
                          </a>
                        </li>
                        <li>
                          <a
                            href="https://www.amazon.com/dp/B08TTFRS1R"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white underline hover:text-gray-300"
                          >
                            1/4 Inch Male Jack to Dual 1/4 inch Male TS
                          </a>
                        </li>
                      </ul>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-700">
                    <p className="text-gray-300 font-medium">How it connects</p>
                    <p className="text-gray-400 text-sm mt-2 font-mono">
                      Mixer OUT → Audio Interface IN → USB-C → Computer
                    </p>
                    <p className="text-gray-500 text-sm mt-2">
                      Once this is done, your computer can receive your live mix.
                    </p>
                  </div>
                </div>
              </InfoCard>

            </div>
          )}

          {/* Guide View */}
          {view === 'guide' && streamingPath && (
            <SetupGuide
              streamingPath={streamingPath}
              onStartOver={handleBack}
              showHeader={!isDirectLink}
            />
          )}
        </div>
      </main>
    </div>
  );
}
