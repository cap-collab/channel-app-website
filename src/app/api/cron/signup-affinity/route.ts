import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeUsername } from "@/lib/dj-matching";

// Daily "fan info" capture. A lot of signups happen because a specific DJ /
// collective is live. This cron looks at users created since the last run,
// finds what Channel Radio show was airing at each user's createdAt, and
// records a love for that DJ/collective — so the signup counts as engagement
// in go-live emails + recommendations (both read loveHistory). It also stamps
// signedUpDuring on the user doc for attribution.
//
// One cron, zero signup-path changes. Window-based airing match (not status)
// so it catches live shows AND anchors/collectives, which never flip to
// status:'live'. Idempotent: skips users already stamped with signedUpDuring.
//
// Query params (admin/manual):
//   ?days=N   widen the lookback to N days (default 2) — use once for backfill
//   ?dryRun=1 compute + return what WOULD be written, write nothing

const cronSecret = process.env.CRON_SECRET || "";

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  return isVercelCron || authHeader === `Bearer ${cronSecret}`;
}

// Coerce any Firestore time shape to millis (Timestamp, flattened {_seconds},
// Date, ISO string, number). 0 = missing/unparseable (treat as "unknown").
function coerceMs(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    const o = v as { toMillis?: () => number; seconds?: number; _seconds?: number; nanoseconds?: number; _nanoseconds?: number };
    if (typeof o.toMillis === "function") return o.toMillis();
    const s = o.seconds ?? o._seconds;
    if (typeof s === "number") return s * 1000 + Math.floor((o.nanoseconds ?? o._nanoseconds ?? 0) / 1e6);
    if (v instanceof Date) return v.getTime();
  }
  const p = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(p) ? 0 : p;
}

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const params = request.nextUrl.searchParams;
  const dryRun = params.get("dryRun") === "1";
  const days = Number(params.get("days")) || 2;
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  try {
    // 1. New users in the window who haven't been attributed yet.
    const usersSnap = await db
      .collection("users")
      .where("createdAt", ">=", new Date(sinceMs))
      .get();

    // 2. Pre-load the candidate slots once: anything that started in the
    //    [sinceMs - 24h, now] range can contain a signup in [sinceMs, now].
    //    Filter precisely per-user below. (One read instead of one per user.)
    const slotsSnap = await db
      .collection("broadcast-slots")
      .where("startTime", ">=", new Date(sinceMs - 24 * 60 * 60 * 1000))
      .where("startTime", "<=", new Date())
      .get();
    const slots = slotsSnap.docs
      .map((d) => {
        const x = d.data();
        return {
          id: d.id,
          showName: (x.showName as string) || "",
          djName: (x.djName as string | undefined) || null,
          username: (x.liveDjUsername as string | undefined) || (x.djUsername as string | undefined) || null,
          djUserId: (x.liveDjUserId as string | undefined) || (x.djUserId as string | undefined) || null,
          djPhotoUrl: (x.liveDjPhotoUrl as string | undefined) || (x.showImageUrl as string | undefined) || null,
          broadcastType: (x.broadcastType as string | undefined) || "remote",
          startMs: coerceMs(x.startTime),
          endMs: coerceMs(x.endTime),
        };
      })
      .filter((s) => s.username && s.username !== "channelbroadcast" && s.broadcastType !== "recording" && s.startMs && s.endMs);

    // Find the slot airing at time T (latest start wins on overlap).
    const airingAt = (atMs: number) => {
      let best: (typeof slots)[number] | null = null;
      for (const s of slots) {
        if (atMs < s.startMs || atMs >= s.endMs) continue;
        if (!best || s.startMs > best.startMs) best = s;
      }
      return best;
    };

    let captured = 0, skippedStamped = 0, skippedNothing = 0, skippedOwn = 0, skippedDj = 0;
    const sample: string[] = [];

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      if (data.signedUpDuring) { skippedStamped++; continue; }
      // Listeners only — never auto-love on behalf of a DJ account (they didn't
      // "fan" anyone by signing up, and a DJ creating an account mid-show
      // shouldn't accrue engagement toward whoever's live).
      if (data.role === "dj") { skippedDj++; continue; }
      const createdMs = coerceMs(data.createdAt);
      if (!createdMs) continue;

      const slot = airingAt(createdMs);
      if (!slot || !slot.username) { skippedNothing++; continue; }
      if (slot.djUserId && slot.djUserId === userDoc.id) { skippedOwn++; continue; }

      captured++;
      if (sample.length < 30) {
        sample.push(`${data.email || userDoc.id} → ${slot.username} (${slot.broadcastType}, "${slot.showName}")`);
      }
      if (dryRun) continue;

      const username = slot.username;
      // Record a love (same shape as a real love → counts as engagement).
      await userDoc.ref.collection("loveHistory").doc(username).set(
        {
          djUsername: username,
          djUsernameNormalized: normalizeUsername(username),
          djDisplayName: slot.djName || username,
          loveCount: FieldValue.increment(1),
          firstLovedAt: FieldValue.serverTimestamp(),
          lastLovedAt: FieldValue.serverTimestamp(),
          source: "signup-live",
        },
        { merge: true },
      );
      // Stamp attribution on the user doc (also the idempotency guard).
      await userDoc.ref.set(
        {
          signedUpDuring: {
            djUsername: username,
            djUsernameNormalized: normalizeUsername(username),
            djUserId: slot.djUserId,
            showName: slot.showName,
            broadcastType: slot.broadcastType,
            slotId: slot.id,
            at: new Date(createdMs),
          },
        },
        { merge: true },
      );
    }

    return NextResponse.json({
      dryRun,
      lookbackDays: days,
      usersScanned: usersSnap.size,
      slotsConsidered: slots.length,
      captured,
      skippedStamped,
      skippedDj,
      skippedNothingAiring: skippedNothing,
      skippedOwnShow: skippedOwn,
      sample,
    });
  } catch (error) {
    console.error("[signup-affinity] Error:", error);
    return NextResponse.json({ error: "Failed to process signup affinity" }, { status: 500 });
  }
}
