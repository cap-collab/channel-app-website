'use client';

import { Checklist } from './Checklist';

type StreamingPath = 'computer' | 'dj_gear';

interface SetupGuideProps {
  streamingPath: StreamingPath;
  onStartOver: () => void;
  showHeader?: boolean;
}

// Consistent image styling
const imgClass = "mt-3 rounded-lg border border-gray-700 max-w-xs";

export function SetupGuide({ streamingPath, onStartOver, showHeader = true }: SetupGuideProps) {
  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header - only shown when not coming from direct link */}
      {showHeader && (
        <div>
          <h2 className="text-2xl font-bold mb-2">Setup Instructions</h2>
          <p className="text-gray-400">
            Channel runs directly in your browser. No streaming software required.
          </p>
        </div>
      )}

      {/* Path-specific instructions */}
      {streamingPath === 'dj_gear' ? <DJGearGuide /> : <ComputerGuide />}

      {/* Final Checklist */}
      <Checklist streamingPath={streamingPath} />

      {/* Back link */}
      <div className="pt-4 border-t border-gray-800">
        <button
          onClick={onStartOver}
          className="text-gray-500 hover:text-gray-300 text-sm transition-colors"
        >
          ← Back to streaming guide
        </button>
      </div>
    </div>
  );
}

function DJGearGuide() {
  return (
    <div className="space-y-6">
      {/* Step 1 */}
      <div className="pb-6 border-b border-gray-800">
        <h3 className="text-white font-medium mb-2">1. Connect your gear via USB</h3>
        <p className="text-gray-400 text-sm">
          Use a USB cable to connect your mixer/controller or audio interface to your computer.
        </p>
      </div>

      {/* Step 2 */}
      <div className="pb-6 border-b border-gray-800">
        <h3 className="text-white font-medium mb-2">2. Open your broadcast link</h3>
        <p className="text-gray-400 text-sm">
          Open the broadcast link you received by email in Chrome.
        </p>
      </div>

      {/* Step 3 */}
      <div className="pb-6 border-b border-gray-800">
        <h3 className="text-white font-medium mb-2">3. Set macOS system input and output</h3>
        <ol className="text-gray-400 text-sm space-y-3 list-decimal list-inside mt-3">
          <li>
            Click the <span className="text-white">sound icon</span> in menu bar → <span className="text-white">Sound Settings</span>
            <img src="/streaming-guide/sound-menu-bar.png" alt="Sound menu bar" className={imgClass} />
          </li>
          <li>
            Under <span className="text-white">Input</span>, select your device — verify levels move
            <img src="/streaming-guide/sound-settings-input.png" alt="Sound input settings" className={imgClass} />
          </li>
          <li>
            Under <span className="text-white">Output</span>, select your device
            <img src="/streaming-guide/sound-settings-output.png" alt="Sound output settings" className={imgClass} />
          </li>
        </ol>
        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-800/50 rounded-lg">
          <p className="text-yellow-200 text-sm">
            <span className="font-semibold">Warning:</span> If set to &quot;Built-in Microphone&quot;, Channel will only hear your laptop mic.
          </p>
        </div>
      </div>

      {/* Step 4 */}
      <div className="pb-6 border-b border-gray-800">
        <h3 className="text-white font-medium mb-2">4. Select &quot;Stream from your gear&quot;</h3>
        <p className="text-gray-400 text-sm">
          Choose your mixer/controller or audio interface from the dropdown.
        </p>
        <img src="/streaming-guide/stream-from-gear.png" alt="Stream from gear dropdown" className="mt-3 rounded-lg border border-gray-700 max-w-sm" />
      </div>

      {/* Step 5 */}
      <div className="pb-6 border-b border-gray-800">
        <h3 className="text-white font-medium mb-2">5. Set Chrome audio input</h3>
        <ol className="text-gray-400 text-sm space-y-3 list-decimal list-inside mt-3">
          <li>
            Click the <span className="text-white">microphone icon</span> in the address bar
            <img src="/streaming-guide/chrome-site-info.png" alt="Chrome microphone icon" className={imgClass} />
          </li>
          <li>
            Click <span className="text-white">Site settings</span> and allow audio capture
            <img src="/streaming-guide/chrome-site-settings.png" alt="Chrome site settings" className={imgClass} />
          </li>
          <li>
            Select your <span className="text-white">mixer/controller or audio interface</span>
            <img src="/streaming-guide/chrome-mic-selector.png" alt="Chrome mic selector" className={imgClass} />
          </li>
        </ol>
        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-800/50 rounded-lg">
          <p className="text-yellow-200 text-sm">
            <span className="font-semibold">Warning:</span> If set to &quot;Built-in Microphone&quot;, Channel will only hear your laptop mic.
          </p>
        </div>
      </div>

      {/* Step 6 */}
      <div>
        <h3 className="text-white font-medium mb-2">6. Verify audio levels</h3>
        <p className="text-gray-400 text-sm">
          Once you see audio levels moving on your Channel page, you&apos;re ready to go live!
        </p>
        <img src="/streaming-guide/go-live-ready.png" alt="Audio levels ready" className="mt-3 rounded-lg border border-gray-700 max-w-md" />
      </div>
    </div>
  );
}

