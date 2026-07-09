// Parsing for admin-pasted YouTube Content-ID copyright claims into a clean
// tracklist stored on the archive doc (Archive.trackIds).
//
// The raw paste repeats a 2-line block per track followed by boilerplate noise:
//
//   <Track name>              ← line 1
//   <Artist name>             ← line 2
//   Copyright                 ← noise
//   Audio                     ← noise
//   No impact to your video.  ← noise
//   View details              ← noise
//   Take action               ← noise (absent on the last block)
//
// The paste may also begin with leftover trailing noise from a cut-off prior
// entry, and a stray leading ":". We strip all noise + blanks, then pair the
// surviving lines as [track, artist] and emit "Artist – Track" (en-dash).

// A single tracklist entry. `text` is the display string "Artist – Track".
// `private` (artist-set) hides the real text from the public — it renders as
// PRIVATE_TRACK_LABEL on the profile card and in the chat reply, and the real
// text is masked server-side before it ever reaches a listener.
// `djUsername` (admin-set) links the track to a Channel DJ — the DJ's
// chatUsername verbatim; the profile card renders it as a link to
// /dj/${normalizeUsername(djUsername)}. Survives the public mask (not secret).
export interface TrackId {
  text: string;
  private?: boolean;
  djUsername?: string;
}

// Public label shown in place of a private track's real text.
export const PRIVATE_TRACK_LABEL = 'Private track ID';

// Boilerplate lines to drop (compared case-insensitively, trimmed).
export const TRACK_ID_NOISE = [
  'Copyright',
  'Audio',
  'No impact to your video.',
  'View details',
  'Take action',
];

const NOISE_SET = new Set(TRACK_ID_NOISE.map((s) => s.toLowerCase()));

// Strip a leading "<noise token> :" (or a bare leading ":") from a line, so a
// track glued onto the tail of the prior cut-off entry surfaces cleanly.
function stripLeadingNoisePrefix(line: string): string {
  const stripped = line.replace(/^:\s*/, '').trim();
  const colonIdx = stripped.indexOf(':');
  if (colonIdx === -1) return stripped;
  const before = stripped.slice(0, colonIdx).trim().toLowerCase();
  if (NOISE_SET.has(before)) {
    return stripped.slice(colonIdx + 1).trim();
  }
  return stripped;
}

/**
 * Parse a raw YouTube Content-ID claim blob into a tracklist.
 * Each returned entry is the display string "Artist – Track".
 *
 * We anchor on the word "Copyright", which reliably terminates every track's
 * 2-line (track, artist) header and begins the boilerplate for that block:
 *
 *   Track name
 *   Artist name
 *   Copyright                 ← anchor
 *   Audio
 *   <status line — VARIABLE>  e.g. "No impact to your video." OR
 *                                  "Blocking the video in some territories."
 *   View details
 *   Take action
 *
 * The status line's text varies per claim, so we can't strip it by a fixed
 * noise list (doing so desynced the naive line-pairing). Instead we take the
 * two lines immediately BEFORE each "Copyright" as [track, artist]. Any
 * boilerplate between one "Copyright" and the next track is ignored entirely.
 */
export function parseTrackIds(raw: string): TrackId[] {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    // A track can be glued onto the tail of a cut-off prior entry via a ": "
    // separator (e.g. "View details : Nite Roads"); strip a leading noise+":".
    .map((line) => stripLeadingNoisePrefix(line))
    .filter((line) => line.length > 0);

  const texts: string[] = [];
  let lastCopyright = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase() !== 'copyright') continue;
    lastCopyright = i;
    // The two non-empty lines immediately before this "Copyright" are the
    // track (i-2) and artist (i-1). Guard against a truncated first block.
    const track = lines[i - 2];
    const artist = lines[i - 1];
    if (track && artist) {
      texts.push(`${artist} – ${track}`);
    } else if (artist) {
      // Only one header line present (truncated paste) — keep it alone.
      texts.push(artist);
    }
  }

  // Trailing block: the paste can end mid-block with a final track that has NO
  // "Copyright" after it (e.g. "talking it out" / "glob deejay"). Everything
  // after the last "Copyright" is that block's boilerplate followed by the
  // orphan track+artist. Strip the known boilerplate anchors (and the single
  // variable status line, which sits between "Audio" and "View details"); any
  // real lines left over are the final [track, artist].
  // Only recover a trailing block when the paste actually looked like a claim
  // list (had at least one "Copyright"). Without any anchor, stray lines are
  // treated as noise, not tracks.
  const tail: string[] = [];
  let sawAudio = false;
  for (let i = lastCopyright >= 0 ? lastCopyright + 1 : lines.length; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    if (lower === 'audio') { sawAudio = true; continue; }
    // The status line is the one variable line immediately after "Audio";
    // drop it, then stop treating subsequent lines as status.
    if (sawAudio) { sawAudio = false; continue; }
    if (NOISE_SET.has(lower)) continue; // View details / Take action / Copyright
    tail.push(line);
  }
  if (tail.length >= 2) {
    texts.push(`${tail[1]} – ${tail[0]}`);
  } else if (tail.length === 1) {
    texts.push(tail[0]);
  }

  return texts.map((text) => ({ text, private: false }));
}

