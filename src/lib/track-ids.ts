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
export function parseTrackIds(raw: string): string[] {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    // A track can be glued onto the tail of a cut-off prior entry via a ": "
    // separator (e.g. "View details : Nite Roads"); strip a leading noise+":".
    .map((line) => stripLeadingNoisePrefix(line))
    .filter((line) => line.length > 0);

  const tracks: string[] = [];
  let lastCopyright = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase() !== 'copyright') continue;
    lastCopyright = i;
    // The two non-empty lines immediately before this "Copyright" are the
    // track (i-2) and artist (i-1). Guard against a truncated first block.
    const track = lines[i - 2];
    const artist = lines[i - 1];
    if (track && artist) {
      tracks.push(`${artist} – ${track}`);
    } else if (artist) {
      // Only one header line present (truncated paste) — keep it alone.
      tracks.push(artist);
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
    tracks.push(`${tail[1]} – ${tail[0]}`);
  } else if (tail.length === 1) {
    tracks.push(tail[0]);
  }

  return tracks;
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
  trackIds?: string[];
}

/**
 * Build the channelbroadcast reply for a "track id" request about a given
 * archive. Returns the header + one track per line, or a graceful fallback
 * when the archive has no tracklist yet.
 */
export function buildTracklistReply(archive: TracklistArchive): string {
  const showName = archive.showName || 'this show';
  const djName = archive.djs?.map((d) => d.name).filter(Boolean).join(', ');
  const header = djName
    ? `Tracklist for ${showName} by ${djName}:`
    : `Tracklist for ${showName}:`;
  const tracks = archive.trackIds ?? [];
  return tracks.length > 0
    ? `${header}\n${tracks.join('\n')}`
    : `No tracklist available for ${showName} yet.`;
}
