export const SUPPORTED_GENRES = [
  'Ambient',
  'Bass',
  'Dance',
  'Disco',
  'Drum and Bass',
  'Dub',
  'Electronic',
  'Experimental',
  'Funk',
  'Garage',
  'Hip Hop',
  'House',
  'Jungle',
  'Rap',
  'Reggae',
  'Soul',
  'Techno',
  'World',
];

// Genre aliases for flexible matching
export const GENRE_ALIASES: Record<string, string[]> = {
  'ambient': ['ambiant', 'ambience', 'atmospheric'],
  'dance': ['dance music'],
  'drum and bass': ['drum & bass', 'dnb', 'd&b', 'd and b', 'drum n bass', "drum'n'bass", 'drumnbass'],
  'hip hop': ['hip-hop', 'hiphop'],
  'garage': ['uk garage', 'ukg', '2-step', '2step'],
  'dub': ['dubstep'],
  'disco': ['nu disco', 'nu-disco'],
  'funk': ['funky'],
  'soul': ['neo soul', 'neo-soul', 'r&b', 'rnb'],
  'electronic': ['electronica'],
  'house': ['deep house', 'tech house'],
  'techno': ['tech'],
  'jungle': ['junglist'],
  'reggae': ['roots', 'dancehall'],
};

// Strip quotes, special characters, and extra whitespace for genre comparison
function normalizeGenre(s: string): string {
  return s.toLowerCase().replace(/["""''`]/g, '').replace(/[^\w\s&]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve a genre string to its canonical SUPPORTED_GENRES name, or return as-is.
 */
function resolveGenre(input: string): string | null {
  const norm = normalizeGenre(input);
  if (!norm) return null;

  // Direct match against supported genres
  const direct = SUPPORTED_GENRES.find((g) => normalizeGenre(g) === norm);
  if (direct) return direct;

  // Match against aliases
  for (const [canonical, aliases] of Object.entries(GENRE_ALIASES)) {
    if (aliases.some((a) => normalizeGenre(a) === norm)) {
      const match = SUPPORTED_GENRES.find((g) => g.toLowerCase() === canonical);
      if (match) return match;
    }
  }

  // Return the trimmed original (capitalized) if no match
  return input.trim();
}

/**
 * Genre parsing: commas are the only separator, so multi-word genres like
 * "Hip Hop", "Drum and Bass", or "Tech House" stay intact (spaces never split).
 * Each comma-delimited part is resolved to its canonical name when recognized.
 * "Drum and Bass, Techno" => ["Drum and Bass", "Techno"]
 * "tech house, dnb" => ["House", "Drum and Bass"]
 */
export function parseGenresInput(input: string): string[] {
  if (!input.trim()) return [];

  const parts = input.split(',').map((s) => s.trim()).filter(Boolean);

  const result: string[] = [];
  for (const part of parts) {
    const resolved = resolveGenre(part);
    if (resolved && !result.includes(resolved)) {
      result.push(resolved);
    }
  }

  return result;
}

/**
 * Extract Instagram handle from URL or handle input.
 * Accepts: @handle, handle, https://instagram.com/handle, https://www.instagram.com/handle/
 * Returns: the handle without @ prefix
 */
export function extractInstagramHandle(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  // Remove trailing slashes and query params
  const cleaned = trimmed.split('?')[0].replace(/\/+$/, '');

  // Match Instagram URL patterns
  const urlMatch = cleaned.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/]+)/i);
  if (urlMatch) {
    return urlMatch[1];
  }

  // If it's just a username (possibly with @)
  return cleaned.replace(/^@/, '');
}

// Check if a show's genres match a single target genre (with alias support)
export function matchesGenre(showGenres: string[], genre: string): boolean {
  if (showGenres.length === 0 || !genre) return false;
  const genreLower = normalizeGenre(genre);
  const aliases = GENRE_ALIASES[genreLower] || [];
  const allTerms = [genreLower, ...aliases.map(normalizeGenre)];
  for (const [canonical, aliasList] of Object.entries(GENRE_ALIASES)) {
    if (aliasList.some((a) => normalizeGenre(a) === genreLower)) {
      allTerms.push(normalizeGenre(canonical), ...aliasList.map(normalizeGenre));
      break;
    }
  }
  return showGenres.some((g) => {
    const gNorm = normalizeGenre(g);
    return allTerms.some((term) => gNorm === term || gNorm.includes(term));
  });
}