/**
 * Coerce a raw stored `trackIds` value into TrackId[]. Handles back-compat:
 * legacy archives stored a plain string[] (each already "Artist – Track"), so
 * a string becomes { text, private:false }; objects with a string `text` pass
 * through (coercing `private` to boolean); anything else is dropped.
 */
export function normalizeTrackIds(raw: unknown): TrackId[] {
  if (!Array.isArray(raw)) return [];
  const out: TrackId[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      if (entry.trim()) out.push({ text: entry, private: false });
    } else if (entry && typeof entry === 'object' && typeof (entry as TrackId).text === 'string') {
      const e = entry as TrackId;
      if (e.text.trim()) out.push(withTag({ text: e.text, private: !!e.private }, e.djUsername));
    }
  }
  return out;
}

// Attach a `djUsername` tag only when it's a non-empty string — keeps the field
// absent (not `undefined`) otherwise, which Firestore rejects on write.
function withTag(base: TrackId, djUsername: unknown): TrackId {
  return typeof djUsername === 'string' && djUsername.trim()
    ? { ...base, djUsername }
    : base;
}

/**
 * Public-safe projection: replace each private track's real text with
 * PRIVATE_TRACK_LABEL so it never leaves the server. The DJ tag (`djUsername`)
 * is preserved on BOTH branches — it isn't secret, so a private track stays
 * clickable to its tagged DJ (only its text is masked).
 */
export function publicTrackIds(tracks: TrackId[]): TrackId[] {
  return tracks.map((t) =>
    withTag(
      t.private ? { text: PRIVATE_TRACK_LABEL, private: true } : { text: t.text, private: false },
      t.djUsername,
    )
  );
}

// Track text is stored "Artist – Track" (en-dash). Return the title (the part
// after the dash); if there's no dash, return the whole string. Used to name a
// played track in "you played <title> by <DJ>" copy.
export function trackTitleFromText(text: string): string {
  const idx = text.indexOf('–');
  return idx >= 0 ? text.slice(idx + 1).trim() : text.trim();
}

// One "this archive played a track tagged to another Channel DJ" relationship:
// the played track's title and the tagged DJ's display name. Private tracks are
// excluded (their title must not appear in an email). Shared by the one-time
// blast and the per-archive cron so both derive relationships identically.
export interface PlayedTrackTag {
  trackTitle: string;
  djName: string;
}

/**
 * From an archive's raw `trackIds`, produce the played-track relationships:
 * each non-private track carrying a `djUsername` tag → { trackTitle, djName },
 * where djName is resolved from the tag via `resolveDjName` (given the
 * normalized handle — caller matches it to chatUsernameNormalized). A tag that
 * resolves to null (no such Channel DJ) is dropped. `normalize` is the shared
 * username normalizer (pass normalizeUsername from dj-matching).
 */
export function playedTrackTags(
  rawTrackIds: unknown,
  normalize: (name: string) => string,
  resolveDjName: (normalizedHandle: string) => string | null,
): PlayedTrackTag[] {
  const out: PlayedTrackTag[] = [];
  for (const t of normalizeTrackIds(rawTrackIds)) {
    if (t.private) continue;
    if (!t.djUsername) continue;
    const djName = resolveDjName(normalize(t.djUsername));
    if (!djName) continue;
    out.push({ trackTitle: trackTitleFromText(t.text), djName });
  }
  return out;
}

