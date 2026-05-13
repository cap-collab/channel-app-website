import { NextRequest, NextResponse } from "next/server";
import { MetadataResponse, ShowV2 } from "@/types";
import { getStationByMetadataKey, getStationById } from "@/lib/stations";
import vpnHistoryStatic from "../../../../public/vpn-history.json";

const HISTORY_URL =
  "https://cap-collab.github.io/channel-metadata/history.json";

// Past VPN entries are bundled in this repo (channel-media doesn't archive VPN).
function loadVPNHistory(): ShowV2[] {
  return Array.isArray(vpnHistoryStatic) ? (vpnHistoryStatic as unknown as ShowV2[]) : [];
}

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

  // Merge VPN history (bundled in this repo — channel-media doesn't archive VPN).
  const vpnHistory = loadVPNHistory();
  if (vpnHistory.length > 0) {
    data.stations = { ...data.stations, vpn: vpnHistory };
  }

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
  showImageUrl?: string;
  // Linked profiles from metadata: p (primary) + ap (additional). Each is
  // a normalized username; the client renders them as clickable Links.
  djUsername?: string;
  additionalDjUsernames?: string[];
  // Display name parallel to djUsername (from the show's "pName" field, or "j" as fallback).
  djName?: string;
  // Display names parallel to additionalDjUsernames (when provided).
  additionalDjNames?: string[];
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

  // Station-collective awareness: if any of the requested usernames matches a station id,
  // include every show from that station (used so /dj/vpn surfaces all VPN past shows).
  const stationIdMatches = new Set<string>();
  Array.from(djUsernames).forEach((u) => {
    if (getStationById(u)) stationIdMatches.add(u);
  });

  try {
    const history = await fetchHistory();
    const shows: PastShowResponse[] = [];

    for (const [metadataKey, stationShows] of Object.entries(
      history.stations
    )) {
      const station = getStationByMetadataKey(metadataKey);
      const stationId = station?.id || metadataKey;
      const stationName = station?.name || metadataKey;
      const stationMatches = stationIdMatches.has(stationId);

      for (const show of stationShows) {
        // Skip replays and playlists
        if (show.t === 'restream' || show.t === 'playlist') continue;

        // Match by primary profile (p), additional profiles (ap), or station-collective.
        const primaryMatch = show.p && djUsernames.has(show.p.toLowerCase());
        const additionalMatch = !primaryMatch && show.ap?.some(
          (slug: string) => djUsernames.has(slug.toLowerCase())
        );
        if (!primaryMatch && !additionalMatch && !stationMatches) continue;

        shows.push({
          id: `${stationId}-${show.s}`,
          showName: show.n,
          startTime: show.s,
          endTime: show.e,
          stationId,
          stationName,
          showType: show.t || undefined,
          showImageUrl: show.u || undefined,
          // Prefer the explicit pName field for the primary chip label; fall back to j
          // for older entries that don't carry a separate display name.
          djName: show.pName || show.j || undefined,
          djUsername: show.p || undefined,
          additionalDjUsernames: show.ap && show.ap.length > 0 ? show.ap : undefined,
          additionalDjNames: show.apNames && show.apNames.length > 0 ? show.apNames : undefined,
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
