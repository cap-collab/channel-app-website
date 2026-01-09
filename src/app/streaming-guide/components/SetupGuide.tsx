'use client';

import { Checklist } from './Checklist';

type StreamingPath = 'computer' | 'dj_gear';

interface SetupGuideProps {
  streamingPath: StreamingPath;
  onStartOver: () => void;
}

export function SetupGuide({ streamingPath, onStartOver }: SetupGuideProps) {
  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold mb-2">Setup Instructions</h2>
        <p className="text-gray-400">
          Channel runs directly in your browser. No streaming software required.
        </p>
      </div>

      {/* Path-specific instructions */}
      {streamingPath === 'dj_gear' ? <DJGearGuide /> : <ComputerGuide />}

      {/* Final Checklist */}
      <Checklist streamingPath={streamingPath} />

      {/* Start over link */}
      <div className="pt-4 border-t border-gray-800">
        <button
          onClick={onStartOver}
          className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
        >
          ← Start over
        </button>
      </div>
    </div>
  );
}

function DJGearGuide() {
  return (
    <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-white mb-4">
        Streaming from DJ gear (mixer / controller / audio interface)
      </h3>

      <div className="space-y-4">
        <p className="text-gray-300 font-medium">
          Select your audio input in Chrome (required)
        </p>

        <ol className="text-gray-400 space-y-3 list-decimal list-inside">
          <li>Open your private broadcast link in Chrome</li>
          <li>In the address bar, click the audio / microphone icon (left of the URL)</li>
          <li>
            Set <span className="text-white">Audio input</span> to: your mixer, your controller, or your audio interface
          </li>
        </ol>

        <div className="mt-6 p-4 bg-yellow-900/20 border border-yellow-800/50 rounded-lg">
          <p className="text-yellow-200 text-sm">
            <span className="font-semibold">Warning:</span> If this is set to &quot;Built-in Microphone&quot;, Channel will only hear your laptop mic.
          </p>
        </div>
      </div>
    </div>
  );
}

function ComputerGuide() {
  return (
    <div className="space-y-6">
      {/* Step 1: Enable system audio */}
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Step 1 — Enable system audio access (one-time)
        </h3>

        <p className="text-gray-400 mb-4">On macOS:</p>

        <ol className="text-gray-400 space-y-2 list-decimal list-inside">
          <li>Open <span className="text-white">System Settings</span></li>
          <li>Go to <span className="text-white">Privacy &amp; Security</span></li>
          <li>Open <span className="text-white">Screen &amp; System Audio Recording</span></li>
          <li>Enable access for <span className="text-white">Google Chrome</span></li>
          <li>Restart Chrome if prompted</li>
        </ol>
      </div>

      {/* Step 2: Choose how to share */}
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Step 2 — Choose how you share audio
        </h3>

        <div className="space-y-6">
          {/* Browser tab option */}
          <div>
            <p className="text-gray-300 font-medium mb-2">
              If you play audio from a browser tab
            </p>
            <p className="text-gray-500 text-sm mb-3">
              (SoundCloud, Mixcloud, Bandcamp)
            </p>
            <ul className="text-gray-400 space-y-1 list-disc list-inside">
              <li>Select the browser tab</li>
              <li>Toggle <span className="text-white">&quot;Also share tab audio&quot;</span></li>
            </ul>
          </div>

          <div className="border-t border-gray-700" />

          {/* Application option */}
          <div>
            <p className="text-gray-300 font-medium mb-2">
              If you play audio from an application
            </p>
            <p className="text-gray-500 text-sm mb-3">
              (iTunes / Apple Music / desktop player)
            </p>
            <ul className="text-gray-400 space-y-1 list-disc list-inside">
              <li>Select <span className="text-white">System Audio</span></li>
              <li>Toggle <span className="text-white">&quot;Also share system audio&quot;</span></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
