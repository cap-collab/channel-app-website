import { NextRequest, NextResponse } from "next/server";
import { MetadataResponse } from "@/types";
import { getStationByMetadataKey } from "@/lib/stations";

const HISTORY_URL =
  "https://cap-collab.github.io/channel-metadata/history.json";

// In-memory cache (same pattern as metadata.ts)
let cachedHistory: MetadataResponse | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function fetchHistory(): Promise<MetadataResponse> {
  const now = Date.now();
  if (cachedHistory && now - cacheTimestamp < CACHE_DURATION) {
    return cachedHistory;
  }

  const res = await fetch(HISTORY_URL, { next: { revalidate: 300 } });
  if (!res.ok) {
    throw new Error(`Failed to fetch history: ${res.status}`);
  }

  const data: MetadataResponse = await res.json();
  cachedHistory = data;
  cacheTimestamp = Date.now();
  return data;
}

interface PastShowResponse {
  id: string;
  showName: string;
  startTime: string;
  endTime: string;
  stationId: string;
  stationName: string;
  showType?: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Single DJ lookup
  const dj = searchParams.get("dj");
  // Multi-DJ lookup (comma-separated)
  const djsParam = searchParams.get("djs");

  if (!dj && !djsParam) {
    return NextResponse.json(
      { error: "Missing dj or djs parameter" },
      { status: 400 }
    );
  }

  const djUsernames = new Set<string>();
  if (dj) djUsernames.add(dj.toLowerCase());
  if (djsParam) {
    djsParam.split(",").forEach((u) => {
      const trimmed = u.trim().toLowerCase();
      if (trimmed) djUsernames.add(trimmed);
    });
  }

  try {
    const history = await fetchHistory();
    const shows: PastShowResponse[] = [];

    for (const [metadataKey, stationShows] of Object.entries(
      history.stations
    )) {
      const station = getStationByMetadataKey(metadataKey);
      const stationId = station?.id || metadataKey;
      const stationName = station?.name || metadataKey;

      for (const show of stationShows) {
        if (!show.p || !djUsernames.has(show.p.toLowerCase())) continue;

        shows.push({
          id: `${stationId}-${show.s}`,
          showName: show.n,
          startTime: show.s,
          endTime: show.e,
          stationId,
          stationName,
          showType: show.t || undefined,
        });
      }
    }

    // Sort by endTime descending (newest first)
    shows.sort(
      (a, b) =>
        new Date(b.endTime).getTime() - new Date(a.endTime).getTime()
    );

    return NextResponse.json({ shows });
  } catch (error) {
    console.error("[past-shows] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch past shows" },
      { status: 500 }
    );
  }
}
