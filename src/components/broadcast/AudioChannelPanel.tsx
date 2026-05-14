'use client';

import { useState } from 'react';
import { AudioInputMethod, RedChannelChoice } from '@/types/broadcast';
import { analyseStereoContent, ChannelContentClass } from '@/lib/audio-analysis';

interface AudioChannelPanelProps {
  inputMethod: AudioInputMethod | null;
  stream: MediaStream | null;
  choice: RedChannelChoice;
  onChange: (choice: RedChannelChoice) => void;
  testResult: ChannelContentClass | null;
  onTestResult: (result: ChannelContentClass | null) => void;
}

const CARDS: { id: RedChannelChoice; title: string; description: string }[] = [
  {
    id: 'mono',
    title: 'Mono',
    description: 'Safe with any audio source.',
  },
  {
    id: 'stereo',
    title: 'Stereo (True stereo only)',
    description: 'Only use this if your mixer sends separate left and right channels.',
  },
];

export function AudioChannelPanel({
  inputMethod,
  stream,
  choice,
  onChange,
  testResult,
  onTestResult,
}: AudioChannelPanelProps) {
  const [testing, setTesting] = useState(false);

  // The panel is gear-path only. Screen-share / RTMP inputs render nothing —
  // they never use forced stereo RED, so there's nothing for the DJ to set.
  if (inputMethod !== 'device') return null;

  const runTest = async () => {
    if (!stream || testing) return;
    setTesting(true);
    onTestResult(null);
    let result: ChannelContentClass;
    try {
      result = await analyseStereoContent(stream, 3000);
    } catch {
      result = 'ambiguous'; // analyser failed → treat as "unable to verify"
    }
    onTestResult(result);
    setTesting(false);
    // The test NEVER auto-selects Stereo — a 3-second check can't guarantee a
    // genuine L/R signal (level imbalance, mono-through-an-interface, etc. all
    // read as "not mono"). It only switches TOWARD the safe option: every
    // result falls back to Mono. The DJ must deliberately pick Stereo.
    onChange('mono');
  };

  return (
    <div className="bg-[#252525] rounded-xl p-4">
      <h3 className="text-white text-sm font-semibold mb-1">Stream Optimization</h3>
      <p className="text-gray-400 text-xs mb-4">
        We optimize your stream based on how your audio is connected to help prevent
        dropouts and audio glitches.
      </p>

      {/* Audio check — always visible, above the cards. The result persists
          (gated on testResult, not on the selected choice). */}
      <div className="mb-4">
        <p className="text-gray-400 text-xs mb-2">
          Not sure which you are? Run a quick audio check.
        </p>
        <button
          onClick={runTest}
          disabled={!stream || testing}
          className="w-full bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white text-sm py-2 rounded-lg transition-colors"
        >
          {testing ? 'Checking your audio…' : 'Test my audio'}
        </button>
        {testResult === 'mono' && (
          <div className="mt-2 bg-gray-800 border border-gray-700 text-gray-300 text-xs px-3 py-2 rounded-lg">
            <p className="font-semibold">Mono signal detected</p>
            <p className="mt-0.5">
              Your audio is sending the same signal on both channels. We&apos;ve set you
              to Mono. Using Stereo with this setup can cause echoing and overlapping
              audio for listeners.
            </p>
          </div>
        )}
        {/* Anything that isn't clearly mono-summed — including a "stereo-looking"
            result. A 3-second check can't guarantee a genuine L/R signal, so we
            never claim "stereo detected"; we say we couldn't verify it. */}
        {(testResult === 'stereo' || testResult === 'ambiguous') && (
          <div className="mt-2 bg-gray-800 border border-gray-700 text-gray-300 text-xs px-3 py-2 rounded-lg">
            <p className="font-semibold">Unable to verify stereo</p>
            <p className="mt-0.5">
              A quick check can&apos;t guarantee your channels carry genuinely separate
              left and right audio. If you&apos;re sure your setup is true stereo, you can
              select Stereo below — otherwise stay on Mono.
            </p>
            <p className="mt-1">A true stereo setup means:</p>
            <ul className="list-disc list-inside mt-0.5 space-y-0.5">
              <li>2 separate outputs from your mixer</li>
              <li>2 inputs into your audio interface</li>
              <li>your mixer is not set to mono</li>
            </ul>
          </div>
        )}
      </div>

      <div className="grid gap-2">
        {CARDS.map((card) => {
          const selected = choice === card.id;
          return (
            <button
              key={card.id}
              onClick={() => onChange(card.id)}
              className={`text-left p-3 rounded-lg border transition-all ${
                selected
                  ? 'bg-[#303030] border-gray-500'
                  : 'bg-[#1f1f1f] border-gray-800 hover:bg-[#2a2a2a] hover:border-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-3 h-3 rounded-full border flex-shrink-0 ${
                    selected ? 'bg-white border-white' : 'border-gray-600'
                  }`}
                />
                <span className="text-white text-sm font-medium">{card.title}</span>
              </div>
              <p className="text-gray-500 text-xs mt-1 ml-5">{card.description}</p>
            </button>
          );
        })}
      </div>

      {/* Persistent Stereo warning — amber, educational routing checklist.
          The red conflict warning lives above the GO LIVE button, not here. */}
      {choice === 'stereo' && (
        <div className="mt-3 bg-amber-900/40 border border-amber-700 text-amber-200 text-xs px-3 py-2 rounded-lg">
          <p className="font-semibold">
            ⚠️ Use Stereo only if your mixer is sending true left and right audio channels.
          </p>
          <p className="mt-1">This usually means:</p>
          <ul className="list-disc list-inside mt-0.5 space-y-0.5">
            <li>2 separate outputs from your mixer</li>
            <li>2 inputs into your audio interface</li>
            <li>your mixer is not set to mono</li>
          </ul>
          <p className="mt-1">
            If the same mono signal is being sent to both channels, listeners may hear
            echoing or overlapping audio during your stream.
          </p>
          <p className="mt-1">Not sure? Run the audio check or stay on Mono.</p>
        </div>
      )}
    </div>
  );
}
