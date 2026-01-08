/**
 * Normalizes a URL by prepending https:// if no protocol is present.
 * Handles inputs like "bandcamp.com" or "www.bandcamp.com" and converts
 * them to proper clickable URLs.
 */
export function normalizeUrl(value: string): string {
  if (!value) return value;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}
