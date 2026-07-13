import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { ArchiveSerialized } from "@/types/broadcast";
import { buildScenePayload } from "@/lib/recommendations/scene-payload";
import { isListenerVisibleArchive } from "@/lib/archive-priority";
import { generateForUser, loadSharedData, loadConfig } from "@/lib/recommendations/server";
import { buildFeaturedMatrix } from "@/lib/recommendations/featured-matrix";
import { DEFAULT_FEATURED_CITY } from "@/lib/recommendations/featured-payload";
import {
  sendWeeklyRecommendationsEmail,
  type WeeklyRecArchiveRow,
  type WeeklyRecComingUpRow,
} from "@/lib/email";
import { getDjRecipients, getListenerRecipients, resolveFirstName } from "@/lib/channel-newsletter";
import {
  WEEKLY_SUBJECTS,
  introSubjectFor,
  buildIntroHtml,
  type IntroCohort,
} from "@/lib/weekly-intro";
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
// COHORT SPLIT: DJs and listeners get different subjects and different
// hand-written intros (src/lib/weekly-intro.ts) above the same rec sections.
// The report run polls Resend for EVERY subject in WEEKLY_SUBJECTS — a subject
// missing from that list means its cohort's opens are never stamped.
const REPORT_TO = "cap@channel-app.com";
const REPORT_FROM = "Channel <djshows@channel-app.com>";
// Where a ?previewTo= preview is delivered when no ?deliverTo= is given.
// Previews must never land in a real user's inbox — see the deliverTo parsing.
const PREVIEW_FALLBACK_TO = "cap@channel-app.com";
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

// Same-week dedup: skip any recipient already emailed within this window, so an
// accidental re-run (or a manual pre-stamp) never double-sends. The weekly send
// is 7 days apart, so 3 days safely catches a same-day/next-day duplicate while
// never suppressing next week's legitimate send. Read off lastWeeklyRecEmailAt.
const RECENT_SEND_DEDUP_MS = 3 * 24 * 60 * 60 * 1000;

// Coerce a Firestore Timestamp / {_seconds} / ISO string / ms number to millis.
function emailAtMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") { const t = Date.parse(v); return Number.isNaN(t) ? null : t; }
  const o = v as { toMillis?: () => number; _seconds?: number; seconds?: number };
  if (typeof o.toMillis === "function") return o.toMillis();
  if (typeof o._seconds === "number") return o._seconds * 1000;
  if (typeof o.seconds === "number") return o.seconds * 1000;
  return null;
}

// The SEND run only emails if the BACKFILL run completed within this window —
// guards against sending stale/missing snapshots if the backfill failed or never
// ran. Backfill is Wed 1AM PT, send Wed 10AM PT (~9h gap), so 18h is safe.
const BACKFILL_FRESHNESS_MS = 18 * 60 * 60 * 1000;

// A user counts as "active" (eligible for the daily scope=active backfill) if
// their lastSeenAt is within this window. 48h so a daily run always catches
// anyone seen since roughly the previous run, with a day of margin.
const ACTIVE_WINDOW_MS = 48 * 60 * 60 * 1000;

function backfillStatusDocId(shard: number | null): string {
  return shard != null ? `weekly-rec-backfill-status-${shard}` : "weekly-rec-backfill-status";
}

