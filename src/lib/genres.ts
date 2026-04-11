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

// Multi-word genres that should NOT be split on spaces
const MULTI_WORD_GENRES = new Set(
  SUPPORTED_GENRES
    .filter((g) => g.includes(' '))
    .map((g) => g.toLowerCase())
);
// Also add common multi-word aliases
for (const aliases of Object.values(GENRE_ALIASES)) {
  for (const alias of aliases) {
    if (alias.includes(' ') || alias.includes('-') || alias.includes('&') || alias.includes("'")) {
      MULTI_WORD_GENRES.add(alias.toLowerCase());
    }
  }
}

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
 * Smart genre parsing: handles comma-separated, space-separated, or mixed input.
 * Recognizes multi-word genres like "Drum and Bass", "Hip Hop", "Dance Music" etc.
 * "techno house" => ["Techno", "House"]
 * "Drum and Bass, Techno" => ["Drum and Bass", "Techno"]
 * "techno, house ambient" => ["Techno", "House", "Ambient"]
 */
export function parseGenresInput(input: string): string[] {
  if (!input.trim()) return [];

  // If input contains commas, split by commas first
  const parts = input.includes(',')
    ? input.split(',').map((s) => s.trim()).filter(Boolean)
    : [input.trim()];

  const result: string[] = [];

  for (const part of parts) {
    // Try the whole part as a single genre first
    const norm = normalizeGenre(part);
    if (MULTI_WORD_GENRES.has(norm) || SUPPORTED_GENRES.some((g) => normalizeGenre(g) === norm)) {
      const resolved = resolveGenre(part);
      if (resolved) result.push(resolved);
      continue;
    }

    // Check alias match for the whole part
    let aliasMatch = false;
    for (const [canonical, aliases] of Object.entries(GENRE_ALIASES)) {
      if (aliases.some((a) => normalizeGenre(a) === norm)) {
        const match = SUPPORTED_GENRES.find((g) => g.toLowerCase() === canonical);
        if (match) {
          result.push(match);
          aliasMatch = true;
          break;
        }
      }
    }
    if (aliasMatch) continue;

    // Try to extract multi-word genres from the part, then split remainder by spaces
    let remaining = part.toLowerCase().trim();
    const extracted: string[] = [];

    // Sort multi-word genres by length (longest first) to match greedily
    const sortedMultiWord = Array.from(MULTI_WORD_GENRES).sort((a, b) => b.length - a.length);
    for (const mw of sortedMultiWord) {
      const idx = remaining.indexOf(mw);
      if (idx !== -1) {
        extracted.push(mw);
        remaining = remaining.slice(0, idx) + ' ' + remaining.slice(idx + mw.length);
      }
    }

    // Split the remainder by spaces
    const words = remaining.split(/\s+/).filter(Boolean);
    for (const word of words) {
      const resolved = resolveGenre(word);
      if (resolved) extracted.push(resolved);
    }

    // Resolve extracted multi-word genres
    for (const genre of extracted) {
      const resolved = resolveGenre(genre);
      if (resolved && !result.includes(resolved)) {
        result.push(resolved);
      }
    }
  }

  // Deduplicate while preserving order
  return Array.from(new Set(result));
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
