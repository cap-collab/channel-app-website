import { describe, it, expect } from "vitest";
import {
  parseTrackIds,
  normalizeTrackIds,
  publicTrackIds,
  buildTracklistReply,
  PRIVATE_TRACK_LABEL,
} from "./track-ids";

// parseTrackIds now returns TrackId[] ({ text, private }). These tests assert
// on the display text; parse output is never private (private is artist-set later).
const texts = (raw: string) => parseTrackIds(raw).map((t) => t.text);

describe("parseTrackIds", () => {
  it("parses a real YouTube Content-ID claim blob into 'Artist – Track'", () => {
    const raw = `Audio
No impact to your video.

View details : Nite Roads
Jovonn
Copyright
Audio
No impact to your video.

View details

Take action
Bail-E (Original Mix)
Mr. Ho
Copyright
Audio
No impact to your video.

View details

Take action
Exoplanet Vibe Cult
No Moon
Copyright
Audio
No impact to your video.

View details

Take action
Wanna Be Your Everything
Alex Visconti
Copyright
Audio
No impact to your video.

View details

Take action
Just Like That (Car Mix)
Light Blue File
Copyright
Audio
No impact to your video.

View details

Take action
Escape from Reality (2002)
System
Copyright
Audio
No impact to your video.

View details

Take action
Stay At Home
Swin
Copyright
Audio`;

    expect(texts(raw)).toEqual([
      "Jovonn – Nite Roads",
      "Mr. Ho – Bail-E (Original Mix)",
      "No Moon – Exoplanet Vibe Cult",
      "Alex Visconti – Wanna Be Your Everything",
      "Light Blue File – Just Like That (Car Mix)",
      "System – Escape from Reality (2002)",
      "Swin – Stay At Home",
    ]);
  });

  it("preserves a colon that is part of a real track title", () => {
    expect(texts("Escape: The Remix\nSome Artist\nCopyright")).toEqual([
      "Some Artist – Escape: The Remix",
    ]);
  });

  it("handles a variable status line (e.g. 'Blocking...') without desyncing", () => {
    // The 3rd boilerplate line varies per claim; anchoring on "Copyright"
    // keeps every block aligned even when it's not "No impact to your video."
    const raw = `Phazzled
Innerspace Halflife
Copyright
Audio
No impact to your video.

View details

Take action
Shame (12" Disco Version)
Evelyn "Champagne" King
Copyright
Audio
Blocking the video in some territories.

View details

Take action
Red Trip
Suntrust
Copyright
Audio
No impact to your video.

View details

Take action`;
    expect(texts(raw)).toEqual([
      "Innerspace Halflife – Phazzled",
      'Evelyn "Champagne" King – Shame (12" Disco Version)',
      "Suntrust – Red Trip",
    ]);
  });

  it("keeps a dangling track with only one header line before Copyright", () => {
    expect(texts("Lonely Track\nCopyright")).toEqual(["Lonely Track"]);
  });

  it("captures a final track with NO trailing Copyright (cut-off paste)", () => {
    const raw = `Oasis Thirteen
Oasis
Copyright
Audio
No impact to your video.

View details

Take action
That Feeling Again
Placid Angles
Copyright
Audio
No impact to your video.

View details

Take action
talking it out
glob deejay`;
    expect(texts(raw)).toEqual([
      "Oasis – Oasis Thirteen",
      "Placid Angles – That Feeling Again",
      "glob deejay – talking it out",
    ]);
  });

  it("returns an empty array for pure noise / whitespace", () => {
    expect(texts("   \n\n  ")).toEqual([]);
    expect(texts("Just some text with no anchor")).toEqual([]);
  });

  it("returns TrackId objects (not bare strings), all non-private", () => {
    expect(parseTrackIds("Nite Roads\nJovonn\nCopyright")).toEqual([
      { text: "Jovonn – Nite Roads", private: false },
    ]);
  });
});

describe("normalizeTrackIds", () => {
  it("coerces a legacy string[] into non-private TrackId objects", () => {
    expect(normalizeTrackIds(["Jovonn – Nite Roads", "Mr. Ho – Bail-E"])).toEqual([
      { text: "Jovonn – Nite Roads", private: false },
      { text: "Mr. Ho – Bail-E", private: false },
    ]);
  });

  it("passes objects through, coercing private to boolean, dropping blanks/junk", () => {
    expect(
      normalizeTrackIds([
        { text: "A – B", private: true },
        { text: "C – D" },
        { text: "   " },
        "",
        42,
        null,
        { nope: 1 },
      ])
    ).toEqual([
      { text: "A – B", private: true },
      { text: "C – D", private: false },
    ]);
  });

  it("returns [] for non-array input", () => {
    expect(normalizeTrackIds(undefined)).toEqual([]);
    expect(normalizeTrackIds(null)).toEqual([]);
  });
});

describe("publicTrackIds", () => {
  it("masks private track text with the public label, leaves others intact", () => {
    expect(
      publicTrackIds([
        { text: "Jovonn – Nite Roads", private: false },
        { text: "Secret – Hidden", private: true },
      ])
    ).toEqual([
      { text: "Jovonn – Nite Roads", private: false },
      { text: PRIVATE_TRACK_LABEL, private: true },
    ]);
  });

  it("is idempotent (masking already-masked data is a no-op)", () => {
    const once = publicTrackIds([{ text: "Secret", private: true }]);
    expect(publicTrackIds(once)).toEqual(once);
  });
});

describe("buildTracklistReply", () => {
  it("headers with show + dj and lists each track, masking private ones", () => {
    const reply = buildTracklistReply({
      showName: "Dissolved Sound",
      djs: [{ name: "J. Albert" }],
      trackIds: [
        { text: "J. Albert – Warped Mirror", private: false },
        { text: "Secret – Hidden", private: true },
      ],
    });
    expect(reply).toBe(
      `Tracklist for Dissolved Sound by J. Albert:\nJ. Albert – Warped Mirror\n${PRIVATE_TRACK_LABEL}`
    );
  });

  it("accepts legacy string[] trackIds", () => {
    const reply = buildTracklistReply({
      showName: "Old Show",
      djs: [{ name: "DJ X" }],
      trackIds: ["A – B"] as unknown as never,
    });
    expect(reply).toBe("Tracklist for Old Show by DJ X:\nA – B");
  });

  it("falls back gracefully when there is no tracklist", () => {
    expect(buildTracklistReply({ showName: "Empty", djs: [], trackIds: [] })).toBe(
      "No tracklist available for Empty yet."
    );
  });
});
