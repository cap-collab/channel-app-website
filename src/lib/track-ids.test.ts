import { describe, it, expect } from "vitest";
import { parseTrackIds } from "./track-ids";

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

    expect(parseTrackIds(raw)).toEqual([
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
    expect(parseTrackIds("Escape: The Remix\nSome Artist\nCopyright")).toEqual([
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
    expect(parseTrackIds(raw)).toEqual([
      "Innerspace Halflife – Phazzled",
      'Evelyn "Champagne" King – Shame (12" Disco Version)',
      "Suntrust – Red Trip",
    ]);
  });

  it("keeps a dangling track with only one header line before Copyright", () => {
    expect(parseTrackIds("Lonely Track\nCopyright")).toEqual(["Lonely Track"]);
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
    expect(parseTrackIds(raw)).toEqual([
      "Oasis – Oasis Thirteen",
      "Placid Angles – That Feeling Again",
      "glob deejay – talking it out",
    ]);
  });

  it("returns an empty array for pure noise / whitespace", () => {
    expect(parseTrackIds("   \n\n  ")).toEqual([]);
    expect(parseTrackIds("Just some text with no anchor")).toEqual([]);
  });
});
