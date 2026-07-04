import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { ArchiveSerialized } from "@/types/broadcast";
import { buildScenePayload } from "@/lib/recommendations/scene-payload";
import { generateForUser, loadSharedData, loadConfig } from "@/lib/recommendations/server";
import { buildFeaturedMatrix } from "@/lib/recommendations/featured-matrix";
import { DEFAULT_FEATURED_CITY } from "@/lib/recommendations/featured-payload";
import {
  sendWeeklyRecommendationsEmail,
  type WeeklyRecArchiveRow,
  type WeeklyRecComingUpRow,
} from "@/lib/email";
import { getDjRecipients, getListenerRecipients } from "@/lib/channel-newsletter";
import { fetchComingUp } from "@/lib/recommendations/coming-up";
import {
  listResendEmails,
  buildRecipientEventMap,
  type RecipientEvent,
} from "@/lib/resend-events";
import { Resend } from "resend";

// Weekly recommendation email — sent Tue 11am PT (vercel.json `0 18 * * 2`).
// Mirrors /scene over email per user:
//   1. New from your favorites  (engine `favorite-artists`, max 2)
//   2. In your scene            (engine `discovery`, max 2)
//   3. Coming up this week      (everything — online + IRL, via buildScenePayload)
// Always sends; empty personalized sections fall back to the logged-out
// featured matrix (6 shows, excluding the "Intense"/very_fast tempo).
//
// Gating: emailNotifications.weeklyRecommendations !== false (default on).
//
// No-repeat is OPEN-GATED. A separate `mode=report` run (Mon 10am PT) polls
// Resend for LAST week's send and stamps `lastWeeklyRecOpenedLast` per user:
//   - opened last week  → rotate: suppress the archives they already saw
//     (`lastWeeklyRecShows`), surface fresh next-best, and if a section runs
//     thin fill from `lastWeeklyRecShownIds` (what they saw, in order) rather
//     than the featured grid.
//   - didn't open / unknown → show the BEST picks, no dedup (they never saw the
//     good ones, so burning them would be wrong).
// The report run also emails Cap a recap (opens / unsubscribes / bounces).
//
// Subject is shared ("Your Weekly Listening") — the report run matches on it.
const WEEKLY_REC_SUBJECT = "Your Weekly Listening";
const REPORT_TO = "cap@channel-app.com";
const REPORT_FROM = "Channel <djshows@channel-app.com>";
//
// Params: ?mode=report|backfill|send, ?dryRun=1 (compute, send nothing),
// ?previewTo=<email> (send ONE real email to that address, stamp nothing),
// ?shard=N&shardCount=M (split the run).

export const maxDuration = 300;

const cronSecret = process.env.CRON_SECRET || "";

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  return isVercelCron || authHeader === `Bearer ${cronSecret}`;
}

const SECTION_CAP = 3;
const RECENT_RETENTION_MS = 21 * 24 * 60 * 60 * 1000; // prune lastWeeklyRecShows after ~3 weeks

