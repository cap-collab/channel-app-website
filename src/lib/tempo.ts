import type { Tempo } from '@/types/broadcast';

// Canonical, ordered list of archive tempos + their display labels. The admin
// tempo selector (and any future consumer) reads from here so options stay in
// sync with the `Tempo` type. Order is slowest → fastest.
export const TEMPOS: ReadonlyArray<{ id: Tempo; label: string }> = [
  { id: 'very_slow', label: 'Very Chill' },
  { id: 'downtempo', label: 'Downtempo' },
  { id: 'uptempo', label: 'Uptempo' },
  { id: 'very_fast', label: 'Intense' },
] as const;

// True if `value` is one of the four known tempo ids.
export function isTempo(value: unknown): value is Tempo {
  return typeof value === 'string' && TEMPOS.some((t) => t.id === value);
}

// Human-readable label for a tempo id, or null if unset/unknown.
export function tempoLabel(value: unknown): string | null {
  return TEMPOS.find((t) => t.id === value)?.label ?? null;
}
