'use client';

import { useState } from 'react';
import { AudioInputMethod, RedChannelChoice } from '@/types/broadcast';
import { analyseStereoContent, ChannelContentClass } from '@/lib/audio-analysis';

interface AudioChannelPanelProps {
  inputMethod: AudioInputMethod | null;
  stream: MediaStream | null;
  choice: RedChannelChoice;
  onChange: (choice: RedChannelChoice) => void;
}

const CARDS: { id: RedChannelChoice; title: string; description: string }[] = [
  {
    id: 'mono',
    title: 'Mono',
    description: 'Safe with any audio source.',
  },
  {
    id: 'unsure',
    title: 'Not sure',
    description: "Run a quick audio check and we'll choose the right setting for you.",
  },
  {
    id: 'stereo',
    title: 'Stereo (True stereo only)',
    description: 'Only use this if your mixer sends separate left and right channels.',
  },
];

export function AudioChannelPanel({ inputMethod, stream, choice, onChange }: AudioChannelPanelProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ChannelContentClass | null>(null);

  // The panel is gear-path only. Screen-share / RTMP inputs render nothing —
  // they never use forced stereo RED, so there's nothing for the DJ to set.
  if (inputMethod !== 'device') return null;

  const runTest = async () => {
    if (!stream || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await analyseStereoContent(stream, 3000);
      setTestResult(result);
      // The test is advice — pre-select the recommended choice for convenience,
      // but the DJ can still pick anything afterwards.
      if (result === 'stereo') onChange('stereo');
      else if (result === 'mono') onChange('mono');
    } catch {
      setTestResult('ambiguous');
    } finally {
      setTesting(false);
    }
  };

  const showStereoWarning = choice === 'stereo';
  const showConflictWarning = choice === 'stereo' && testResult === 'mono';

  return (
    <div className="bg-[#252525] rounded-xl p-4">
      <h3 className="text-white text-sm font-semibold mb-1">Stream Optimization</h3>
      <p className="text-gray-400 text-xs mb-4">
        We optimize your stream based on how your audio is connected to help prevent
        dropouts and audio glitches.
      </p>

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

      {/* "Not sure" → audio check */}
      {choice === 'unsure' && (
        <div className="mt-3">
          <button
            onClick={runTest}
            disabled={!stream || testing}
            className="w-full bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white text-sm py-2 rounded-lg transition-colors"
          >
            {testing ? 'Checking your audio…' : 'Test my audio'}
          </button>
          {testResult === 'stereo' && (
            <div className="mt-2 bg-green-900/40 border border-green-800 text-green-200 text-xs px-3 py-2 rounded-lg">
              <p className="font-semibold">Stereo detected ✓</p>
              <p className="mt-0.5">Your audio is sending separate left and right channels.</p>
            </div>
          )}
          {testResult === 'mono' && (
            <div className="mt-2 bg-green-900/40 border border-green-800 text-green-200 text-xs px-3 py-2 rounded-lg">
              <p className="font-semibold">Mono detected ✓</p>
              <p className="mt-0.5">
                Your audio is currently sending the same signal on both channels. Use Mono
                setup. Using Stereo can cause echoing and overlapping audio for listeners.
              </p>
            </div>
          )}
          {testResult === 'ambiguous' && (
            <div className="mt-2 bg-gray-800 border border-gray-700 text-gray-300 text-xs px-3 py-2 rounded-lg">
              <p className="font-semibold">Unable to detect</p>
              <p className="mt-0.5">
                We couldn&apos;t confirm your setup. Select Mono to be safe, or play audio
                through your mixer and try the check again.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Persistent Stereo warning — amber */}
      {showStereoWarning && !showConflictWarning && (
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

      {/* Stereo + mono-detection conflict warning — red, higher severity */}
      {showConflictWarning && (
        <div className="mt-3 bg-red-900/50 border border-red-600 text-red-200 text-xs px-3 py-2 rounded-lg">
          <p className="font-semibold">⚠️ Your last audio check detected a mono signal.</p>
          <p className="mt-1">
            Stereo is enabled. Using Stereo with this setup will cause severe overlapping
            audio.
          </p>
          <p className="mt-1">We strongly recommend switching to Mono before going live.</p>
        </div>
      )}
    </div>
  );
}
