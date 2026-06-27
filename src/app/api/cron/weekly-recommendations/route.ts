import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { ArchiveSerialized } from "@/types/broadcast";
import { buildScenePayload } from "@/lib/recommendations/scene-payload";
import { generateForUser, loadSharedData, loadConfig } from "@/lib/recommendations/server";
import { buildFeaturedMatrix } from "@/lib/recommendations/featured-matrix";
import {
  sendWeeklyRecommendationsEmail,
  type WeeklyRecArchiveRow,
  type WeeklyRecComingUpRow,
} from "@/lib/email";

// Weekly recommendation email — Tue 10am PT (vercel.json `0 17 * * 2`).
// Mirrors /scene over email per user:
//   1. New from your favorites  (engine `favorite-artists`, max 2)
//   2. In your scene            (engine `discovery`, max 2)
//   3. Coming up this week      (everything — online + IRL, via buildScenePayload)
// Always sends; empty personalized sections fall back to the logged-out
// featured matrix (6 shows, excluding the "Intense"/very_fast tempo).
//
// Gating: emailNotifications.weeklyRecommendations !== false (default on).
// No-repeat: section 1/2 picks are deduped against lastWeeklyRecShows so a user
// doesn't see the same archive two weeks running; sends stamp the map.
//
// Params: ?dryRun=1 (compute, send nothing), ?previewTo=<email> (send ONE real
// email to that address, stamp nothing), ?shard=N&shardCount=M (split the run).

export const maxDuration = 300;

const cronSecret = process.env.CRON_SECRET || "";

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  return isVercelCron || authHeader === `Bearer ${cronSecret}`;
}

const SECTION_CAP = 2;
const RECENT_RETENTION_MS = 21 * 24 * 60 * 60 * 1000; // prune lastWeeklyRecShows after ~3 weeks

function uidInShard(uid: string, shard: number, shardCount: number): boolean {
  if (shardCount <= 1) return true;
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return h % shardCount === shard;
}