// The SEND run only emails if the BACKFILL run completed within this window —
// guards against sending stale/missing snapshots if the backfill failed or never
// ran. Backfill is Wed 1AM PT, send Wed 10AM PT (~9h gap), so 18h is safe.
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
  //   report   = poll Resend for last week's send, stamp per-user open flags,
  //              email Cap the recap. Generates/sends NOTHING else.
  const mode = params.get("mode"); // "report" | "backfill" | "send" | null
  const doReport = mode === "report";
  const doGenerate = !doReport && !dryRun && mode !== "send"; // backfill + legacy generate
  const doSend = !doReport && mode !== "backfill"; // send + legacy send

  const nowMs = Date.now();

  // ── REPORT MODE ──────────────────────────────────────────────────────────
  // Runs Mon 10am PT, ~25h before Tue's send. Polls Resend for LAST week's
  // "Your Weekly Listening" send, stamps each user's `lastWeeklyRecOpenedLast`
  // (read by the send run to gate rotation), and emails Cap a recap.
  if (doReport) {
    return runReport(db, nowMs, { dryRun, previewTo, shard, shardCount });
  }

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
        const prevShownIds = (data.lastWeeklyRecShownIds as string[] | undefined) || [];
        // Open-gated rotation. The Mon report run stamps `lastWeeklyRecOpenedLast`
        // for whoever opened last week's send. Only THEY get deduped/rotated;
        // everyone else keeps seeing the strongest picks (they never saw them).
        const openedLastWeek = data.lastWeeklyRecOpenedLast === true;
        const pickSection = (id: string): WeeklyRecArchiveRow[] => {
          const sec = payload.sections.find((s) => s.id === id);
          if (!sec) return [];
          const toRow = (a: ArchiveSerialized) =>
            archiveToRow(a, sec.bandByArchiveId[a.id]?.glyphSlug || undefined);

          // Didn't open (or unknown) → best top-3, NO dedup.
          if (!openedLastWeek) {
            return sec.archives.slice(0, SECTION_CAP).map(toRow);
          }

          // Opened → rotate: fresh next-best first (suppress carryovers they
          // already saw). Because the snapshot regenerated overnight, `fresh`
          // naturally surfaces this week's new/risen picks.
          const picks = sec.archives.filter((a) => !seen[a.id]).slice(0, SECTION_CAP);

          // If a section runs thin, fill from what they were PREVIOUSLY shown,
          // in original order — not the featured grid. Scope to ids still in
          // this section's ranked list; skip ones already picked.
          if (picks.length < SECTION_CAP) {
            const pickedIds = new Set(picks.map((a) => a.id));
            const byId = new Map(sec.archives.map((a) => [a.id, a]));
            for (const prevId of prevShownIds) {
              if (picks.length >= SECTION_CAP) break;
              if (pickedIds.has(prevId)) continue;
              const a = byId.get(prevId);
              if (a) {
                picks.push(a);
                pickedIds.add(prevId);
              }
            }
          }
          return picks.map(toRow);
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
        // Ordered record of exactly what we showed (for next week's
        // fill-from-previous). Empty on the featured-fallback send.
        const shownIds: string[] = [];
        if (!isFallback) {
          for (const r of [...section1, ...section2]) {
            const a = allArchives.find((x) => x.slug === r.slug);
            if (a) {
              updatedSeen[a.id] = nowIso;
              shownIds.push(a.id);
            }
          }
        }
        await userDoc.ref.set(
          {
            lastWeeklyRecEmailAt: FieldValue.serverTimestamp(),
            lastWeeklyRecShows: updatedSeen,
            lastWeeklyRecShownIds: shownIds,
            // Clear the open flag so a skipped Monday report run can never leak a
            // stale "opened" into a later week. The next report run re-stamps it.
            lastWeeklyRecOpenedLast: false,
            // Whether this send was the featured-fallback (no recorded taste) vs
            // a personalized send — so the Monday recap can break opens down by
            // template. Only populated from the first send after this shipped.
            lastWeeklyRecLastWasFallback: isFallback,
          },
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
        // Per-CITY coming-up: each non-user's email is gated to THEIR city
        // (pending-dj djProfile.location / waitlist tz / etc), defaulting to LA.
        // Memoized so each distinct city is built once (fetchComingUp's shared
        // data is cached, so this is cheap).
        const comingUpByCity = new Map<string, WeeklyRecComingUpRow[]>();
        const comingUpForCity = async (city: string): Promise<WeeklyRecComingUpRow[]> => {
          const cached = comingUpByCity.get(city);
          if (cached) return cached;
          const rows = await fetchComingUp({ db, nowMs, userCity: city, engagedDjUsernames: new Set<string>() });
          const mapped: WeeklyRecComingUpRow[] = rows.map((r) => ({
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
          comingUpByCity.set(city, mapped);
          return mapped;
        };

        for (const r of extras) {
          // Honor the same shard split as the users loop (hash on the doc id).
          if (shard != null && !uidInShard(r.id, shard, shardCount)) continue;
          // previewTo: only the one preview recipient.
          if (previewTo && r.email.toLowerCase() !== previewTo) continue;

          const recipientCity = r.city || DEFAULT_FEATURED_CITY;
          const comingUp = await comingUpForCity(recipientCity);

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

// ── Report run ─────────────────────────────────────────────────────────────
// The last weekly send went out the PREVIOUS Tuesday ~11am PT — i.e. roughly
// 6 days before this Monday run. Window generously around that (created_at is
// newest-first) so we catch the whole batch without pulling unrelated weeks.
const LAST_SEND_WINDOW_START_MS = 8 * 24 * 60 * 60 * 1000; // now-8d
const LAST_SEND_WINDOW_END_MS = 4 * 24 * 60 * 60 * 1000; //  now-4d

type ReportParams = {
  dryRun: boolean;
  previewTo?: string;
  shard: number | null;
  shardCount: number;
};

async function runReport(
  db: FirebaseFirestore.Firestore,
  nowMs: number,
  { dryRun, previewTo, shard, shardCount }: ReportParams,
): Promise<NextResponse> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
  }

  try {
    // Poll Resend for last week's "Your Weekly Listening" sends (read-only).
    const { rows, truncated, pagesFetched } = await listResendEmails({
      apiKey,
      sinceMs: nowMs - LAST_SEND_WINDOW_START_MS,
      untilMs: nowMs - LAST_SEND_WINDOW_END_MS,
      subject: WEEKLY_REC_SUBJECT,
    });
    const byEmail = buildRecipientEventMap(rows);

    // Load users ONCE to (a) classify each recipient DJ vs non-DJ (role==="dj")
    // and template fallback vs personalized (lastWeeklyRecLastWasFallback, only
    // populated from the first send after this shipped), and (b) stamp the open
    // flag. Recipients with no users doc (extra-sources / waitlist) are non-DJ
    // by definition and always got the featured fallback.
    const usersSnap = await db.collection("users").get();

    // Bucketed tallies: cohort → template → {sent, opened, unsub[], bounce[]}.
    type Bucket = { total: number; opened: number; unsubscribed: string[]; bounced: string[] };
    const mkBucket = (): Bucket => ({ total: 0, opened: 0, unsubscribed: [], bounced: [] });
    type Cohort = "dj" | "listener";
    type Template = "personalized" | "fallback" | "unknown";
    const buckets: Record<Cohort, Record<Template, Bucket>> = {
      dj: { personalized: mkBucket(), fallback: mkBucket(), unknown: mkBucket() },
      listener: { personalized: mkBucket(), fallback: mkBucket(), unknown: mkBucket() },
    };
    const overall = mkBucket();

    const tally = (b: Bucket, email: string, ev: RecipientEvent) => {
      b.total++;
      if (ev.opened) b.opened++;
      if (ev.unsubscribed) b.unsubscribed.push(email);
      if (ev.bounced) b.bounced.push(email);
    };

    // Match each user doc to its Resend event; classify + tally + stamp.
    let flagged = 0;
    const matchedEmails = new Set<string>();
    let batch = db.batch();
    let pending = 0;
    const willWrite = !dryRun && !previewTo && byEmail.size > 0;
    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const email = (data.email as string | undefined)?.toLowerCase();
      if (!email) continue;
      const ev = byEmail.get(email);
      if (!ev) continue; // not in last week's send
      matchedEmails.add(email);

      const cohort: Cohort = data.role === "dj" ? "dj" : "listener";
      const template: Template =
        data.lastWeeklyRecLastWasFallback === true
          ? "fallback"
          : data.lastWeeklyRecLastWasFallback === false
            ? "personalized"
            : "unknown"; // sent before template tracking shipped
      tally(buckets[cohort][template], email, ev);
      tally(overall, email, ev);

      // Stamp the open flag (respects shard split; skipped on dry-run/preview).
      if (willWrite) {
        if (shard == null || uidInShard(userDoc.id, shard, shardCount)) {
          batch.set(userDoc.ref, { lastWeeklyRecOpenedLast: ev.opened }, { merge: true });
          flagged++;
          if (++pending >= 400) {
            await batch.commit();
            batch = db.batch();
            pending = 0;
          }
        }
      }
    }
    if (willWrite && pending > 0) await batch.commit();

    // Recipients with NO users doc (extra-sources / waitlist) → non-DJ, fallback.
    for (const [email, ev] of Array.from(byEmail)) {
      if (matchedEmails.has(email)) continue;
      tally(buckets.listener.fallback, email, ev);
      tally(overall, email, ev);
    }

    // Email Cap the recap (skipped on dryRun/previewTo or an empty poll).
    let reportSent = false;
    if (willWrite) {
      const resend = new Resend(apiKey);
      const sendDateLabel = new Date(nowMs - LAST_SEND_WINDOW_END_MS).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "America/Los_Angeles",
      });
      await resend.emails.send({
        from: REPORT_FROM,
        to: REPORT_TO,
        subject: `[weekly listening recap] ${overall.total} sent — ${overall.opened} opens, ${overall.unsubscribed.length} unsubs, ${overall.bounced.length} bounces`,
        html: buildWeeklyRecReportHtml({ overall, buckets, sendDateLabel, truncated }),
      });
      reportSent = true;
    }

    // Compact per-bucket summary for the JSON response (counts only).
    const summarize = (b: Bucket) => ({
      sent: b.total,
      opened: b.opened,
      unsub: b.unsubscribed.length,
      bounce: b.bounced.length,
    });
    return NextResponse.json({
      mode: "report",
      dryRun,
      previewTo: previewTo ?? null,
      pagesFetched,
      truncated,
      matched: byEmail.size,
      flagged,
      reportSent,
      overall: summarize(overall),
      dj: {
        personalized: summarize(buckets.dj.personalized),
        fallback: summarize(buckets.dj.fallback),
        unknown: summarize(buckets.dj.unknown),
      },
      listener: {
        personalized: summarize(buckets.listener.personalized),
        fallback: summarize(buckets.listener.fallback),
        unknown: summarize(buckets.listener.unknown),
      },
    });
  } catch (error) {
    console.error("[weekly-recommendations] report error:", error);
    return NextResponse.json({ error: "Failed to run weekly rec report" }, { status: 500 });
  }
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

type ReportBucket = { total: number; opened: number; unsubscribed: string[]; bounced: string[] };
type ReportBuckets = Record<
  "dj" | "listener",
  Record<"personalized" | "fallback" | "unknown", ReportBucket>
>;

function buildWeeklyRecReportHtml(s: {
  overall: ReportBucket;
  buckets: ReportBuckets;
  sendDateLabel: string;
  truncated: boolean;
}): string {
  const td = (v: string | number, bold = false) =>
    `<td style="padding:6px 10px;border:1px solid #ddd;${bold ? "font-weight:bold;" : ""}">${v}</td>`;

  // A row per (cohort × template); the leading label spells out both.
  const row = (label: string, b: ReportBucket): string => {
    if (b.total === 0) return ""; // hide empty combinations
    return `<tr>
      ${td(label, true)}
      ${td(b.total)}
      ${td(`${b.opened} (${pct(b.opened, b.total)})`)}
      ${td(b.unsubscribed.length)}
      ${td(b.bounced.length)}
    </tr>`;
  };

  const cohortRows = (cohort: "dj" | "listener", cohortLabel: string): string =>
    row(`${cohortLabel} · Personalized`, s.buckets[cohort].personalized) +
    row(`${cohortLabel} · Fallback`, s.buckets[cohort].fallback) +
    row(`${cohortLabel} · Unknown template`, s.buckets[cohort].unknown);

  // Collect unsubs/bounces across every bucket for the detail lists.
  const allUnsub = new Set<string>();
  const allBounce = new Set<string>();
  for (const cohort of ["dj", "listener"] as const) {
    for (const tmpl of ["personalized", "fallback", "unknown"] as const) {
      s.buckets[cohort][tmpl].unsubscribed.forEach((e) => allUnsub.add(e));
      s.buckets[cohort][tmpl].bounced.forEach((e) => allBounce.add(e));
    }
  }
  const list = (title: string, emails: string[]): string =>
    emails.length === 0
      ? ""
      : `<h3 style="margin:20px 0 6px;font-size:14px;">${title} (${emails.length})</h3>
         <ul style="margin:0;padding-left:18px;font-size:13px;color:#333;">
           ${emails.sort().map((e) => `<li>${e}</li>`).join("")}
         </ul>`;

  const anyUnknown =
    s.buckets.dj.unknown.total > 0 || s.buckets.listener.unknown.total > 0;

  return `<!DOCTYPE html><html><body style="font-family:-apple-system,Arial,sans-serif;color:#111;">
    <h2 style="margin:0 0 8px;">Weekly Listening recap — send of ${s.sendDateLabel}</h2>
    <p style="margin:0 0 12px;font-size:13px;color:#555;">
      Resend events for the last "Your Weekly Listening" send, broken down by
      audience (DJ vs listener) and template (personalized vs featured fallback).
    </p>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f6f6f6;">
          ${td("Segment", true)}${td("Sent", true)}${td("Opened", true)}${td("Unsub", true)}${td("Bounced", true)}
        </tr>
      </thead>
      <tbody>
        <tr style="background:#fafafa;">${td("ALL", true)}${td(s.overall.total, true)}${td(`${s.overall.opened} (${pct(s.overall.opened, s.overall.total)})`, true)}${td(s.overall.unsubscribed.length, true)}${td(s.overall.bounced.length, true)}</tr>
        ${cohortRows("dj", "DJ")}
        ${cohortRows("listener", "Listener")}
      </tbody>
    </table>
    ${anyUnknown ? `<p style="margin:12px 0 0;font-size:12px;color:#888;">"Unknown template" = sent before per-send template tracking shipped; resolves next week.</p>` : ""}
    ${list("Unsubscribed", Array.from(allUnsub))}
    ${list("Bounced / complained", Array.from(allBounce))}
    ${s.truncated ? `<p style="margin:16px 0 0;font-size:12px;color:#b00;">⚠ Poll hit the page cap — counts may be incomplete.</p>` : ""}
    <p style="margin:20px 0 0;font-size:12px;color:#888;line-height:1.5;">
      Note: open rates count tracking-pixel hits. Apple Mail Privacy Protection
      pre-loads images for iOS / macOS Mail users, which inflates opens.
      Unsubscribes and bounces are not affected.
    </p>
  </body></html>`;
}
