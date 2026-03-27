import { NextRequest } from "next/server";

interface EventDJ {
  djName: string;
  djUserId?: string;
  djUsername?: string;
  djPhotoUrl?: string;
}

interface EventData {
  name: string;
  date: number; // unix ms
  location: string;
  ticketLink?: string;
  djs: EventDJ[];
}

/**
 * Syncs an IRL event to all followers of each DJ in the event's lineup
 * by calling /api/dj/sync-shows-to-followers once per DJ.
 *
 * For creation: pass only `current`.
 * For update: pass both `current` and `previous` to diff DJ lists.
 * For deletion: pass only `previous`.
 */
export async function syncIRLEventToFollowers(
  request: NextRequest,
  current?: EventData,
  previous?: EventData,
): Promise<void> {
  // Need at least one of current/previous with location and DJs
  if (!current && !previous) return;
  if (current && (!current.location || current.djs.length === 0)) {
    // If no previous either, nothing to do
    if (!previous || !previous.location || previous.djs.length === 0) return;
  }

  const protocol = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || "localhost:3000";
  const baseUrl = `${protocol}://${host}`;

  function toIrlShow(event: EventData) {
    return {
      name: event.name,
      location: event.location,
      url: event.ticketLink || "",
      date: new Date(event.date).toISOString().split("T")[0],
    };
  }

  function djKey(dj: EventDJ): string {
    return dj.djUserId || dj.djUsername?.toLowerCase() || dj.djName.toLowerCase();
  }

  const currentDJs = current?.djs || [];
  const previousDJs = previous?.djs || [];

  // Build lookup maps
  const prevMap = new Map<string, EventDJ>();
  for (const dj of previousDJs) {
    prevMap.set(djKey(dj), dj);
  }
  const currMap = new Map<string, EventDJ>();
  for (const dj of currentDJs) {
    currMap.set(djKey(dj), dj);
  }

  const syncCalls: Promise<void>[] = [];

  const syncForDJ = (
    dj: EventDJ,
    irlShows: object[],
    previousIrlShows: object[],
  ) => {
    if (!dj.djUserId && !dj.djUsername) return; // can't sync without identity

    syncCalls.push(
      fetch(`${baseUrl}/api/dj/sync-shows-to-followers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          djUserId: dj.djUserId || "",
          djUsername: dj.djUsername || "",
          djName: dj.djName || "",
          djPhotoUrl: dj.djPhotoUrl || undefined,
          irlShows,
          radioShows: [],
          previousIrlShows,
          previousRadioShows: [],
        }),
      })
        .then(() => {})
        .catch((err) => {
          console.error(
            `[syncIRLEventToFollowers] Failed to sync for DJ ${dj.djName}:`,
            err,
          );
        }),
    );
  };

  // DJs added (in current but not in previous) — pure add
  currMap.forEach((dj, key) => {
    if (!prevMap.has(key)) {
      syncForDJ(dj, [toIrlShow(current!)], []);
    }
  });

  // DJs removed (in previous but not in current) — pure delete
  prevMap.forEach((dj, key) => {
    if (!currMap.has(key)) {
      syncForDJ(dj, [], [toIrlShow(previous!)]);
    }
  });

  // DJs retained (in both) — send update diff
  currMap.forEach((dj, key) => {
    if (prevMap.has(key)) {
      syncForDJ(dj, [toIrlShow(current!)], [toIrlShow(previous!)]);
    }
  });

  await Promise.allSettled(syncCalls);
}
