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

// Primary URL slug per tempo — user-facing wording, kebab-cased, for shareable
// filter links (e.g. `/?very-chill`, `/?intense`). The raw ids (`very_slow`,
// `very_fast`, …) are also accepted as aliases via tempoFromUrlSlug.
export const TEMPO_URL_SLUGS: Record<Tempo, string> = {
  very_slow: 'very-chill',
  downtempo: 'downtempo',
  uptempo: 'uptempo',
  very_fast: 'intense',
};

// Every URL slug that maps to a tempo: the primary slugs above plus the raw ids
// as aliases. Used to scan bare URL params and to strip them on manual toggle.
export const TEMPO_URL_SLUG_TO_ID: Record<string, Tempo> = TEMPOS.reduce(
  (acc, t) => {
    acc[TEMPO_URL_SLUGS[t.id]] = t.id; // primary (user-facing wording)
    acc[t.id] = t.id; // alias (raw id)
    return acc;
  },
  {} as Record<string, Tempo>,
);

// Resolve a URL slug (primary user-facing slug OR raw-id alias) to a Tempo,
// or null if it isn't a known tempo slug.
export function tempoFromUrlSlug(slug: string): Tempo | null {
  return TEMPO_URL_SLUG_TO_ID[slug] ?? null;
}
