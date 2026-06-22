import { normalizeUsername } from '@/lib/dj-matching';

/**
 * Generate a URL-friendly slug from a name. Identical rule to normalizeUsername
 * (strip ALL non-alphanumerics, lowercase) so collective slugs and DJ usernames
 * normalize the same way — a dotted name like "B. Rod" resolves consistently.
 */
export function generateSlug(name: string): string {
  return normalizeUsername(name);
}
