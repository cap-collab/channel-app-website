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
    return allTerms.some((term) => gNorm.includes(term) || term.includes(gNorm));
  });
}