function archiveToRow(a: ArchiveSerialized, sceneLabel?: string): WeeklyRecArchiveRow {
  const dj = a.djs?.[0];
  return {
    slug: a.slug,
    showName: a.showName,
    djName: dj?.name,
    djUsername: dj?.username,
    djPhotoUrl: dj?.photoUrl,
    showImageUrl: a.showImageUrl,
    sceneLabel,
  };
}

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
  const previewTo = params.get("previewTo")?.toLowerCase() || undefined;
  const shard = params.get("shard") != null ? Number(params.get("shard")) : null;
  const shardCount = Number(params.get("shardCount")) || 1;
  const traceLimit = Number(params.get("traceLimit")) || 50;

  const nowMs = Date.now();

  try {
    // Featured fallback matrix, built ONCE (excludes very_fast = "Intense" → 6).
    const archivesSnap = await db.collection("archives").get();
    const allArchives: ArchiveSerialized[] = archivesSnap.docs.map(
      (d) => ({ id: d.id, ...(d.data() as Omit<ArchiveSerialized, "id">) }) as ArchiveSerialized,
    );
    const featured = buildFeaturedMatrix(allArchives, { excludeTempos: ["very_fast"] });
    const featuredRows = featured.map((a) => archiveToRow(a));

    // Load the shared catalog ONCE for the whole run, so per-user snapshot
    // generation reuses it instead of re-scanning archives/DJs/collectives/slots
    // for every user. Generation respects the 24h floor (skips users with a
    // fresh snapshot — e.g. one made by a recent /scene visit). Skipped in
    // dry-run so it stays a pure read.
    const sharedData = dryRun ? null : await loadSharedData(db, nowMs);
    const recConfig = dryRun ? null : await loadConfig(db);

    const usersSnap = await db.collection("users").get();

    let emailsSent = 0;
    let skippedOptOut = 0;
    let skippedNoEmail = 0;
    let failed = 0;
    type Trace = { email: string; s1: number; s2: number; comingUp: number; fallback: boolean };
    const trace: Trace[] = [];

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const email = data.email as string | undefined;
      if (!email) { skippedNoEmail++; continue; }
      const en = data.emailNotifications as Record<string, unknown> | undefined;
      if (en?.weeklyRecommendations === false) { skippedOptOut++; continue; }
      if (shard != null && !uidInShard(userDoc.id, shard, shardCount)) continue;

      // previewTo: only process the one preview recipient (sends a real email,
      // stamps nothing). All others are skipped entirely in preview mode.
      if (previewTo && email.toLowerCase() !== previewTo) continue;

      try {
        // "About to email this user" = a generate-and-store event: refresh their
        // stored snapshot if it's older than the 24h floor (reusing the shared
        // catalog), else reuse the existing one. Then render the email from it —
        // so the same fresh snapshot serves both the email and their next /scene
        // visit. In dry-run we skip generation and just read (pure).
        let prebuilt;
        if (!dryRun && sharedData && recConfig) {
          const outcome = await generateForUser(
            db,
            userDoc.id,
            "website",
            { persist: true, generatedBy: "cron" },
            sharedData,
            recConfig,
          );
          prebuilt = outcome.snapshot;
        }
        const payload = await buildScenePayload(db, userDoc.id, prebuilt);

        const seen = (data.lastWeeklyRecShows as Record<string, string> | undefined) || {};
        const pickSection = (id: string): WeeklyRecArchiveRow[] => {
          const sec = payload.sections.find((s) => s.id === id);
          if (!sec) return [];
          return sec.archives
            .filter((a) => !seen[a.id]) // no-repeat vs last sends
            .slice(0, SECTION_CAP)
            .map((a) => {
              const band = sec.bandByArchiveId[a.id];
              return archiveToRow(a, band?.glyphSlug || undefined);
            });
        };

        let section1 = pickSection("favorite-artists");
        const section2 = pickSection("discovery");

        // Fallback: if BOTH personalized archive sections are empty, show the
        // featured matrix in section 1 (isFallback hides section 2 so we don't
        // double-render the same grid).
        const isFallback = section1.length === 0 && section2.length === 0;
        if (isFallback) section1 = featuredRows;

        const comingUp: WeeklyRecComingUpRow[] = payload.comingUp.map((r) => ({
          showName: r.eventName || r.djName || "",
          djName: r.djName,
          djUsername: r.djUsername,
          djPhotoUrl: r.djPhotoUrl,
          showImageUrl: r.eventPhotoUrl,
          stationId: "broadcast",
          startTime: new Date(r.startMs).toISOString(),
          isIRL: r.isIRL,
          linkUrl: r.isIRL ? (r.ticketUrl || r.linkUrl) : r.linkUrl,
        }));

        if (dryRun && !previewTo) {
          if (trace.length < traceLimit) {
            trace.push({ email, s1: section1.length, s2: section2.length, comingUp: comingUp.length, fallback: isFallback });
          }
          emailsSent++; // count as would-send
          continue;
        }

        const ok = await sendWeeklyRecommendationsEmail({
          to: email,
          userTimezone: data.timezone as string | undefined,
          section1,
          section2: isFallback ? [] : section2,
          comingUp,
          isFallback,
          recipientUid: userDoc.id, // CTA deep-links the recipient's own /scene
        });

        if (!ok) { failed++; continue; }
        emailsSent++;

        // previewTo sends but never stamps (so it doesn't suppress the real send).
        if (previewTo) continue;

        // Stamp: dedup map + last-sent timestamp. Prune old entries.
        const updatedSeen: Record<string, string> = {};
        const cutoff = nowMs - RECENT_RETENTION_MS;
        for (const [id, iso] of Object.entries(seen)) {
          if (Date.parse(iso) >= cutoff) updatedSeen[id] = iso;
        }
        const nowIso = new Date(nowMs).toISOString();
        if (!isFallback) {
          for (const r of [...section1, ...section2]) {
            const a = allArchives.find((x) => x.slug === r.slug);
            if (a) updatedSeen[a.id] = nowIso;
          }
        }
        await userDoc.ref.set(
          { lastWeeklyRecEmailAt: FieldValue.serverTimestamp(), lastWeeklyRecShows: updatedSeen },
          { merge: true },
        );
      } catch (e) {
        failed++;
        console.error(`[weekly-recommendations] ${userDoc.id}:`, e);
      }
    }

    return NextResponse.json({
      dryRun,
      previewTo: previewTo ?? null,
      shard,
      usersScanned: usersSnap.size,
      emailsSent,
      skippedOptOut,
      skippedNoEmail,
      failed,
      featuredCount: featuredRows.length,
      trace: dryRun && !previewTo ? trace : undefined,
    });
  } catch (error) {
    console.error("[weekly-recommendations] Error:", error);
    return NextResponse.json({ error: "Failed to process weekly recommendations" }, { status: 500 });
  }
}