// A Channel DJ candidate for auto-tagging: chatUsername (display/verbatim, what
// we store on the tag) + normalized (already lowercased, non-alnum stripped).
export interface DjCandidate {
  chatUsername: string;
  chatUsernameNormalized: string;
}

// Minimum DJ-name length (normalized) eligible for auto-matching — short
// handles (e.g. 2-3 chars) word-match too much noise, so we don't auto-suggest
// them. Explicit admin tagging can still pick any DJ.
export const MIN_AUTOMATCH_DJ_LEN = 4;

/**
 * Find the Channel DJ whose name appears as a whole word ANYWHERE in a track's
 * text — matches the artist ("Akumen – …"), a remixer ("… (B.ROD Remix)"), or a
 * feature ("… feat. B. Rod"). Case/punctuation-insensitive via normalization
 * ("B.ROD" and "B. Rod" both normalize to "brod"). Returns the DJ's chatUsername
 * to tag with, or undefined. Shared by the admin Generate auto-select and the
 * backfill script so both behave identically.
 */
export function matchTrackToDj(text: string, djs: DjCandidate[]): string | undefined {
  if (!text) return undefined;
  // Compare on a normalized copy of the text (strip non-alnum to spaces) so a
  // dotted name in the text lines up with the normalized DJ handle at a word
  // boundary. e.g. "(B.ROD Remix)" → " b rod remix " contains " brod "? No —
  // dots split it. So instead we normalize BOTH sides the same way and test for
  // the DJ handle as a maximal run: collapse the text to alnum tokens and also
  // a fully-stripped form, and check the handle appears as one such token.
  const stripped = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); // token-separated
  const tokens = new Set(stripped.split(' '));
  // Also a fully-concatenated form to catch names spelled with internal
  // separators in the text (e.g. "B.ROD" → tokens ["b","rod"] but the handle is
  // "brod"): join adjacent tokens and test contiguous runs.
  const parts = stripped.split(' ');
  for (const dj of djs) {
    const h = dj.chatUsernameNormalized;
    if (!h || h.length < MIN_AUTOMATCH_DJ_LEN) continue;
    // (a) handle equals a single normalized token ("akumen").
    if (tokens.has(h)) return dj.chatUsername;
    // (b) handle equals a contiguous run of tokens joined ("brod" = "b"+"rod").
    for (let i = 0; i < parts.length; i++) {
      let run = '';
      for (let j = i; j < parts.length; j++) {
        run += parts[j];
        if (run.length > h.length) break;
        if (run === h) return dj.chatUsername;
      }
    }
  }
  return undefined;
}

// Chat trigger: a message asking for the tracklist. Matches "track id",
// "track ids", "trackid", "track id?", case-insensitive.
export function isTrackIdRequest(text: string): boolean {
  return /track\s*ids?\??/i.test(text);
}

// Minimal shape needed to build the reply — matches the Archive fields used.
interface TracklistArchive {
  showName?: string;
  djs?: { name?: string }[];
  trackIds?: unknown; // TrackId[] | legacy string[]; normalized internally
}

/**
 * Build the channelbroadcast reply for a "track id" request about a given
 * archive. Returns the header + one track per line, or a graceful fallback
 * when the archive has no tracklist yet. Private tracks render as
 * PRIVATE_TRACK_LABEL (publicTrackIds is idempotent, so this is safe whether
 * the archive arrived already-masked from /api/archives or raw).
 */
export function buildTracklistReply(archive: TracklistArchive): string {
  const showName = archive.showName || 'this show';
  const djName = archive.djs?.map((d) => d.name).filter(Boolean).join(', ');
  const header = djName
    ? `Tracklist for ${showName} by ${djName}:`
    : `Tracklist for ${showName}:`;
  const tracks = publicTrackIds(normalizeTrackIds(archive.trackIds));
  return tracks.length > 0
    ? `${header}\n${tracks.map((t) => t.text).join('\n')}`
    : `No tracklist available for ${showName} yet.`;
}

// Fire-and-forget: record that a signed-in user viewed an archive's tracklist.
// Reuses the stream analytics route with a tracklistView flag (dual write:
// per-user subcollection + archive tally). NEVER awaited — analytics must not
// block or slow the expand.
export function recordTracklistView(userId: string | undefined, slug: string): void {
  if (!userId || !slug) return;
  fetch(`/api/archives/${slug}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, tracklistView: true }),
  }).catch(() => { /* analytics best-effort */ });
}
