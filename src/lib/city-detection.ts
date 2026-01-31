// Supported cities for IRL shows dropdown (alphabetically sorted)
export const SUPPORTED_CITIES = [
  'Amsterdam',
  'Atlanta',
  'Austin',
  'Barcelona',
  'Berlin',
  'Boston',
  'Brussels',
  'Buenos Aires',
  'Chicago',
  'Copenhagen',
  'Denver',
  'Detroit',
  'Dublin',
  'Hong Kong',
  'Lisbon',
  'London',
  'Los Angeles',
  'Madrid',
  'Marseille',
  'Melbourne',
  'Mexico City',
  'Miami',
  'Montreal',
  'New York',
  'Paris',
  'Philadelphia',
  'Portland',
  'Rio de Janeiro',
  'San Francisco',
  'São Paulo',
  'Seattle',
  'Seoul',
  'Singapore',
  'Sydney',
  'Tokyo',
  'Toronto',
  'Vancouver',
  'Washington DC',
] as const;

export type SupportedCity = typeof SUPPORTED_CITIES[number];

// Map common timezones to their nearest major city
const TIMEZONE_TO_CITY: Record<string, string> = {
  // Europe
  'Europe/London': 'London',
  'Europe/Paris': 'Paris',
  'Europe/Berlin': 'Berlin',
  'Europe/Amsterdam': 'Amsterdam',
  'Europe/Madrid': 'Madrid',
  'Europe/Barcelona': 'Barcelona',
  'Europe/Brussels': 'Brussels',
  'Europe/Rome': 'Berlin',
  'Europe/Vienna': 'Berlin',
  'Europe/Zurich': 'Berlin',
  'Europe/Prague': 'Berlin',
  'Europe/Warsaw': 'Berlin',
  'Europe/Stockholm': 'Copenhagen',
  'Europe/Copenhagen': 'Copenhagen',
  'Europe/Oslo': 'Copenhagen',
  'Europe/Helsinki': 'Copenhagen',
  'Europe/Dublin': 'Dublin',
  'Europe/Lisbon': 'Lisbon',
  'Europe/Marseille': 'Marseille',

  // Americas - West Coast
  'America/Los_Angeles': 'Los Angeles',
  'America/San_Francisco': 'San Francisco',
  'America/Seattle': 'Seattle',
  'America/Vancouver': 'Vancouver',
  'America/Tijuana': 'Los Angeles',
  'America/Phoenix': 'Los Angeles',

  // Americas - Mountain
  'America/Denver': 'Denver',
  'America/Boise': 'Denver',

  // Americas - Central
  'America/Chicago': 'Chicago',
  'America/Detroit': 'Detroit',
  'America/Indiana/Indianapolis': 'Chicago',

  // Americas - East Coast
  'America/New_York': 'New York',
  'America/Toronto': 'Toronto',
  'America/Montreal': 'Montreal',
  'America/Boston': 'Boston',
  'America/Philadelphia': 'Philadelphia',
  'America/Atlanta': 'Atlanta',
  'America/Miami': 'Miami',
  'America/Havana': 'Miami',

  // Americas - South
  'America/Mexico_City': 'Mexico City',
  'America/Monterrey': 'Mexico City',
  'America/Sao_Paulo': 'São Paulo',
  'America/Rio_de_Janeiro': 'Rio de Janeiro',
  'America/Fortaleza': 'São Paulo',
  'America/Recife': 'São Paulo',
  'America/Buenos_Aires': 'Buenos Aires',
  'America/Argentina/Buenos_Aires': 'Buenos Aires',

  // Americas - Pacific Northwest / Texas
  'America/Portland': 'Portland',
  'America/Austin': 'Austin',
  'America/Houston': 'Austin',
  'America/Dallas': 'Austin',

  // Asia/Pacific
  'Asia/Tokyo': 'Tokyo',
  'Asia/Seoul': 'Seoul',
  'Asia/Shanghai': 'Hong Kong',
  'Asia/Hong_Kong': 'Hong Kong',
  'Asia/Singapore': 'Singapore',
  'Australia/Sydney': 'Sydney',
  'Australia/Melbourne': 'Melbourne',
  'Australia/Brisbane': 'Sydney',
  'Australia/Perth': 'Sydney',
  'Pacific/Auckland': 'Sydney',
};

/**
 * Get the default city based on the user's timezone
 * Falls back to 'London' if timezone is not recognized
 */
export function getDefaultCity(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIMEZONE_TO_CITY[timezone] || 'London';
  } catch {
    return 'London';
  }
}

// City aliases for flexible matching
const CITY_ALIASES: Record<string, string[]> = {
  'new york': ['ny', 'nyc', 'new york city', 'brooklyn', 'manhattan', 'queens', 'bronx'],
  'san francisco': ['sf', 'san fran', 'bay area', 'oakland'],
  'los angeles': ['la', 'l.a.', 'l.a', 'hollywood'],
  'london': ['ldn'],
  'melbourne': ['melb'],
  'amsterdam': ['ams'],
  'barcelona': ['bcn', 'barna'],
  'berlin': ['bln'],
  'mexico city': ['cdmx', 'ciudad de mexico', 'df'],
  'detroit': ['det', 'the d'],
  'tokyo': ['tyo'],
  'sydney': ['syd'],
  'chicago': ['chi', 'chiraq'],
  'miami': ['mia', 'south beach'],
  'toronto': ['to', 'the 6', 'the six', '6ix'],
  'montreal': ['mtl'],
  'rio de janeiro': ['rio'],
  'são paulo': ['sao paulo', 'sp', 'sampa'],
  'seattle': ['sea'],
  'vancouver': ['van', 'yvr'],
  'portland': ['pdx'],
  'denver': ['den'],
  'austin': ['atx'],
  'atlanta': ['atl'],
  'boston': ['bos'],
  'philadelphia': ['philly', 'phl'],
  'washington dc': ['dc', 'washington', 'dmv'],
  'buenos aires': ['ba', 'bsas'],
  'hong kong': ['hk'],
  'singapore': ['sg', 'sin'],
  'seoul': ['sel'],
  'dublin': ['dub'],
  'lisbon': ['lis', 'lisboa'],
  'madrid': ['mad'],
  'copenhagen': ['cph', 'kobenhavn'],
  'brussels': ['bru', 'bruxelles'],
};

/**
 * Check if a location string matches a supported city (case-insensitive)
 * Supports aliases like NY for New York, SF for San Francisco, etc.
 */
export function matchesCity(location: string, city: string): boolean {
  const locationLower = location.toLowerCase().trim();
  const cityLower = city.toLowerCase();

  // Exact match or location contains the city name
  if (locationLower === cityLower || locationLower.includes(cityLower)) {
    return true;
  }

  // Check if location matches any alias for the city
  const aliases = CITY_ALIASES[cityLower];
  if (aliases) {
    if (aliases.some((alias) => locationLower === alias || locationLower.includes(alias))) {
      return true;
    }
  }

  // Check reverse: if the selected city is an alias, match against the canonical city
  for (const [canonical, aliasList] of Object.entries(CITY_ALIASES)) {
    if (aliasList.includes(cityLower) || cityLower === canonical) {
      if (locationLower.includes(canonical) || aliasList.some((a) => locationLower.includes(a))) {
        return true;
      }
    }
  }

  return false;
}
