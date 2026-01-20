'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { QuestionCard } from './components/QuestionCard';
import { InfoCard } from './components/InfoCard';
import { SetupGuide } from './components/SetupGuide';
import { AllGuides } from './components/AllGuides';

type QuestionnaireState =
  | 'q1_has_gear'
  | 'result_no_gear'
  | 'q2_has_usb'
  | 'result_usb_ready'
  | 'result_needs_interface'
  | 'guide';

type StreamingPath = 'computer' | 'dj_gear';
type ViewMode = 'questionnaire' | 'all-guides';

// URL parameter values for direct linking
type SetupParam = 'computer' | 'dj-gear' | 'need-interface';

interface StreamingGuideState {
  questionnaireState: QuestionnaireState;
  streamingPath: StreamingPath | null;
}

function getInitialStateFromParam(setup: SetupParam | null): { state: StreamingGuideState; viewMode: ViewMode } {
  switch (setup) {
    case 'computer':
      return {
        state: { questionnaireState: 'guide', streamingPath: 'computer' },
        viewMode: 'questionnaire',
      };
    case 'dj-gear':
      return {
        state: { questionnaireState: 'guide', streamingPath: 'dj_gear' },
        viewMode: 'questionnaire',
      };
    case 'need-interface':
      return {
        state: { questionnaireState: 'result_needs_interface', streamingPath: 'dj_gear' },
        viewMode: 'questionnaire',
      };
    default:
      return {
        state: { questionnaireState: 'q1_has_gear', streamingPath: null },
        viewMode: 'questionnaire',
      };
  }
}

export function StreamingGuideClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const setupParam = searchParams.get('setup') as SetupParam | null;

  const [viewMode, setViewMode] = useState<ViewMode>('questionnaire');
  const [state, setState] = useState<StreamingGuideState>({
    questionnaireState: 'q1_has_gear',
    streamingPath: null,
  });
  const [initialized, setInitialized] = useState(false);

  // Initialize state from URL params on mount
  useEffect(() => {
    if (!initialized) {
      const initial = getInitialStateFromParam(setupParam);
      setState(initial.state);
      setViewMode(initial.viewMode);
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

  const handleQ1Answer = (hasGear: boolean) => {
    if (hasGear) {
      setState({ questionnaireState: 'q2_has_usb', streamingPath: null });
    } else {
      setState({ questionnaireState: 'result_no_gear', streamingPath: 'computer' });
    }
  };

  const handleQ2Answer = (hasUsb: boolean) => {
    if (hasUsb) {
      setState({ questionnaireState: 'result_usb_ready', streamingPath: 'dj_gear' });
    } else {
      setState({ questionnaireState: 'result_needs_interface', streamingPath: 'dj_gear' });
      updateUrl('need-interface');
    }
  };

  const handleContinueToGuide = () => {
    setState((prev) => {
      const setup: SetupParam = prev.streamingPath === 'computer' ? 'computer' : 'dj-gear';
      updateUrl(setup);
      return { ...prev, questionnaireState: 'guide' };
    });
  };

  const handleStartOver = () => {
    setState({ questionnaireState: 'q1_has_gear', streamingPath: null });
    updateUrl(null);
  };

  const isInQuestionnaire = state.questionnaireState !== 'guide';

  return (
    <div className="min-h-screen bg-black">
      <Header currentPage="streaming-guide" position="sticky" />

      <main className="p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-4">Streaming Setup Guide</h1>
            <p className="text-gray-400 leading-relaxed">
              Can I live stream on Channel? Short answer: yes — but your computer needs to receive audio.
            </p>
          </div>

          {/* Tab Switcher */}
          <div className="flex gap-2 mb-8">
            <button
              onClick={() => {
                setViewMode('questionnaire');
                handleStartOver();
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'questionnaire'
                  ? 'bg-white text-black'
                  : 'bg-[#1a1a1a] text-gray-400 hover:text-white border border-gray-800'
              }`}
            >
              Help me figure it out
            </button>
            <button
              onClick={() => setViewMode('all-guides')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'all-guides'
                  ? 'bg-white text-black'
                  : 'bg-[#1a1a1a] text-gray-400 hover:text-white border border-gray-800'
              }`}
            >
              Show all guides
            </button>
          </div>

          {/* Questionnaire View */}
          {viewMode === 'questionnaire' && (
            <>
              {/* Part 1: Questionnaire */}
              {isInQuestionnaire && (
                <div className="space-y-6">
                  {/* Q1: Do you have DJ gear? */}
                  <QuestionCard
                    question="Do you have DJ gear (mixer or controller)?"
                    isVisible={state.questionnaireState === 'q1_has_gear'}
                    onYes={() => handleQ1Answer(true)}
                    onNo={() => handleQ1Answer(false)}
                  />

                  {/* Result: No gear */}
                  <InfoCard
                    type="info"
                    title="You can still live stream"
                    message="You'll stream directly from your computer."
                    isVisible={state.questionnaireState === 'result_no_gear'}
                    actionLabel="Continue to setup"
                    onAction={handleContinueToGuide}
                  />

                  {/* Q2: Does it have USB? */}
                  <QuestionCard
                    question="Can your gear send audio to your computer via USB?"
                    description="Either your mixer/controller has a USB output, or you have an audio interface connected to your mixer."
                    isVisible={state.questionnaireState === 'q2_has_usb'}
                    onYes={() => handleQ2Answer(true)}
                    onNo={() => handleQ2Answer(false)}
                  />

                  {/* Result: Has USB - ready */}
                  <InfoCard
                    type="success"
                    title="Great. Your gear can send audio directly to your computer."
                    message="You're ready."
                    isVisible={state.questionnaireState === 'result_usb_ready'}
                    actionLabel="Continue to setup"
                    onAction={handleContinueToGuide}
                  />

                  {/* Result: No USB - needs interface */}
                  <InfoCard
                    type="warning"
                    title="You must buy an audio interface"
                    message="There is no workaround."
                    isVisible={state.questionnaireState === 'result_needs_interface'}
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

              {/* Part 2: Setup Guide */}
              {state.questionnaireState === 'guide' && state.streamingPath && (
                <SetupGuide
                  streamingPath={state.streamingPath}
                  onStartOver={handleStartOver}
                />
              )}
            </>
          )}

          {/* All Guides View */}
          {viewMode === 'all-guides' && <AllGuides />}
        </div>
      </main>
    </div>
  );
}
