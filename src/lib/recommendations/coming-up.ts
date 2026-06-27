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
  // null = logged-out → no city gate on IRL events.
  userCity: string | null;
  // normalized engaged/watchlist DJ usernames (for the "{dj} · {city}" reason).
  engagedDjUsernames: Set<string>;
  // normalized DJ usernames the user muted → hide their shows/events.
  goLiveMutes?: Set<string>;
  // the user's own normalized username → hide their own shows.
  ownDjUsername?: string;
}

const ptDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

// ── Shared (user-agnostic) coming-up data ─────────────────────────────────────
// The slot/event/photo fetches below are identical for every user (only the city
// gate, mutes, and reason labels are per-user). They're the expensive part — the
// DJ/collective photo fan-out is several batched round-trips. We resolve them
// ONCE per ~5-min window and memoize in-process (mirrors the featured route), so
// concurrent /scene loads and the weekly-recs cron's per-user loop reuse it.

// An online slot, with its display name + photo already resolved (user-agnostic).
interface SharedOnlineCand {
  djUsername: string;
  norm: string; // normUser(djUsername), precomputed for the per-user mute/own gate
  displayName: string;
  photo?: string;
  showName: string;
  startMs: number;
}
// A raw IRL event row carried through to the per-user filter (which applies the
// city gate, mute/own gate, and engaged-DJ reason label).
interface SharedEvent {
  location: string;
  date: number;
  name: string;
  ticketLink?: string;
  photo?: string;
  venueName?: string;
  djs: Array<{ djName?: string; djUsername?: string; djPhotoUrl?: string }>;
}
export interface ComingUpShared {
  online: SharedOnlineCand[];
  events: SharedEvent[];
}

const SHARED_TTL_MS = 5 * 60 * 1000; // 5 min — covers the UTC-midnight + Sun-7am-PT rollovers
let sharedCache: { at: number; data: ComingUpShared } | null = null;

export async function loadComingUpShared(db: Firestore, nowMs: number): Promise<ComingUpShared> {
  if (sharedCache && nowMs - sharedCache.at < SHARED_TTL_MS) return sharedCache.data;

  const windowEnd = nextSunday7amPtMs(nowMs);
  // Cache-time floor keeps a small back-look so a slot near "now" is captured in
  // the shared snapshot; the actual "already started" hide happens per-request in
  // filterComingUpForUser against the LIVE now (the cache is up to 5 min stale).
  const floor = nowMs - 12 * 60 * 60 * 1000;

  // ── Online shows (broadcast-slots) ──────────────────────────────────────
  // All upcoming online shows except the channelbroadcast test account. Mute /
  // own-show exclusion is per-user → applied later in filterComingUpForUser.
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

  const online: SharedOnlineCand[] = slotCands.map((s) => {
    const collective = collectiveBySlug.get(s.djUsername);
    const displayName = collective?.name || s.djName;
    // Image fallback chain: show image → collective photo → DJ profile photo.
    const photo = s.showImageUrl || collective?.photoUrl || djPhotoByNorm.get(normUser(s.djUsername));
    return {
      djUsername: s.djUsername,
      norm: normUser(s.djUsername),
      displayName,
      photo,
      showName: s.showName,
      startMs: s.startMs,
    };
  });

  // ── IRL events ──────────────────────────────────────────────────────────
  const startOfToday = new Date(nowMs);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const evSnap = await db
    .collection("events")
    .where("date", ">=", startOfToday.getTime())
    .where("date", "<=", windowEnd)
    .get();
  const events: SharedEvent[] = [];
  for (const doc of evSnap.docs) {
    const data = doc.data();
    const location = data.location as string | undefined;
    if (!location) continue;
    if (typeof data.date !== "number" || data.date > windowEnd) continue;
    events.push({
      location,
      date: data.date,
      name: (data.name as string) || "",
      ticketLink: (data.ticketLink as string) || undefined,
      photo: (data.photo as string) || undefined,
      venueName: (data.venueName as string) || undefined,
      djs: (data.djs as SharedEvent["djs"]) || [],
    });
  }

  const data: ComingUpShared = { online, events };
  sharedCache = { at: nowMs, data };
  return data;
}

