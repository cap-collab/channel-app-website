'use client';

import { useState } from 'react';

export function AllGuides() {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['equipment']));

  const toggleSection = (section: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Section 1: Equipment Check */}
      <AccordionSection
        id="equipment"
        title="1. Check your equipment"
        isOpen={openSections.has('equipment')}
        onToggle={() => toggleSection('equipment')}
      >
        <div className="space-y-6">
          <div>
            <h4 className="text-white font-medium mb-2">No DJ gear?</h4>
            <p className="text-gray-400 text-sm">
              You can still live stream. You&apos;ll stream directly from your computer.
              Skip to &quot;Setup for computer streaming&quot; below.
            </p>
          </div>

          <div>
            <h4 className="text-white font-medium mb-2">Have DJ gear with USB output?</h4>
            <p className="text-gray-400 text-sm">
              Great. Your mixer can send audio directly to your computer. You&apos;re ready.
              Skip to &quot;Setup for DJ gear&quot; below.
            </p>
          </div>

          <div>
            <h4 className="text-white font-medium mb-2">Have DJ gear without USB output?</h4>
            <p className="text-gray-400 text-sm mb-4">
              You must buy an audio interface. There is no workaround.
            </p>

            <div className="bg-[#252525] rounded-lg p-4 space-y-4">
              <p className="text-gray-300 font-medium">What to buy:</p>

              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-gray-300">1. Audio interface</p>
                  <p className="text-gray-400">
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
                  <p className="text-gray-300">2. USB-C to USB-C cable</p>
                  <p className="text-gray-400">
                    To connect your audio interface to Mac (MOTU M2 only comes with USB-C to USB-A).
                    Must support data transfer, not charging only.{' '}
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
                  <p className="text-gray-300">3. Cables from mixer to audio interface</p>
                  <p className="text-gray-400">
                    <a
                      href="https://www.amazon.com/dp/B083R6G1DQ"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white underline hover:text-gray-300"
                    >
                      Dual 1/4 inch TS to Dual RCA Cable
                    </a>
                    {' '}or{' '}
                    <a
                      href="https://www.amazon.com/dp/B08TTFRS1R"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white underline hover:text-gray-300"
                    >
                      1/4 Inch Male Jack to Dual 1/4 inch Male TS
                    </a>
                  </p>
                </div>

                <div className="pt-3 border-t border-gray-700">
                  <p className="text-gray-300">How it connects:</p>
                  <p className="text-gray-400 font-mono">
                    Mixer OUT → Audio Interface IN → USB-C → Computer
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </AccordionSection>

      {/* Section 2: Setup for DJ gear */}
      <AccordionSection
        id="dj-gear"
        title="2. Setup for DJ gear"
        isOpen={openSections.has('dj-gear')}
        onToggle={() => toggleSection('dj-gear')}
      >
        <div className="space-y-6">
          {/* Step 1 */}
          <div>
            <h4 className="text-white font-medium mb-3">Step 1 — Connect your mixer/controller</h4>
            <p className="text-gray-400 text-sm">
              Connect your mixer/controller to your computer via USB or USB-C.
            </p>
          </div>

          {/* Step 2 */}
          <div className="border-t border-gray-700 pt-6">
            <h4 className="text-white font-medium mb-3">Step 2 — Set macOS system input and output</h4>
            <ol className="text-gray-400 text-sm space-y-2 list-decimal list-inside">
              <li>Click the <span className="text-white">sound icon</span> in your menu bar → <span className="text-white">Sound Settings</span></li>
              <li>Under <span className="text-white">Input</span>, select your mixer/controller — verify input levels move</li>
              <li>Under <span className="text-white">Output</span>, select your mixer/controller — verify output levels move</li>
            </ol>
          </div>

          {/* Step 3 */}
          <div className="border-t border-gray-700 pt-6">
            <h4 className="text-white font-medium mb-3">Step 3 — Set Chrome audio input</h4>
            <ol className="text-gray-400 text-sm space-y-2 list-decimal list-inside">
              <li>Open your private broadcast link in Chrome</li>
              <li>In the address bar, click the <span className="text-white">audio/microphone icon</span> (left of the URL)</li>
              <li>Set <span className="text-white">Audio input</span> to your mixer/controller</li>
              <li>Verify levels move on your Go Live Channel page</li>
            </ol>

            <div className="mt-4 p-4 bg-yellow-900/20 border border-yellow-800/50 rounded-lg">
              <p className="text-yellow-200 text-sm">
                <span className="font-semibold">Warning:</span> If this is set to &quot;Built-in Microphone&quot;, Channel will only hear your laptop mic.
              </p>
            </div>
          </div>
        </div>
      </AccordionSection>

      {/* Section 3: Setup for computer streaming */}
      <AccordionSection
        id="computer"
        title="3. Setup for computer streaming (no gear)"
        isOpen={openSections.has('computer')}
        onToggle={() => toggleSection('computer')}
      >
        <div className="space-y-6">
          <div>
            <h4 className="text-white font-medium mb-3">Step 1 — Enable Chrome to capture system audio (one-time)</h4>
            <p className="text-gray-400 mb-3">On macOS:</p>
            <ol className="text-gray-400 space-y-2 list-decimal list-inside">
              <li>Open <span className="text-white">System Settings</span></li>
              <li>Go to <span className="text-white">Privacy &amp; Security</span></li>
              <li>Open <span className="text-white">Screen &amp; System Audio Recording</span></li>
              <li>Enable access for <span className="text-white">Google Chrome</span> (audio only)</li>
              <li>Restart Chrome if prompted</li>
            </ol>
          </div>

          <div className="border-t border-gray-700 pt-6">
            <h4 className="text-white font-medium mb-3">Step 2 — Choose what to share</h4>

            <div className="space-y-4">
              <div>
                <p className="text-gray-300 mb-1">If you play audio from a browser tab</p>
                <p className="text-gray-500 text-sm mb-2">(SoundCloud, Mixcloud, Bandcamp)</p>
                <ul className="text-gray-400 text-sm list-disc list-inside">
                  <li>Select the browser tab</li>
                  <li>Toggle <span className="text-white">&quot;Also share tab audio&quot;</span></li>
                </ul>
              </div>

              <div>
                <p className="text-gray-300 mb-1">If you play audio from an application</p>
                <p className="text-gray-500 text-sm mb-2">(iTunes, Apple Music, Spotify, Serato, Rekordbox)</p>
                <ul className="text-gray-400 text-sm list-disc list-inside">
                  <li>Select <span className="text-white">System Audio</span></li>
                  <li>Toggle <span className="text-white">&quot;Also share system audio&quot;</span></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </AccordionSection>

      {/* Section 4: Final checklist */}
      <AccordionSection
        id="checklist"
        title="4. Final check before going live"
        isOpen={openSections.has('checklist')}
        onToggle={() => toggleSection('checklist')}
      >
        <div className="space-y-6">
          <div>
            <p className="text-gray-400 text-sm mb-3">For DJ gear:</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded border border-gray-600 flex items-center justify-center">
                  <svg className="w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-gray-300">macOS input &amp; output set to mixer/controller (levels moving in Sound Settings)</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded border border-gray-600 flex items-center justify-center">
                  <svg className="w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-gray-300">Chrome audio input set to mixer/controller</span>
              </div>
            </div>
          </div>

          <div>
            <p className="text-gray-400 text-sm mb-3">For computer streaming:</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded border border-gray-600 flex items-center justify-center">
                  <svg className="w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-gray-300">Chrome has Screen &amp; System Audio Recording permission for audio only (one-time setup)</span>
              </div>
            </div>
          </div>

          <div>
            <p className="text-gray-400 text-sm mb-3">For everyone:</p>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 rounded border border-gray-600 flex items-center justify-center">
                  <svg className="w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-gray-300">Audio levels moving on this page — and NOT coming from your microphone</span>
              </div>
            </div>
          </div>

          <div className="mt-4 p-4 bg-green-900/20 border border-green-800/50 rounded-lg">
            <p className="text-green-200 text-sm">
              If Channel shows audio levels that are not coming from your computer microphone, you&apos;re live-ready!
            </p>
          </div>
        </div>
      </AccordionSection>
    </div>
  );
}

interface AccordionSectionProps {
  id: string;
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function AccordionSection({ title, isOpen, onToggle, children }: AccordionSectionProps) {
  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-6 py-5 text-left flex items-center justify-between hover:bg-[#252525]/50 transition-colors"
      >
        <span className="text-white font-medium text-lg pr-4">{title}</span>
        <svg
          className={`w-5 h-5 text-gray-500 flex-shrink-0 transition-transform duration-300 ${
            isOpen ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        className={`grid transition-all duration-300 ease-out ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-6 pb-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
