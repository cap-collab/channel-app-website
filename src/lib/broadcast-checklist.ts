// Shared checklist for the DJ broadcast panel.
// Used by both AudioStatusPanel (the expanded list) and LiveControlBar (the
// READY/NEEDS REVIEW pill color).

import { AudioInputMethod } from '@/types/broadcast';

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface ChecklistInput {
  inputMethod: AudioInputMethod | null;
  hasStream: boolean;
  hasStrongAudio: boolean;
}

export function buildChecklist({ inputMethod, hasStream, hasStrongAudio }: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  items.push({
    id: 'chrome-permission',
    label: 'Chrome has Screen & System Audio permission for audio',
    checked: !!hasStream,
  });

  items.push({
    id: 'page-capturing',
    label: 'Channel page is capturing audio',
    checked: !!hasStream && (inputMethod === 'system' || inputMethod === 'device' || inputMethod === 'rtmp'),
  });

  items.push({
    id: 'levels-loud',
    label: 'Audio levels are loud enough',
    checked: hasStrongAudio,
  });

  return items;
}

export function isChecklistAllGreen(items: ChecklistItem[]): boolean {
  return items.length > 0 && items.every(i => i.checked);
}