function ComputerGuide() {
  return (
    <div className="space-y-6">
      {/* Step 1 */}
      <div className="pb-6 border-b border-gray-800">
        <h3 className="text-white font-medium mb-2">1. Enable Chrome to capture system audio</h3>
        <p className="text-gray-400 text-sm mb-3">On macOS (one-time setup):</p>
        <ol className="text-gray-400 text-sm space-y-1 list-decimal list-inside">
          <li>Open <span className="text-white">System Settings</span></li>
          <li>Go to <span className="text-white">Privacy &amp; Security</span></li>
          <li>Open <span className="text-white">Screen &amp; System Audio Recording</span></li>
          <li>Enable access for <span className="text-white">Google Chrome</span></li>
          <li>Restart Chrome if prompted</li>
        </ol>
        <img src="/streaming-guide/system-audio-permission.png" alt="System audio permission" className={imgClass} />
      </div>

      {/* Step 2 */}
      <div className="pb-6 border-b border-gray-800">
        <h3 className="text-white font-medium mb-2">2. Open your broadcast link</h3>
        <p className="text-gray-400 text-sm">
          Open the broadcast link you received in Chrome.
        </p>
      </div>

      {/* Step 3 */}
      <div className="pb-6 border-b border-gray-800">
        <h3 className="text-white font-medium mb-2">3. Select &quot;Stream from your computer&quot;</h3>
        <p className="text-gray-400 text-sm">
          Click &quot;Start Capture&quot; — a screen share dialog will appear.
        </p>
      </div>

      {/* Step 4 */}
      <div className="pb-6 border-b border-gray-800">
        <h3 className="text-white font-medium mb-2">4. Choose what to share</h3>
        <div className="space-y-4 mt-3">
          <div>
            <p className="text-gray-300 text-sm font-medium">From a browser tab (SoundCloud, Mixcloud, Bandcamp)</p>
            <ul className="text-gray-400 text-sm mt-1 list-disc list-inside">
              <li>Select the browser tab</li>
              <li>Toggle <span className="text-white">&quot;Also share tab audio&quot;</span></li>
            </ul>
          </div>
          <div>
            <p className="text-gray-300 text-sm font-medium">From an app (Spotify, Serato, Rekordbox)</p>
            <ul className="text-gray-400 text-sm mt-1 list-disc list-inside">
              <li>Select <span className="text-white">System Audio</span></li>
              <li>Toggle <span className="text-white">&quot;Also share system audio&quot;</span></li>
            </ul>
          </div>
        </div>
      </div>

      {/* Step 5 */}
      <div className="pb-6 border-b border-gray-800">
        <h3 className="text-white font-medium mb-2">5. Set Chrome audio authorization</h3>
        <ol className="text-gray-400 text-sm space-y-3 list-decimal list-inside mt-3">
          <li>
            Click the <span className="text-white">settings icon</span> in the address bar → <span className="text-white">Site settings</span>
            <img src="/streaming-guide/chrome-settings-icon.png" alt="Chrome settings icon" className={imgClass} />
          </li>
          <li>
            Allow Chrome and channel-app.com to capture audio
            <img src="/streaming-guide/chrome-site-settings.png" alt="Chrome site settings" className={imgClass} />
          </li>
        </ol>
      </div>

      {/* Step 6 */}
      <div>
        <h3 className="text-white font-medium mb-2">6. Verify audio levels</h3>
        <p className="text-gray-400 text-sm">
          Once you see audio levels moving on your Channel page, you&apos;re ready to go live!
        </p>
        <img src="/streaming-guide/go-live-ready.png" alt="Audio levels ready" className="mt-3 rounded-lg border border-gray-700 max-w-md" />
      </div>
    </div>
  );
}
