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
 */
export function parseTrackIds(raw: string): string[] {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    // The first real track can be glued onto the tail of the cut-off prior
    // entry via a ": " separator (e.g. "View details : Nite Roads"). Strip a
    // leading known-noise token followed by ":" so only the track remains.
    // Also handles a bare leading ":". We do NOT strip on any arbitrary colon —
    // real track/artist text may legitimately contain one.
    .map((line) => stripLeadingNoisePrefix(line))
    .filter((line) => line.length > 0 && !NOISE_SET.has(line.toLowerCase()));

  const tracks: string[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const track = lines[i];
    const artist = lines[i + 1];
    // Dangling odd final line (track with no artist) — keep it alone.
    tracks.push(artist ? `${artist} – ${track}` : track);
  }
  return tracks;
}
