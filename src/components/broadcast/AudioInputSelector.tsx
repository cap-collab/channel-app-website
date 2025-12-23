'use client';

import { AudioInputMethod } from '@/types/broadcast';

interface AudioInputSelectorProps {
  onSelect: (method: AudioInputMethod) => void;
  disabled?: boolean;
}

const inputMethods = [
  {
    id: 'system' as AudioInputMethod,
    title: 'Stream from your computer',
    description: 'Playing from Serato, Rekordbox, Traktor, or Spotify?',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    subtitle: "We'll capture whatever's playing on your Mac",
  },
  {
    id: 'device' as AudioInputMethod,
    title: 'Stream from your gear',
    description: 'Plugging in CDJs, a mixer, or audio interface?',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
      </svg>
    ),
    subtitle: 'USB · XLR · 3.5mm · Bluetooth',
  },
  {
    id: 'rtmp' as AudioInputMethod,
    title: 'Stream from OBS',
    description: 'Using OBS Studio or other streaming software?',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
    subtitle: 'For video streams or multi-camera setups',
  },
];

export function AudioInputSelector({ onSelect, disabled }: AudioInputSelectorProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4">
        {inputMethods.map((method) => (
          <button
            key={method.id}
            onClick={() => onSelect(method.id)}
            disabled={disabled}
            className="flex items-start gap-4 p-5 bg-gray-900 hover:bg-gray-800 rounded-xl border border-gray-800 hover:border-gray-700 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="text-blue-400 mt-0.5">
              {method.icon}
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-medium text-white">{method.title}</h3>
              <p className="text-gray-400 text-sm mt-1">{method.description}</p>
              <p className="text-gray-500 text-xs mt-2">{method.subtitle}</p>
            </div>
            <svg className="w-5 h-5 text-gray-600 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
