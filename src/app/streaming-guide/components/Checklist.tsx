'use client';

import { useState } from 'react';

type StreamingPath = 'computer' | 'dj_gear';

interface ChecklistProps {
  streamingPath: StreamingPath;
}

interface ChecklistItem {
  id: string;
  label: string;
  forPath: StreamingPath | 'both';
}

const checklistItems: ChecklistItem[] = [
  { id: 'macos-io', label: 'macOS input & output set to your mixer/controller or audio interface (levels moving in Sound Settings)', forPath: 'dj_gear' },
  { id: 'chrome-input', label: 'Chrome audio input set to your mixer/controller', forPath: 'dj_gear' },
  { id: 'browser-audio', label: 'Chrome has Screen & System Audio Recording permission for audio only (one-time setup)', forPath: 'computer' },
  { id: 'levels', label: 'Audio levels moving on the Channel Go Live page — and NOT coming from your microphone', forPath: 'both' },
];

export function Checklist({ streamingPath }: ChecklistProps) {
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  const relevantItems = checklistItems.filter(
    (item) => item.forPath === 'both' || item.forPath === streamingPath
  );

  const allChecked = relevantItems.every((item) => checkedItems.has(item.id));

  const toggleItem = (id: string) => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-white mb-4">
        Final check before going live
      </h3>

      <div className="space-y-3">
        {relevantItems.map((item) => (
          <label
            key={item.id}
            className="flex items-center gap-3 cursor-pointer group"
          >
            <div
              className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                checkedItems.has(item.id)
                  ? 'bg-green-500 border-green-500'
                  : 'border-gray-600 group-hover:border-gray-400'
              }`}
              onClick={() => toggleItem(item.id)}
            >
              {checkedItems.has(item.id) && (
                <svg
                  className="w-3 h-3 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              )}
            </div>
            <span
              className={`transition-colors ${
                checkedItems.has(item.id) ? 'text-gray-500 line-through' : 'text-gray-300'
              }`}
            >
              {item.label}
            </span>
          </label>
        ))}
      </div>

      {allChecked && (
        <div className="mt-6 p-4 bg-green-900/20 border border-green-800/50 rounded-lg animate-fadeIn">
          <p className="text-green-200 text-sm">
            If Channel shows audio levels that are not coming from your computer microphone, you&apos;re live-ready!
          </p>
        </div>
      )}
    </div>
  );
}