// Pure per-user filter over the shared data: mute/own-show exclusion, IRL city
// gate, and engaged-DJ reason label. Returns a fresh sorted array — never
// mutates the shared arrays (safe to call repeatedly in the cron loop).
export function filterComingUpForUser(
  shared: ComingUpShared,
  args: Omit<FetchComingUpArgs, "db">,
): ComingUpRow[] {
  const { nowMs, userCity, engagedDjUsernames, goLiveMutes, ownDjUsername } = args;
  const muted = goLiveMutes ?? new Set<string>();
  const rows: ComingUpRow[] = [];

  for (const s of shared.online) {
    // "Upcoming" = hasn't started yet. The shared data is cached up to ~5 min, so
    // hide already-started ONLINE shows here against the live now (IRL events are
    // left as-is — today's IRL events still show).
    if (s.startMs < nowMs) continue;
    if (muted.has(s.norm)) continue; // user muted this DJ
    if (ownDjUsername && s.norm === ownDjUsername) continue; // user's own show
    rows.push({
      djUsername: s.djUsername,
      djName: s.displayName,
      djPhotoUrl: s.photo,
      eventName: s.showName,
      location: "Online",
      ticketUrl: "",
      date: ptDate(s.startMs),
      eventPhotoUrl: s.photo,
      venueName: undefined,
      allDjs: [{ djUsername: s.djUsername, djName: s.displayName }],
      reason: `New · ${s.displayName}`,
      isIRL: false,
      startMs: s.startMs,
      station: "Channel",
    });
  }

  const todayPt = ptDate(nowMs); // YYYY-MM-DD in PT
  for (const ev of shared.events) {
    // Hide events whose DAY (in PT) is already past — keep an event through the
    // end of its calendar day, drop it the next day. Checked per-request against
    // the live now (shared data is cached up to ~5 min). YYYY-MM-DD string
    // compare is chronological.
    if (ptDate(ev.date) < todayPt) continue;
    // City gate (logged-in). Logged-out (userCity null) shows everything.
    if (userCity && !matchesCity(ev.location, userCity)) continue;

    const djs = ev.djs;
    // Hide if ANY lineup DJ is muted or is the user's own.
    const lineupNorms = djs.map((d) => normUser(d.djUsername)).filter(Boolean);
    if (lineupNorms.some((n) => muted.has(n) || n === ownDjUsername)) continue;
    const firstDj = djs[0];
    const engagedDj = djs.find((d) => normUser(d.djUsername) && engagedDjUsernames.has(normUser(d.djUsername)));
    const reason = engagedDj?.djName ? `${engagedDj.djName} · ${ev.location}` : `In ${ev.location}`;

    rows.push({
      djUsername: firstDj?.djUsername || "",
      djName: firstDj?.djName || ev.name,
      djPhotoUrl: firstDj?.djPhotoUrl,
      eventName: ev.name,
      location: ev.location,
      ticketUrl: ev.ticketLink || "",
      date: ptDate(ev.date),
      eventPhotoUrl: ev.photo,
      venueName: ev.venueName,
      allDjs: djs.filter((d) => d.djUsername && d.djName).map((d) => ({ djUsername: d.djUsername!, djName: d.djName! })),
      reason,
      isIRL: true,
      startMs: ev.date,
    });
  }

  rows.sort((a, b) => a.startMs - b.startMs);
  return rows;
}

// Thin wrapper: load (cached) shared data + apply the per-user filter. Existing
// call sites (scene-payload, featured route) keep their signature unchanged.
export async function fetchComingUp(args: FetchComingUpArgs): Promise<ComingUpRow[]> {
  const { db, ...userArgs } = args;
  const shared = await loadComingUpShared(db, args.nowMs);
  return filterComingUpForUser(shared, userArgs);
}
