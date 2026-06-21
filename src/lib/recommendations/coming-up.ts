/**
 * "Coming up this week" — server helper (I/O).
 *
 * Window = now → next Sunday 7am PT. Returns two kinds of rows in one list:
 *   - ONLINE shows (broadcast-slots): any scheduled slot with a real DJ
 *     (dropped if no DJ or DJ === 'channelbroadcast'). Reason: "New · {dj}".
 *     Logged-in: only DJs the user engaged/watchlisted. Logged-out: all.
 *   - IRL events (events): city-gated for logged-in ("{dj} · {city}" or
 *     "In {city}"); logged-out shows all.
 *
 * Self-contained (does NOT touch /api/schedule). Reuses matchesCity.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { IRLShowData } from "@/types";
import { matchesCity } from "@/lib/city-detection";

export interface ComingUpRow extends IRLShowData {
  reason: string; // "New · {dj}" | "{dj} · {city}" | "In {city}"
  isIRL: boolean; // true = in-person event, false = online radio show
  startMs: number; // for chronological sort across online + IRL
  station?: string; // online shows: station label for the badge (e.g. "Channel")
}

const normUser = (u?: string) => (u ? u.replace(/[\s-]+/g, "").toLowerCase() : "");

function slotStartMs(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  const ts = value as { _seconds?: number; toMillis?: () => number; toDate?: () => Date } | undefined;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?._seconds === "number") return ts._seconds * 1000;
  const fromToDate = ts?.toDate?.()?.getTime();
  if (typeof fromToDate === "number") return fromToDate;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

// The END of "this week": the NEXT Sunday 07:00 America/Los_Angeles strictly in
// the future. If today is already Sunday (even before 7am), we want the NEXT
// Sunday — "this week" always spans a full week ending Sunday morning, never
// collapses to today. DST-safe (steps in real hours, reads PT wall-clock).
export function nextSunday7amPtMs(nowMs: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  // Start scanning from at least ~12h ahead so a Sunday-morning "now" doesn't
  // immediately match today's 7am. Scan hour by hour out to 8 days.
  for (let h = 12; h <= 200; h++) {
    const t = nowMs + h * 60 * 60 * 1000;
    const parts = fmt.formatToParts(new Date(t));
    const wd = parts.find((p) => p.type === "weekday")?.value;
    const hr = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    if (wd === "Sun" && hr >= 7 && hr < 9) {
      return t - (t % (60 * 60 * 1000)); // snap to top of that PT hour
    }
  }
  return nowMs + 7 * 24 * 60 * 60 * 1000; // safety fallback
}

interface FetchComingUpArgs {
  db: Firestore;
  nowMs: number;
  // null = logged-out → no city gate (show all upcoming events).
  userCity: string | null;
  // normalized engaged/watchlist DJ usernames (for the "{dj} · {city}" reason).
  engagedDjUsernames: Set<string>;
}

const ptDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

export async function fetchComingUp(args: FetchComingUpArgs): Promise<ComingUpRow[]> {
  const { db, nowMs, userCity, engagedDjUsernames } = args;
  const windowEnd = nextSunday7amPtMs(nowMs);
  const floor = nowMs - 12 * 60 * 60 * 1000; // small back-look so "today" shows
  const rows: ComingUpRow[] = [];

  // ── Online shows (broadcast-slots) ──────────────────────────────────────
  const slotSnap = await db.collection("broadcast-slots").where("status", "==", "scheduled").get();
  type SlotCand = { djUsername: string; djName: string; showName: string; showImageUrl?: string; startMs: number };
  const slotCands: SlotCand[] = [];
  for (const doc of slotSnap.docs) {
    const x = doc.data();
    const djUsername = x.djUsername as string | undefined;
    const djName = (x.djName as string | undefined) || djUsername;
    if (!djUsername || djUsername === "channelbroadcast") continue; // no DJ / test acct
    const startMs = slotStartMs(x.startTime);
    if (typeof startMs !== "number" || startMs < floor || startMs > windowEnd) continue;
    const engaged = engagedDjUsernames.has(normUser(djUsername));
    if (userCity !== null && !engaged) continue; // logged-in: engaged DJs only
    slotCands.push({
      djUsername,
      djName: djName || "",
      showName: (x.showName as string) || djName || "",
      showImageUrl: (x.showImageUrl as string) || undefined,
      startMs,
    });
  }

  // Resolve, per online slot, the display name + photo to show when the slot
  // has no showImageUrl. A slot's djUsername may be a collective SLUG → use the
  // collective name + photo; otherwise resolve the DJ's profile photo from
  // users (then pending-dj-profiles) by chatUsernameNormalized. Mirrors the
  // go-live cron's lookup approach. Batched.
  const collectiveBySlug = new Map<string, { name?: string; photoUrl?: string }>();
  const djPhotoByNorm = new Map<string, string>();
  const slugs = Array.from(new Set(slotCands.map((s) => s.djUsername)));
  const norms = Array.from(new Set(slotCands.map((s) => normUser(s.djUsername))));

  for (let i = 0; i < slugs.length; i += 10) {
    const batch = slugs.slice(i, i + 10);
    const results = await Promise.all(
      batch.map((slug) => db.collection("collectives").where("slug", "==", slug).limit(1).get()),
    );
    results.forEach((snap, j) => {
      if (snap.empty) return;
      const c = snap.docs[0].data();
      // Collective image: own photo (field is `photo`), else a resident DJ's photo.
      const residents = (c.residentDJs as Array<{ djPhotoUrl?: string }> | undefined) || [];
      const residentPhoto = residents.find((r) => r.djPhotoUrl)?.djPhotoUrl;
      collectiveBySlug.set(batch[j], {
        name: (c.name as string) || undefined,
        photoUrl:
          (c.photo as string) || (c.photoUrl as string) || (c.image as string) || residentPhoto || undefined,
      });
    });
  }

  // DJ profile photos (users first, then pending-dj-profiles) by normalized name.
  for (const coll of ["users", "pending-dj-profiles"]) {
    for (let i = 0; i < norms.length; i += 10) {
      const batch = norms.slice(i, i + 10).filter((n) => !djPhotoByNorm.has(n));
      if (batch.length === 0) continue;
      const results = await Promise.all(
        batch.map((n) => db.collection(coll).where("chatUsernameNormalized", "==", n).limit(1).get()),
      );
      results.forEach((snap, j) => {
        if (snap.empty) return;
        const u = snap.docs[0].data();
        const photo = (u.djProfile as Record<string, unknown> | undefined)?.photoUrl as string | undefined;
        if (photo) djPhotoByNorm.set(batch[j], photo);
      });
    }
  }

  for (const s of slotCands) {
    const collective = collectiveBySlug.get(s.djUsername);
    const displayName = collective?.name || s.djName;
    // Image fallback chain: show image → collective photo → DJ profile photo.
    const photo = s.showImageUrl || collective?.photoUrl || djPhotoByNorm.get(normUser(s.djUsername));
    rows.push({
      djUsername: s.djUsername,
      djName: displayName,
      djPhotoUrl: photo,
      eventName: s.showName,
      location: "Online",
      ticketUrl: "",
      date: ptDate(s.startMs),
      eventPhotoUrl: photo,
      venueName: undefined,
      allDjs: [{ djUsername: s.djUsername, djName: displayName }],
      reason: `New · ${displayName}`,
      isIRL: false,
      startMs: s.startMs,
      station: "Channel",
    });
  }

  // ── IRL events ──────────────────────────────────────────────────────────
  const startOfToday = new Date(nowMs);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const evSnap = await db
    .collection("events")
    .where("date", ">=", startOfToday.getTime())
    .where("date", "<=", windowEnd)
    .get();
  for (const doc of evSnap.docs) {
    const data = doc.data();
    const location = data.location as string | undefined;
    if (!location) continue;
    if (typeof data.date !== "number" || data.date > windowEnd) continue;

    // City gate (logged-in). Logged-out (userCity null) shows everything.
    if (userCity && !matchesCity(location, userCity)) continue;

    const djs = (data.djs as Array<{ djName?: string; djUsername?: string; djPhotoUrl?: string }>) || [];
    const firstDj = djs[0];
    const engagedDj = djs.find((d) => normUser(d.djUsername) && engagedDjUsernames.has(normUser(d.djUsername)));
    const reason = engagedDj?.djName ? `${engagedDj.djName} · ${location}` : `In ${location}`;

    rows.push({
      djUsername: firstDj?.djUsername || "",
      djName: firstDj?.djName || (data.name as string) || "",
      djPhotoUrl: firstDj?.djPhotoUrl,
      eventName: (data.name as string) || "",
      location,
      ticketUrl: (data.ticketLink as string) || "",
      date: ptDate(data.date),
      eventPhotoUrl: (data.photo as string) || undefined,
      venueName: (data.venueName as string) || undefined,
      allDjs: djs.filter((d) => d.djUsername && d.djName).map((d) => ({ djUsername: d.djUsername!, djName: d.djName! })),
      reason,
      isIRL: true,
      startMs: data.date,
    });
  }

  rows.sort((a, b) => a.startMs - b.startMs);
  return rows;
}
