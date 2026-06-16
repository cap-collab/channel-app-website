import type { ArchivePriority } from '@/types/broadcast';

// Centralized archive-priority logic. 'featured' is the top tier and behaves
// IDENTICALLY to 'high' everywhere high is special-cased (radio loop
// eligibility/pool/weighting, restream picker, hero seed, auto-advance). It
// only differs in two ways: it ranks one notch above 'high' (priorityRank), and
// it additionally surfaces in the homepage "Featured" section (priorityIsFeatured).
//
// Order, highest → lowest: 'featured' > 'high' > 'medium' > 'low' > 'hidden'.

// True when an archive should get the "high priority" treatment. Use this
// instead of `priority === 'high'` so 'featured' inherits all of it.
export function priorityIsHigh(p?: string): boolean {
  return p === 'high' || p === 'featured';
}

// True only for the dedicated Featured surface (homepage Featured section).
export function priorityIsFeatured(p?: string): boolean {
  return p === 'featured';
}

// True when an archive is eligible for the radio loop / daily schedule.
// Featured + high + medium are eligible; low + hidden are not.
export function priorityIsLoopEligible(p?: string): boolean {
  const v = p || 'medium';
  return v === 'featured' || v === 'high' || v === 'medium';
}

// Sort rank, lower = shown higher. Featured floats above high.
export function priorityRank(p?: ArchivePriority | string): number {
  switch (p) {
    case 'featured':
      return 0;
    case 'high':
      return 1;
    case 'medium':
      return 2;
    case 'low':
      return 3;
    default:
      return 4; // hidden / unknown
  }
}
