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

  it("keeps a dangling track with no artist line", () => {
    expect(parseTrackIds("Lonely Track")).toEqual(["Lonely Track"]);
  });

  it("returns an empty array for pure noise / whitespace", () => {
    expect(parseTrackIds("Copyright\nAudio\n\nView details")).toEqual([]);
    expect(parseTrackIds("   \n\n  ")).toEqual([]);
  });
});
