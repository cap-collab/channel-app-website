'use client';

import { Checklist } from './Checklist';

type StreamingPath = 'computer' | 'dj_gear';

interface SetupGuideProps {
  streamingPath: StreamingPath;
  onStartOver: () => void;
}

// Consistent image styling for smaller screenshots
const imgClass = "mt-3 rounded-lg border border-gray-700 max-w-xs";

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
    <div className="space-y-6">
      {/* Step 1: Connect your gear */}
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Step 1 — Connect your mixer/controller, or audio interface to your computer with USB
        </h3>
        <p className="text-gray-400">
          Use a USB - USB cable to connect your gear to your computer.
        </p>
      </div>

      {/* Step 2: Open broadcast link */}
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Step 2 — Open your private broadcast link
        </h3>
        <p className="text-gray-400">
          Open the broadcast link you received by email in Chrome.
        </p>
      </div>

      {/* Step 3: Set macOS system input and output */}
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Step 3 — Set macOS system input and output
        </h3>

        <ol className="text-gray-400 space-y-4 list-decimal list-inside">
          <li>
            Click the <span className="text-white">sound icon</span> in your menu bar → <span className="text-white">Sound Settings</span>
            <img
              src="/streaming-guide/sound-menu-bar.png"
              alt="Click sound icon in menu bar"
              className={imgClass}
            />
          </li>
          <li>
            Under <span className="text-white">Input</span>, select your mixer/controller or audio interface — <span className="text-white">verify audio levels move</span>
            <img
              src="/streaming-guide/sound-settings-input.png"
              alt="Select your device under Input"
              className={imgClass}
            />
          </li>
          <li>
            Under <span className="text-white">Output</span>, select your mixer/controller or audio interface
            <img
              src="/streaming-guide/sound-settings-output.png"
              alt="Select your device under Output"
              className={imgClass}
            />
          </li>
        </ol>

        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-800/50 rounded-lg">
          <p className="text-yellow-200 text-sm">
            <span className="font-semibold">Warning:</span> If this is set to &quot;Built-in Microphone&quot;, Channel will only hear your laptop mic.
          </p>
        </div>
      </div>

      {/* Step 4: Select streaming method */}
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Step 4 — Select &quot;Stream from your gear&quot;
        </h3>
        <p className="text-gray-400 mb-3">
          Choose your mixer/controller or audio interface from the dropdown.
        </p>
        <img
          src="/streaming-guide/stream-from-gear.png"
          alt="Select your audio device from the dropdown"
          className="rounded-lg border border-gray-700 max-w-sm"
        />
      </div>

      {/* Step 5: Set Chrome audio input */}
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Step 5 — Set Chrome audio input
        </h3>

        <ol className="text-gray-400 space-y-4 list-decimal list-inside">
          <li>
            In the address bar, click the <span className="text-white">microphone icon</span> (left of the URL)
            <img
              src="/streaming-guide/chrome-site-info.png"
              alt="Click microphone icon in address bar"
              className={imgClass}
            />
          </li>
          <li>
            Click <span className="text-white">Site settings</span> and allow channel-app.com to capture your audio
            <img
              src="/streaming-guide/chrome-site-settings.png"
              alt="Chrome site settings for channel-app.com"
              className={imgClass}
            />
            <p className="text-gray-500 text-xs mt-2">
              Or copy-paste{' '}
              <code className="text-white bg-gray-800 px-1.5 py-0.5 rounded text-xs">
                chrome://settings/content/siteDetails?site=https%3A%2F%2Fchannel-app.com
              </code>
              {' '}and verify microphone is allowed
            </p>
          </li>
          <li>
            Click <span className="text-white">Microphone</span> and select your <span className="text-white">mixer/controller or audio interface</span> from the list
            <img
              src="/streaming-guide/chrome-mic-selector.png"
              alt="Select your audio device"
              className={imgClass}
            />
          </li>
        </ol>

        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-800/50 rounded-lg">
          <p className="text-yellow-200 text-sm">
            <span className="font-semibold">Warning:</span> If this is set to &quot;Built-in Microphone&quot;, Channel will only hear your laptop mic.
          </p>
        </div>
      </div>

      {/* Step 6: Verify levels */}
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Step 6 — Verify levels move on your Go Live Channel page
        </h3>
        <p className="text-gray-400 mb-3">
          Once you see audio levels moving on your Channel page, you&apos;re ready to go live!
        </p>
        <img
          src="/streaming-guide/go-live-ready.png"
          alt="Audio levels moving on Go Live page"
          className="rounded-lg border border-gray-700 max-w-md"
        />
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
          Step 1 — Enable Chrome to capture system audio (one-time)
        </h3>

        <p className="text-gray-400 mb-4">On macOS:</p>

        <ol className="text-gray-400 space-y-2 list-decimal list-inside">
          <li>Open <span className="text-white">System Settings</span></li>
          <li>Go to <span className="text-white">Privacy &amp; Security</span></li>
          <li>Open <span className="text-white">Screen &amp; System Audio Recording</span></li>
          <li>Enable access for <span className="text-white">Google Chrome</span> (audio only)</li>
          <li>Restart Chrome if prompted</li>
        </ol>

        <img
          src="/streaming-guide/system-audio-permission.png"
          alt="System Settings - Screen & System Audio Recording permission for Chrome"
          className={imgClass}
        />
      </div>

      {/* Step 2: Open broadcast link */}
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Step 2 — Open your private broadcast link
        </h3>
        <p className="text-gray-400">
          Open the broadcast link you received in Chrome.
        </p>
      </div>

      {/* Step 3: Select streaming method */}
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Step 3 — Select &quot;Stream from your computer&quot;
        </h3>
        <p className="text-gray-400">
          Click &quot;Start Capture&quot; — a screen share dialog will appear.
        </p>
      </div>

      {/* Step 4: Choose what to share */}
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Step 4 — Choose what to share
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
              (iTunes, Apple Music, Spotify, Serato, Rekordbox)
            </p>
            <ul className="text-gray-400 space-y-1 list-disc list-inside">
              <li>Select <span className="text-white">System Audio</span></li>
              <li>Toggle <span className="text-white">&quot;Also share system audio&quot;</span></li>
            </ul>
          </div>
        </div>
      </div>

      {/* Step 5: Set Chrome audio input */}
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Step 5 — Set Chrome audio input
        </h3>

        <ol className="text-gray-400 space-y-4 list-decimal list-inside">
          <li>
            In the address bar, click the <span className="text-white">settings icon</span> (left of the URL), then click <span className="text-white">Site settings</span>
            <img
              src="/streaming-guide/chrome-settings-icon.png"
              alt="Click settings icon in address bar"
              className={imgClass}
            />
          </li>
          <li>
            Allow Chrome and channel-app.com to capture your audio
            <img
              src="/streaming-guide/chrome-site-settings.png"
              alt="Chrome site settings for channel-app.com"
              className={imgClass}
            />
            <p className="text-gray-500 text-xs mt-2">
              Or copy-paste{' '}
              <code className="text-white bg-gray-800 px-1.5 py-0.5 rounded text-xs">
                chrome://settings/content/siteDetails?site=https%3A%2F%2Fchannel-app.com
              </code>
              {' '}and verify microphone is allowed
            </p>
          </li>
        </ol>
      </div>

      {/* Step 6: Verify levels */}
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">
          Step 6 — Verify levels move on your Go Live Channel page
        </h3>
        <p className="text-gray-400 mb-3">
          Once you see audio levels moving on your Channel page, you&apos;re ready to go live!
        </p>
        <img
          src="/streaming-guide/go-live-ready.png"
          alt="Audio levels moving on Go Live page"
          className="rounded-lg border border-gray-700 max-w-md"
        />
      </div>
    </div>
  );
}
