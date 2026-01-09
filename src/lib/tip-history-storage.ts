// Local storage utility for tip history (for guest users and offline access)

const STORAGE_KEY = 'channelTipHistory';

export interface LocalTipRecord {
  id: string;
  stripeSessionId: string;
  djUsername: string;
  djUserId?: string;
  showName: string;
  tipAmountCents: number;
  djThankYouMessage: string;
  createdAt: number; // timestamp in ms
}

export function getTipHistoryFromLocalStorage(): LocalTipRecord[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function saveTipToLocalStorage(tip: LocalTipRecord): void {
  if (typeof window === 'undefined') return;

  try {
    const existing = getTipHistoryFromLocalStorage();

    // Check for duplicates by stripeSessionId
    if (existing.some(t => t.stripeSessionId === tip.stripeSessionId)) {
      return;
    }

    // Add new tip at the beginning (most recent first)
    const updated = [tip, ...existing];

    // Keep only the last 100 tips
    const trimmed = updated.slice(0, 100);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.error('Failed to save tip to localStorage:', error);
  }
}

export function clearTipHistory(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

// Group tips by DJ for inbox display
export interface DJTipGroup {
  djUsername: string;
  djUserId?: string;
  djPhotoUrl?: string | null;
  tips: LocalTipRecord[];
  totalAmountCents: number;
  latestTipDate: number;
}

export function groupTipsByDJ(tips: LocalTipRecord[]): DJTipGroup[] {
  const grouped = tips.reduce((acc, tip) => {
    const key = tip.djUsername;
    if (!acc[key]) {
      acc[key] = {
        djUsername: tip.djUsername,
        djUserId: tip.djUserId,
        tips: [],
        totalAmountCents: 0,
        latestTipDate: tip.createdAt,
      };
    }
    acc[key].tips.push(tip);
    acc[key].totalAmountCents += tip.tipAmountCents;
    if (tip.createdAt > acc[key].latestTipDate) {
      acc[key].latestTipDate = tip.createdAt;
    }
    return acc;
  }, {} as Record<string, DJTipGroup>);

  // Sort by most recent tip
  return Object.values(grouped).sort((a, b) => b.latestTipDate - a.latestTipDate);
}