// The scope=active daily run stamps its OWN status doc so the "Daily recs cron"
// Tech Health line reports independently of the full run's "Newsletter readiness"
// line (weekly-rec-backfill-status).
function statusDocId(scope: "active" | "all", shard: number | null): string {
  if (scope === "active") {
    return shard != null ? `daily-rec-status-${shard}` : "daily-rec-status";
  }
  return backfillStatusDocId(shard);
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
  // Preview a SPECIFIC user's exact email (their recs/flags/city) but redirect
  // delivery to this address instead of the user's own. Lets an admin receive
  // "what user X will get" in their own inbox without emailing X. Only honored
  // alongside previewTo; still stamps nothing.
  //
  // SAFETY: a preview NEVER reaches the real user. deliverTo defaults to the
  // admin inbox, so `?previewTo=someDj@x.com` mails Cap, not the DJ. Previously
  // an omitted deliverTo silently delivered to the previewed user's own inbox —
  // one forgotten param away from mailing a real DJ a test. Sending to the real
  // recipient now requires the explicit, deliberate `&deliverTo=self`.
  const deliverToParam = params.get("deliverTo")?.toLowerCase() || undefined;
  const deliverTo =
    deliverToParam === "self" ? undefined : (deliverToParam ?? PREVIEW_FALLBACK_TO);
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

  // scope=active restricts a BACKFILL run to users seen on the site within
  // ACTIVE_WINDOW_MS (the daily "lazy" refresh). Full/default backfill covers
  // everyone (the pre-newsletter run). Only meaningful for backfill; send/report
  // ignore it. Stamps a SEPARATE status doc so the Tech Health "Daily recs cron"
  // line reports independently from "Newsletter readiness" (the full run).
  const scope = params.get("scope") === "active" ? "active" : "all";

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

    // uid → slug of that DJ's most recent LISTENER-VISIBLE archive, for the
    // "here's your latest show" link in the DJ intro. Built once from the
    // archives already in memory (no extra reads).
    //
    // Gated on isListenerVisibleArchive: the link is a public URL we're putting
    // in an email, so a hidden/private archive must never be surfaced — even to
    // its own DJ. A DJ whose newest show is hidden simply gets no link (the
    // intro drops the sentence) rather than a leaked one.
    //
    // Credit (djs[].userId), not uploadedBy: a show uploaded on someone's behalf
    // still belongs to the DJ it credits.
    const latestShowByUid = new Map<string, { slug: string; createdAt: number }>();
    for (const a of allArchives) {
      if (!a.slug || !isListenerVisibleArchive(a)) continue;
      const createdAt = typeof a.createdAt === "number" ? a.createdAt : 0;
      for (const dj of a.djs || []) {
        const uid = dj.userId;
        if (!uid) continue;
        const cur = latestShowByUid.get(uid);
        if (!cur || createdAt > cur.createdAt) {
          latestShowByUid.set(uid, { slug: a.slug, createdAt });
        }
      }
    }

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
    let skippedRecentSend = 0;
    let skippedDormant = 0;
    let skippedFresh = 0;
    let failed = 0;
    let fallbackExtraSent = 0;
    type Trace = { email: string; s1: number; s2: number; comingUp: number; fallback: boolean };
    const trace: Trace[] = [];

    // Per-user engagement stats for the admin Users tab, piggybacked on the
    // subcollection reads generateForUser already does. Only populated for users
    // we actually (re)generate this run — skipped-fresh users keep their prior
    // entry via the merge-write into system/user-stats after the loop.
    type UserStatEntry = {
      lovesGiven: number;
      archivesStreamed: number;
      lastSeenAtMs: number | null;
      role: string;
      ownsCollective: boolean;
      updatedAtMs: number;
    };
    const userStats: Record<string, UserStatEntry> = {};

    // Every email that has a `users` doc — so the broad "extra sources" pass below
    // (pending-dj-profiles / waitlist / EXTRA_LISTENERS) never double-emails anyone
    // already handled by the personalized/users loop.
    const usersEmails = new Set<string>();

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const email = data.email as string | undefined;
      // No email = no real account/preferences (waitlist-style docs) — skip in
      // every scope; they have no personalized recs to build.
      if (!email) { skippedNoEmail++; continue; }
      usersEmails.add(email.toLowerCase());
      // The weekly-email opt-out governs the SEND path only. scope=active builds
      // WEBSITE snapshots (never emails), so an email-opted-out user must still
      // get their /foryou & home recs refreshed daily — bypass the opt-out here.
      if (scope !== "active") {
        const en = data.emailNotifications as Record<string, unknown> | undefined;
        if (en?.weeklyRecommendations === false) { skippedOptOut++; continue; }
      }
      if (shard != null && !uidInShard(userDoc.id, shard, shardCount)) continue;

      // scope=active (daily run): only regenerate users seen on the site within
      // ACTIVE_WINDOW_MS. Dormant users are left for the weekly full backfill.
      // lastSeenAt may be a Firestore Timestamp OR a flattened {_seconds} shape,
      // so coerce via emailAtMs (handles both) rather than calling .toMillis().
      if (scope === "active") {
        const seenMs = emailAtMs(data.lastSeenAt);
        if (seenMs == null || nowMs - seenMs > ACTIVE_WINDOW_MS) { skippedDormant++; continue; }
      }

      // previewTo: only process the one preview recipient (sends a real email,
      // stamps nothing). All others are skipped entirely in preview mode.
      if (previewTo && email.toLowerCase() !== previewTo) continue;

      // Same-week dedup (real sends only): skip if already emailed within the
      // dedup window. Guards against re-runs and lets us pre-stamp a recipient
      // to intentionally suppress them from an imminent send. Preview bypasses.
      if (!previewTo && doSend) {
        const lastMs = emailAtMs(data.lastWeeklyRecEmailAt);
        if (lastMs != null && nowMs - lastMs < RECENT_SEND_DEDUP_MS) { skippedRecentSend++; continue; }
      }

      try {
        // BACKFILL: generate+persist this user's snapshot, reusing the shared
        // catalog. The same snapshot then serves the SEND run and their next
        // /scene visit.
        //
        // The FULL backfill (scope=all, Tue 1:45am — the one that gates the
        // send) FORCES regeneration, bypassing the 24h freshness floor. Everyone
        // who is about to be emailed gets a snapshot built from the current
        // catalog — otherwise a user who visited the site last night keeps a
        // <24h snapshot and their email silently misses anything published
        // since.
        //
        // The DAILY scope=active run keeps the floor: it exists to lazily
        // refresh the website for people who are already browsing, and forcing
        // it would rebuild the same active users every single day for nothing.
        let prebuilt;
        if (doGenerate && sharedData && recConfig) {
          const outcome = await generateForUser(
            db,
            userDoc.id,
            "website",
            { persist: true, generatedBy: "cron", force: scope === "all" },
            sharedData,
            recConfig,
          );
          prebuilt = outcome.snapshot;
          // generateForUser returns skipped:"fresh" when the 24h floor left the
          // existing snapshot untouched — count those separately so `generated`
          // reflects snapshots actually (re)written, not just users processed.
          if (outcome.skipped === "fresh") skippedFresh++;
          else generated++;
          // Capture engagement stats when the subcollections were actually read
          // (i.e. not skipped-fresh/no-user, where the sizes are undefined).
          if (outcome.lovesGiven !== undefined && outcome.archivesStreamed !== undefined) {
            const ownedSlugs = data.ownedCollectiveSlugs as string[] | undefined;
            userStats[userDoc.id] = {
              lovesGiven: outcome.lovesGiven,
              archivesStreamed: outcome.archivesStreamed,
              lastSeenAtMs: emailAtMs(data.lastSeenAt),
              role: (data.role as string | undefined) || "user",
              ownsCollective: Array.isArray(ownedSlugs) && ownedSlugs.length > 0,
              updatedAtMs: nowMs,
            };
          }
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

          // If a section runs thin, TOP IT UP to the cap rather than shipping a
          // near-empty block. Two passes, in order of preference:
          //
          //   1. Archives they were previously shown (prevShownIds, original
          //      order) — the least-surprising re-show.
          //   2. Anything else still ranked in this section.
          //
          // Pass 2 matters: a regular opener eventually has `seen` covering the
          // whole section, so pass 1 alone leaves favorites starved — measured at
          // 13 openers fully drained, 7 users seeing ZERO favorites. That's the
          // same "favorites went near-empty" failure 06637a0b fixed on /foryou;
          // the email just had its own dedup layer that reintroduced it. The
          // engine deliberately KEEPS already-streamed archives in
          // favorite-artists, so re-showing from its ranked list is intended, not
          // a leak.
          if (picks.length < SECTION_CAP) {
            const pickedIds = new Set(picks.map((a) => a.id));
            const byId = new Map(sec.archives.map((a) => [a.id, a]));
            const topUp = (a: ArchiveSerialized | undefined) => {
              if (!a || pickedIds.has(a.id) || picks.length >= SECTION_CAP) return;
              picks.push(a);
              pickedIds.add(a.id);
            };
            for (const prevId of prevShownIds) topUp(byId.get(prevId));
            for (const a of sec.archives) topUp(a);
          }
          return picks.map(toRow);
        };

        let section1 = pickSection("favorite-artists");
        const section2 = pickSection("discovery");

        // Fallback: if BOTH personalized archive sections are empty, show the
        // featured matrix in section 1 (isFallback hides section 2 so we don't
        // double-render the same grid).
        const isFallback = section1.length === 0 && section2.length === 0;
        if (isFallback) {
          // Openers who got the fallback last week already saw the top pick in
          // each scene×tempo cell — rotate them to the NEXT-best archive per
          // cell by excluding what they were shown (`seen` = lastWeeklyRecShows).
          // Non-openers (or anyone with no history) keep the shared strongest
          // grid — they never saw it, so burning it would be wrong (mirrors the
          // personalized non-opener rule).
          if (openedLastWeek && Object.keys(seen).length > 0) {
            const rotated = buildFeaturedMatrix(allArchives, {
              excludeTempos: ["very_fast"],
              excludeArchiveIds: new Set(Object.keys(seen)),
            });
            // If exclusion empties a cell entirely (tiny catalog for that
            // scene×tempo), fall back to the shared grid so we never send an
            // empty email.
            section1 = rotated.length > 0 ? rotated.map((a) => archiveToRow(a)) : featuredRows;
          } else {
            section1 = featuredRows;
          }
        }

        // Cap IRL events at the 5 nearest (mirrors the go-live email). Online
        // shows are unbounded — comingUp is chronological, so keep every online
        // row and only the first 5 IRL rows.
        let irlSeen = 0;
        const comingUp: WeeklyRecComingUpRow[] = payload.comingUp
          .filter((r) => (r.isIRL ? ++irlSeen <= 5 : true))
          .map((r) => ({
            showName: r.eventName || r.djName || "",
            djName: r.djName,
            djUsername: r.djUsername,
            djPhotoUrl: r.djPhotoUrl,
            showImageUrl: r.eventPhotoUrl,
            stationId: "broadcast",
            startTime: new Date(r.startMs).toISOString(),
            isIRL: r.isIRL,
            linkUrl: r.isIRL ? r.ticketUrl : undefined,
            // IRL lineups: full artist list for the sub-line (capped in the row builder).
            allDjArtists: r.isIRL
              ? (r.allDjs || []).map((d) => d.djName).filter((n): n is string => !!n)
              : undefined,
            venueName: r.isIRL ? r.venueName : undefined,
            collectiveSlug: r.isIRL ? (r.collectiveSlug || undefined) : undefined,
            discountCode: r.isIRL ? (r.discountCode || undefined) : undefined,
          }));

        if (dryRun && !previewTo) {
          if (trace.length < traceLimit) {
            trace.push({ email, s1: section1.length, s2: section2.length, comingUp: comingUp.length, fallback: isFallback });
          }
          emailsSent++; // count as would-send
          continue;
        }

        // Cohort → subject + hand-written intro. Same test the report run uses
        // to bucket opens, so send and report always agree.
        const cohort: IntroCohort = data.role === "dj" ? "dj" : "listener";
        const firstName = resolveFirstName(
          email,
          data.name as string | undefined,
          data.chatUsername as string | undefined,
          data.displayName as string | undefined,
        );
        const latestShowSlug =
          cohort === "dj" ? latestShowByUid.get(userDoc.id)?.slug : undefined;

        const ok = await sendWeeklyRecommendationsEmail({
          // In preview mode, redirect delivery to deliverTo if given (render
          // THIS user's content, send it to the admin's inbox).
          to: previewTo && deliverTo ? deliverTo : email,
          subject: introSubjectFor(cohort),
          introHtml: buildIntroHtml(cohort, firstName, latestShowSlug),
          userTimezone: data.timezone as string | undefined,
          section1,
          section2: isFallback ? [] : section2,
          comingUp,
          isFallback,
          recipientUid: userDoc.id, // CTA deep-links the recipient's own /scene
          openedLastWeek,
          wasFallbackLastWeek: data.lastWeeklyRecLastWasFallback === true,
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
        // Ordered record of exactly what we showed (for next week's rotation).
        // Recorded for BOTH the personalized and the fallback grid — the
        // fallback needs it so openers rotate to fresh featured picks next week
        // (excludeArchiveIds above reads exactly these ids back as `seen`).
        // section2 is empty on a fallback send, so this naturally records just
        // the featured grid there.
        const shownIds: string[] = [];
        for (const r of [...section1, ...section2]) {
          const a = allArchives.find((x) => x.slug === r.slug);
          if (a) {
            updatedSeen[a.id] = nowIso;
            shownIds.push(a.id);
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
          // Cap IRL events at the 5 nearest (mirrors the go-live email + the
          // per-user path above). Online shows stay unbounded.
          let irlSeen = 0;
          const mapped: WeeklyRecComingUpRow[] = rows
            .filter((r) => (r.isIRL ? ++irlSeen <= 5 : true))
            .map((r) => ({
              showName: r.eventName || r.djName || "",
              djName: r.djName,
              djUsername: r.djUsername,
              djPhotoUrl: r.djPhotoUrl,
              showImageUrl: r.eventPhotoUrl,
              stationId: "broadcast",
              startTime: new Date(r.startMs).toISOString(),
              isIRL: r.isIRL,
              linkUrl: r.isIRL ? r.ticketUrl : undefined,
              allDjArtists: r.isIRL
                ? (r.allDjs || []).map((d) => d.djName).filter((n): n is string => !!n)
                : undefined,
              venueName: r.isIRL ? r.venueName : undefined,
              collectiveSlug: r.isIRL ? (r.collectiveSlug || undefined) : undefined,
              discountCode: r.isIRL ? (r.discountCode || undefined) : undefined,
            }));
          comingUpByCity.set(city, mapped);
          return mapped;
        };

        // Non-users have no `users` doc, but they DO have a writable
        // pending-dj-profiles / radio-notify-waitlist doc keyed by r.id. We
        // store their fallback open/seen history THERE so they rotate the
        // featured grid week-over-week just like the users loop. Locate the doc
        // across both source collections (whichever exists).
        const findExtraDoc = async (id: string) => {
          for (const coll of ["pending-dj-profiles", "radio-notify-waitlist"]) {
            const snap = await db.collection(coll).doc(id).get();
            if (snap.exists) return snap;
          }
          return null;
        };

        for (const r of extras) {
          // Honor the same shard split as the users loop (hash on the doc id).
          if (shard != null && !uidInShard(r.id, shard, shardCount)) continue;
          // previewTo: only the one preview recipient.
          if (previewTo && r.email.toLowerCase() !== previewTo) continue;

          const recipientCity = r.city || DEFAULT_FEATURED_CITY;
          const comingUp = await comingUpForCity(recipientCity);

          // Read their fallback history off their own source doc. Openers with a
          // seeded seen-map rotate to a fresh grid (exclude what they saw); non-
          // openers / no-history keep the shared strongest grid.
          const extraDoc = await findExtraDoc(r.id);
          const extraData = extraDoc?.data() || {};

          // Same-week dedup (real sends only): skip if their source doc was
          // stamped within the window. Mirrors the users loop; lets us pre-stamp
          // a non-user to suppress them from an imminent send. Preview bypasses.
          if (!previewTo) {
            const lastMs = emailAtMs(extraData.lastWeeklyRecEmailAt);
            if (lastMs != null && nowMs - lastMs < RECENT_SEND_DEDUP_MS) { skippedRecentSend++; continue; }
          }

          const extraSeen = (extraData.lastWeeklyRecShows as Record<string, string> | undefined) || {};
          const extraOpened = extraData.lastWeeklyRecOpenedLast === true;
          let extraSection1 = featuredRows;
          if (extraOpened && Object.keys(extraSeen).length > 0) {
            const rotated = buildFeaturedMatrix(allArchives, {
              excludeTempos: ["very_fast"],
              excludeArchiveIds: new Set(Object.keys(extraSeen)),
            });
            extraSection1 = rotated.length > 0 ? rotated.map((a) => archiveToRow(a)) : featuredRows;
          }

          if (dryRun && !previewTo) {
            if (trace.length < traceLimit) {
              trace.push({ email: r.email, s1: extraSection1.length, s2: 0, comingUp: comingUp.length, fallback: true });
            }
            fallbackExtraSent++;
            continue;
          }

          try {
            const ok = await sendWeeklyRecommendationsEmail({
              // In preview mode, redirect delivery to deliverTo (send the
              // rendered non-user email to the admin, never the real person).
              to: previewTo && deliverTo ? deliverTo : r.email,
              // This pass reaches pending-dj-profiles / waitlist / EXTRA_LISTENERS
              // only — everyone with a users doc was handled in pass 1. No users
              // doc means no role, so these are listeners by construction.
              subject: introSubjectFor("listener"),
              introHtml: buildIntroHtml("listener", r.name),
              userTimezone: undefined, // no users doc → default PT
              section1: extraSection1,
              section2: [],
              comingUp,
              isFallback: true,
              recipientUid: r.id, // hidden CTA in fallback; harmless if it doesn't resolve
              openedLastWeek: extraOpened, // openers get the "Worth your time" eyebrow
            });
            if (!ok) { failed++; continue; }
            fallbackExtraSent++;

            // previewTo sends but never stamps. Stamp the shown grid onto their
            // source doc so next week rotates (mirrors the users loop). Prune to
            // the 3-week window. Non-openers who were never seeded still get
            // stamped here once they've been sent to — that's fine, it just
            // starts their history; it does NOT retroactively mark them opened.
            if (!previewTo && extraDoc) {
              const updated: Record<string, string> = {};
              const cutoff = nowMs - RECENT_RETENTION_MS;
              for (const [id, iso] of Object.entries(extraSeen)) {
                if (Date.parse(iso) >= cutoff) updated[id] = iso;
              }
              const nowIso = new Date(nowMs).toISOString();
              const shown: string[] = [];
              for (const row of extraSection1) {
                const a = allArchives.find((x) => x.slug === row.slug);
                if (a) { updated[a.id] = nowIso; shown.push(a.id); }
              }
              await extraDoc.ref.set(
                {
                  lastWeeklyRecEmailAt: FieldValue.serverTimestamp(),
                  lastWeeklyRecShows: updated,
                  lastWeeklyRecShownIds: shown,
                  lastWeeklyRecOpenedLast: false, // report/backfill re-stamps opens
                  lastWeeklyRecLastWasFallback: true, // non-users are always fallback
                },
                { merge: true },
              );
            }
          } catch (e) {
            failed++;
            console.error(`[weekly-recommendations] extra ${r.id} (${r.email}):`, e);
          }
        }
      }
    }

    // Persist per-user engagement stats for the admin Users tab. One small doc
    // per user under system/user-stats/entries — scales past a single-doc map,
    // and the Users tab reads the whole subcollection in one .get(). Skipped-
    // fresh users aren't in `userStats`, so their existing entry is left intact.
    if (mode === "backfill" && !dryRun && !previewTo) {
      const entriesCol = db.collection("system").doc("user-stats").collection("entries");
      const entryUids = Object.keys(userStats);
      for (let i = 0; i < entryUids.length; i += 400) {
        const batch = db.batch();
        for (const uid of entryUids.slice(i, i + 400)) {
          batch.set(entriesCol.doc(uid), userStats[uid], { merge: true });
        }
        await batch.commit();
      }
    }

    // BACKFILL run: stamp a status doc. The full run's doc (weekly-rec-backfill-
    // status) is what the SEND run gates on and drives the "Newsletter readiness"
    // Tech Health line; the scope=active daily run stamps a SEPARATE doc
    // (daily-rec-status) that drives the "Daily recs cron" line. Keyed per shard.
    // usersScanned reflects the users actually considered by this scope (all for
    // full; active-only for the daily run) so failRate math stays meaningful.
    if (mode === "backfill" && !dryRun && !previewTo) {
      // For the active daily run, "scanned" = users that passed the active
      // filter and reached a generation attempt (generated + skipped-fresh +
      // failed) — NOT the whole user table, so failRate = failed/scanned
      // reflects active users.
      const usersScanned = scope === "active" ? generated + skippedFresh + failed : usersSnap.size;
      await db
        .collection("system")
        .doc(statusDocId(scope, shard))
        .set({
          completedAtMs: nowMs,
          usersScanned,
          generated,
          skippedFresh,
          failed,
          shard,
          scope,
        });
    }

    return NextResponse.json({
      mode: mode ?? "legacy",
      scope,
      dryRun,
      previewTo: previewTo ?? null,
      shard,
      usersScanned: usersSnap.size,
      generated,
      emailsSent,
      fallbackExtraSent,
      skippedOptOut,
      skippedNoEmail,
      skippedRecentSend,
      skippedDormant,
      skippedFresh,
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
    // Poll Resend for last week's sends (read-only) — one query per cohort
    // subject. A subject missing from WEEKLY_SUBJECTS means that cohort's opens
    // are never seen, so `lastWeeklyRecOpenedLast` silently stops stamping for
    // them and the open-gated rotation degrades. Cohort BUCKETING below keys off
    // `role`, not the subject; the subject is only how we find the sends.
    const polls = await Promise.all(
      WEEKLY_SUBJECTS.map((subject) =>
        listResendEmails({
          apiKey,
          sinceMs: nowMs - LAST_SEND_WINDOW_START_MS,
          untilMs: nowMs - LAST_SEND_WINDOW_END_MS,
          subject,
        }),
      ),
    );
    const rows = polls.flatMap((p) => p.rows);
    const truncated = polls.some((p) => p.truncated);
    const pagesFetched = polls.reduce((n, p) => n + p.pagesFetched, 0);
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
