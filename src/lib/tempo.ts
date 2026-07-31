import type { Tempo } from '@/types/broadcast';

// Canonical, ordered list of archive tempos + their display labels. The admin
// tempo selector (and any future consumer) reads from here so options stay in
// sync with the `Tempo` type. Order is slowest → fastest.
export const TEMPOS: ReadonlyArray<{ id: Tempo; label: string }> = [
  { id: 'very_slow', label: 'Ambient' },
  { id: 'downtempo', label: 'Downtempo' },
  { id: 'uptempo', label: 'Uptempo' },
  { id: 'very_fast', label: 'Techno' },
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
// filter links (e.g. `/?ambient`, `/?techno`). The raw ids (`very_slow`,
// `very_fast`, …) and the pre-rename slugs are also accepted as aliases via
// tempoFromUrlSlug.
export const TEMPO_URL_SLUGS: Record<Tempo, string> = {
  very_slow: 'ambient',
  downtempo: 'downtempo',
  uptempo: 'uptempo',
  very_fast: 'techno',
};

// Retired user-facing slugs, kept so links shared before the Ambient/Techno
// rename keep filtering instead of silently doing nothing.
const LEGACY_TEMPO_URL_SLUGS: Record<string, Tempo> = {
  'very-chill': 'very_slow',
  intense: 'very_fast',
};

// Every URL slug that maps to a tempo: the primary slugs above, the raw ids,
// and the legacy slugs. Used to scan bare URL params and to strip them on
// manual toggle.
export const TEMPO_URL_SLUG_TO_ID: Record<string, Tempo> = TEMPOS.reduce(
  (acc, t) => {
    acc[TEMPO_URL_SLUGS[t.id]] = t.id; // primary (user-facing wording)
    acc[t.id] = t.id; // alias (raw id)
    return acc;
  },
  { ...LEGACY_TEMPO_URL_SLUGS } as Record<string, Tempo>,
);

// Resolve a URL slug (primary user-facing slug OR raw-id alias) to a Tempo,
// or null if it isn't a known tempo slug.
export function tempoFromUrlSlug(slug: string): Tempo | null {
  return TEMPO_URL_SLUG_TO_ID[slug] ?? null;
}
