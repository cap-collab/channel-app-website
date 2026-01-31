// Supported cities for IRL shows dropdown
export const SUPPORTED_CITIES = [
  'Amsterdam',
  'Barcelona',
  'Berlin',
  'Detroit',
  'London',
  'Los Angeles',
  'Marseille',
  'Melbourne',
  'Mexico City',
  'New York',
  'Paris',
  'San Francisco',
  'Sydney',
  'Tokyo',
] as const;

export type SupportedCity = typeof SUPPORTED_CITIES[number];

// Map common timezones to their nearest major city
const TIMEZONE_TO_CITY: Record<string, string> = {
  // Europe
  'Europe/London': 'London',
  'Europe/Paris': 'Paris',
  'Europe/Berlin': 'Berlin',
  'Europe/Amsterdam': 'Amsterdam',
  'Europe/Madrid': 'Barcelona',
  'Europe/Barcelona': 'Barcelona',
  'Europe/Brussels': 'Amsterdam',
  'Europe/Rome': 'Berlin',
  'Europe/Vienna': 'Berlin',
  'Europe/Zurich': 'Berlin',
  'Europe/Prague': 'Berlin',
  'Europe/Warsaw': 'Berlin',
  'Europe/Stockholm': 'Berlin',
  'Europe/Copenhagen': 'Berlin',
  'Europe/Oslo': 'Berlin',
  'Europe/Helsinki': 'Berlin',
  'Europe/Dublin': 'London',
  'Europe/Lisbon': 'London',
  'Europe/Marseille': 'Marseille',

  // Americas
  'America/Los_Angeles': 'Los Angeles',
  'America/New_York': 'New York',
  'America/San_Francisco': 'San Francisco',
  'America/Chicago': 'Detroit',
  'America/Detroit': 'Detroit',
  'America/Denver': 'Los Angeles',
  'America/Phoenix': 'Los Angeles',
  'America/Seattle': 'Los Angeles',
  'America/Vancouver': 'Los Angeles',
  'America/Toronto': 'New York',
  'America/Mexico_City': 'Mexico City',
  'America/Tijuana': 'Los Angeles',
  'America/Monterrey': 'Mexico City',

  // Asia/Pacific
  'Asia/Tokyo': 'Tokyo',
  'Asia/Seoul': 'Tokyo',
  'Asia/Shanghai': 'Tokyo',
  'Asia/Hong_Kong': 'Tokyo',
  'Asia/Singapore': 'Tokyo',
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
