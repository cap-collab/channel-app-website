/**
 * Soft "did you mean" email domain suggestion.
 *
 * Catches common typos in the domain of a manually-typed email address
 * (e.g. `@gmal.com`, `@gmial.com`, `@yahho.com`, `@hotmial.con`) by comparing
 * the typed domain against a curated list of popular providers using
 * Damerau-Levenshtein edit distance.
 *
 * This ONLY suggests — it never blocks submission or auto-corrects. The caller
 * shows the suggestion and lets the user tap to accept it. A `@gmal.com` could,
 * in rare cases, be a real domain; the user decides.
 */

// Popular full domains people fat-finger. Ordered roughly by frequency.
const POPULAR_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'live.com',
  'msn.com',
  'comcast.net',
  'ymail.com',
  'googlemail.com',
];

// TLDs worth correcting on their own (domain part can be anything).
const POPULAR_TLDS = ['com', 'net', 'org', 'co', 'io', 'me', 'edu', 'co.uk'];

/** Damerau-Levenshtein: like Levenshtein but counts adjacent transposition as 1. */
function editDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  const d: number[][] = Array.from({ length: al + 1 }, () =>
    new Array(bl + 1).fill(0)
  );
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost // substitution
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }
  return d[al][bl];
}

/** Closest candidate within `threshold` edits, or null. Requires exactly one best match. */
function closest(
  input: string,
  candidates: string[],
  threshold: number
): string | null {
  let best: string | null = null;
  let bestDist = threshold + 1;
  for (const c of candidates) {
    if (c === input) return null; // already exact — nothing to suggest
    const dist = editDistance(input, c);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return bestDist <= threshold ? best : null;
}

/**
 * Returns a corrected email string if the domain looks like a typo of a
 * popular provider, otherwise null.
 *
 * Only suggests when the local part is intact and the domain is *close but not
 * equal* to a known good value — so a valid `gmail.com` never gets flagged.
 */
export function suggestEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain.includes('.')) return null;

  // 1) Whole-domain match against popular providers (catches gmal.com, gmial.com…).
  const domainSuggestion = closest(domain, POPULAR_DOMAINS, 2);
  if (domainSuggestion) return `${local}@${domainSuggestion}`;

  // 2) TLD-only match (catches gmail.con, foo.ocm) while leaving the SLD alone.
  const lastDot = domain.lastIndexOf('.');
  const sld = domain.slice(0, lastDot); // second-level domain, e.g. "gmail"
  const tld = domain.slice(lastDot + 1);
  const tldSuggestion = closest(tld, POPULAR_TLDS, 1);
  if (tldSuggestion) return `${local}@${sld}.${tldSuggestion}`;

  return null;
}
