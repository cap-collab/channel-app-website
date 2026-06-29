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
import { getDjRecipients, getListenerRecipients } from "@/lib/channel-newsletter";
import { fetchComingUp } from "@/lib/recommendations/coming-up";

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

// The SEND run only emails if the BACKFILL run completed within this window —
// guards against sending stale/missing snapshots if the backfill failed or never
// ran. Backfill is Tue 1AM PT, send Tue 10AM PT (~9h gap), so 18h is safe.
const BACKFILL_FRESHNESS_MS = 18 * 60 * 60 * 1000;

function backfillStatusDocId(shard: number | null): string {
  return shard != null ? `weekly-rec-backfill-status-${shard}` : "weekly-rec-backfill-status";
}

function uidInShard(uid: string, shard: number, shardCount: number): boolean {
  if (shardCount <= 1) return true;
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return h % shardCount === shard;
}

function archiveToRow(a: ArchiveSerialized, sceneLabel?: string): WeeklyRecArchiveRow {
  const dj = a.djs?.[0];
  // Effective scene slugs: override (if set) else denormalized slugs.
  const scenes =
    a.sceneIdsOverride && a.sceneIdsOverride.length ? a.sceneIdsOverride : a.sceneSlugs || [];
  // The fallback featured grid groups by spiral/star; prefer one of those.
  const sceneSlug = scenes.find((s) => s === "spiral" || s === "star") || scenes.find((s) => s !== "grid");
  return {
    slug: a.slug,
    showName: a.showName,
    djName: dj?.name,
    djUsername: dj?.username,
    djPhotoUrl: dj?.photoUrl,
    showImageUrl: a.showImageUrl,
    sceneLabel,
    sceneSlug,
    tempo: a.tempo ?? null,
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
  // mode splits the weekly job into two scheduled runs so the snapshot BACKFILL
  // completes (and can be verified/fixed) BEFORE any emails go out:
  //   backfill = generate+persist every user's snapshot, send NOTHING.
  //   send     = read the already-persisted snapshot, send the email, generate
  //              nothing (snapshots are still fresh from the backfill run).
  //   (unset)  = legacy single-pass: generate+persist AND send (manual runs).
  const mode = params.get("mode"); // "backfill" | "send" | null
  const doGenerate = !dryRun && mode !== "send"; // backfill + legacy generate
  const doSend = mode !== "backfill"; // send + legacy send

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
    const sharedData = doGenerate ? await loadSharedData(db, nowMs) : null;
    const recConfig = doGenerate ? await loadConfig(db) : null;

    // SEND GUARD: a real send run refuses to email unless the BACKFILL run
    // completed recently AND cleanly — so we never email from stale/missing
    // snapshots if the backfill failed or never ran. (dry-run/preview bypass it.)
    if (mode === "send" && !dryRun && !previewTo) {
      const statusDoc = await db.collection("system").doc(backfillStatusDocId(shard)).get();
      const status = statusDoc.data() as
        | { completedAtMs?: number; usersScanned?: number; failed?: number }
        | undefined;
      const ageMs = status?.completedAtMs ? nowMs - status.completedAtMs : Infinity;
      const stale = ageMs > BACKFILL_FRESHNESS_MS;
      // Abort if it didn't run recently, or had a meaningful failure rate (>5%).
      const failRate =
        status?.usersScanned && status.usersScanned > 0 ? (status.failed ?? 0) / status.usersScanned : 0;
      if (!status?.completedAtMs || stale || failRate > 0.05) {
        console.error("[weekly-recommendations] SEND ABORTED — backfill not healthy", { status, ageMs, failRate });
        return NextResponse.json(
          {
            error: "Backfill not completed/healthy — send aborted",
            backfillStatus: status ?? null,
            backfillAgeMs: Number.isFinite(ageMs) ? ageMs : null,
            failRate,
          },
          { status: 409 },
        );
      }
    }

    const usersSnap = await db.collection("users").get();

    let emailsSent = 0;
    let generated = 0;
    let skippedOptOut = 0;
    let skippedNoEmail = 0;
    let failed = 0;
    let fallbackExtraSent = 0;
    type Trace = { email: string; s1: number; s2: number; comingUp: number; fallback: boolean };
    const trace: Trace[] = [];

    // Every email that has a `users` doc — so the broad "extra sources" pass below
    // (pending-dj-profiles / waitlist / EXTRA_LISTENERS) never double-emails anyone
    // already handled by the personalized/users loop.
    const usersEmails = new Set<string>();

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const email = data.email as string | undefined;
      if (!email) { skippedNoEmail++; continue; }
      usersEmails.add(email.toLowerCase());
      const en = data.emailNotifications as Record<string, unknown> | undefined;
      if (en?.weeklyRecommendations === false) { skippedOptOut++; continue; }
      if (shard != null && !uidInShard(userDoc.id, shard, shardCount)) continue;

      // previewTo: only process the one preview recipient (sends a real email,
      // stamps nothing). All others are skipped entirely in preview mode.
      if (previewTo && email.toLowerCase() !== previewTo) continue;

      try {
        // BACKFILL: generate+persist this user's snapshot (refresh if >24h old,
        // reusing the shared catalog). The same snapshot then serves the SEND run
        // and their next /scene visit.
        let prebuilt;
        if (doGenerate && sharedData && recConfig) {
          const outcome = await generateForUser(
            db,
            userDoc.id,
            "website",
            { persist: true, generatedBy: "cron" },
            sharedData,
            recConfig,
          );
          prebuilt = outcome.snapshot;
          generated++;
        }
        // Backfill-only run: snapshot persisted, no email. Move on.
        if (!doSend) continue;

        // SEND: read the persisted snapshot (prebuilt is undefined here in a
        // pure send run → buildScenePayload reads the stored doc).
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
          // IRL lineups: full artist list for the sub-line (capped in the row builder).
          allDjArtists: r.isIRL
            ? (r.allDjs || []).map((d) => d.djName).filter((n): n is string => !!n)
            : undefined,
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

    // ── Extra-sources fallback pass ──────────────────────────────────────────
    // The personalized loop above only covers the `users` collection. The Monday
    // newsletter reaches a BROADER list — pending-dj-profiles + radio-notify-
    // waitlist + EXTRA_LISTENERS — who have no `users` doc and therefore no rec
    // snapshot. We send THEM the no-taste FALLBACK version (featured grid +
    // public "coming up"), reusing the newsletter's recipient gathering (which
    // already honors marketing opt-out + waitlist/pending unsubscribes).
    //
    // Only runs on a real SEND (skipped on backfill-only). Deduped against the
    // users emails already handled, and against the DJ cohort, so nobody gets two
    // copies.
    if (doSend) {
      // getListenerRecipients dedupes against DJ emails; pass the DJ cohort in so
      // a pending/waitlist entry that's also a DJ user is excluded here too.
      const djRecipients = await getDjRecipients(db);
      const djEmails = new Set(djRecipients.map((r) => r.email));
      const broadListeners = await getListenerRecipients(db, djEmails);

      // Keep ONLY the entries with no users doc (their email isn't in usersEmails)
      // — i.e. the pending/waitlist/extra sources. Users-collection listeners were
      // already emailed (personalized or fallback) by the loop above.
      const extras = broadListeners.filter((r) => !usersEmails.has(r.email.toLowerCase()));

      if (extras.length > 0) {
        // Public (logged-out) "coming up this week" — same list for everyone here,
        // built ONCE. userCity:null and empty engagement = no personalization.
        const publicComingUpRows = await fetchComingUp({
          db,
          nowMs,
          userCity: null,
          engagedDjUsernames: new Set<string>(),
        });
        const comingUp: WeeklyRecComingUpRow[] = publicComingUpRows.map((r) => ({
          showName: r.eventName || r.djName || "",
          djName: r.djName,
          djUsername: r.djUsername,
          djPhotoUrl: r.djPhotoUrl,
          showImageUrl: r.eventPhotoUrl,
          stationId: "broadcast",
          startTime: new Date(r.startMs).toISOString(),
          isIRL: r.isIRL,
          linkUrl: r.isIRL ? (r.ticketUrl || r.linkUrl) : r.linkUrl,
          allDjArtists: r.isIRL
            ? (r.allDjs || []).map((d) => d.djName).filter((n): n is string => !!n)
            : undefined,
        }));

        for (const r of extras) {
          // Honor the same shard split as the users loop (hash on the doc id).
          if (shard != null && !uidInShard(r.id, shard, shardCount)) continue;
          // previewTo: only the one preview recipient.
          if (previewTo && r.email.toLowerCase() !== previewTo) continue;

          if (dryRun && !previewTo) {
            if (trace.length < traceLimit) {
              trace.push({ email: r.email, s1: featuredRows.length, s2: 0, comingUp: comingUp.length, fallback: true });
            }
            fallbackExtraSent++;
            continue;
          }

          try {
            const ok = await sendWeeklyRecommendationsEmail({
              to: r.email,
              userTimezone: undefined, // no users doc → default PT
              section1: featuredRows,
              section2: [],
              comingUp,
              isFallback: true,
              recipientUid: r.id, // hidden CTA in fallback; harmless if it doesn't resolve
            });
            if (!ok) { failed++; continue; }
            fallbackExtraSent++;
          } catch (e) {
            failed++;
            console.error(`[weekly-recommendations] extra ${r.id} (${r.email}):`, e);
          }
        }
      }
    }

    // BACKFILL run: stamp a status doc the SEND run gates on. Keyed per shard so
    // a sharded backfill records each shard's completion independently.
    if (mode === "backfill" && !dryRun && !previewTo) {
      await db
        .collection("system")
        .doc(backfillStatusDocId(shard))
        .set({
          completedAtMs: nowMs,
          usersScanned: usersSnap.size,
          generated,
          failed,
          shard,
        });
    }

    return NextResponse.json({
      mode: mode ?? "legacy",
      dryRun,
      previewTo: previewTo ?? null,
      shard,
      usersScanned: usersSnap.size,
      generated,
      emailsSent,
      fallbackExtraSent,
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
