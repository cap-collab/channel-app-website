import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

const SUTRO_HOME_URL = "https://sutrofm.net/";
const SUTRO_RESIDENTS_URL = "https://sutrofm.net/#residents";

// Aliases for residents whose Sutro display name differs from how they appear in
// the schedule's `j` field (which becomes ShowV2.j in metadata.json). The cron
// creates the pending profile under the canonical (fuller) name and reserves
// the alias handle so both schedule strings link to the same DJ profile.
//
// Format: residentDisplayName → { canonical, aliases }
//   - canonical: the display name to store on the pending profile
//   - aliases:   additional handles to reserve in the `usernames` collection
//
// To check for new mismatches, run scripts/test-sutro-scraper.js in Channel-Media.
const SUTRO_NAME_ALIASES: Record<string, { canonical: string; aliases: string[] }> = {
  "Tristes T.": { canonical: "Tristes Tropiques", aliases: ["Tristes T."] },
  "The Man From Dyatron": { canonical: "The Man From Dyatron", aliases: ["TMFD"] },
};

interface SutroResident {
  showName: string;
  soundcloudUrl: string;
  residents: string[];
}

function normalizeForId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// Parse the residents block on https://sutrofm.net/.
// Anchors on data-framer-name (content-stable across Framer publishes) rather
// than CSS class names (which Framer regenerates).
function parseResidents(html: string): SutroResident[] {
  const postRe = /<a[^>]*data-framer-name="Post"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const showNameRe = /data-framer-name="AYLI Radio"[^>]*>[\s\S]*?<p[^>]*>([^<]+)<\/p>/;
  const residentBlockRe = /data-framer-name="resident \d+"[^>]*>([\s\S]*?)(?=data-framer-name="resident \d+"|<\/div><\/div><\/div><\/div>|$)/g;
  const residentNameRe = /data-framer-component-type="RichTextContainer"[^>]*>[\s\S]*?<p[^>]*>([^<]+)<\/p>/g;

  const seen = new Set<string>();
  const results: SutroResident[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = postRe.exec(html)) !== null) {
    const href = decodeEntities(pm[1]).trim();
    const inner = pm[2];
    const showM = inner.match(showNameRe);
    if (!showM) continue;
    const showName = decodeEntities(showM[1]).trim();
    const dedupeKey = `${showName}|${href}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const residents: string[] = [];
    let bm: RegExpExecArray | null;
    residentBlockRe.lastIndex = 0;
    while ((bm = residentBlockRe.exec(inner)) !== null) {
      const block = bm[1];
      let rm: RegExpExecArray | null;
      residentNameRe.lastIndex = 0;
      while ((rm = residentNameRe.exec(block)) !== null) {
        const txt = decodeEntities(rm[1]).trim();
        if (!txt || txt === "/" || txt === " ") continue;
        if (!residents.includes(txt)) residents.push(txt);
      }
    }
    results.push({ showName, soundcloudUrl: href, residents });
  }
  return results;
}

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json(
      { error: "Firebase Admin SDK not configured" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(SUTRO_HOME_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (res.status !== 200) {
      return NextResponse.json(
        { error: "Failed to fetch Sutro home", status: res.status },
        { status: 500 }
      );
    }
    const html = await res.text();
    const shows = parseResidents(html);

    if (shows.length === 0) {
      return NextResponse.json(
        {
          error: "Sutro residents block not found",
          hint: "Selector may need updating. Verify https://sutrofm.net/#residents still uses data-framer-name='Post' anchors.",
        },
        { status: 500 }
      );
    }
    const totalResidents = shows.reduce((sum, s) => sum + s.residents.length, 0);
    console.log(`[sync-sutro-residents] Parsed ${shows.length} shows → ${totalResidents} residents`);

    const pendingProfilesRef = db.collection("pending-dj-profiles");
    let created = 0;
    let updated = 0;
    let skipped = 0;

    const BATCH_SIZE = 500;
    let batch = db.batch();
    let batchCount = 0;

    // Track unique residents so we don't double-process when a person appears
    // in multiple shows (e.g. DJ Buck in both Natural Selection and
    // Strap2StrapOnline). The first encounter creates the doc; subsequent
    // encounters append to autoSources.
    const seenResidents = new Map<string, { displayName: string; canonical: string }>();

    for (const show of shows) {
      for (const resident of show.residents) {
        const alias = SUTRO_NAME_ALIASES[resident];
        const canonical = alias ? alias.canonical : resident;
        const normalizedId = normalizeForId(canonical);
        if (!normalizedId) {
          skipped++;
          continue;
        }

        const docRef = pendingProfilesRef.doc(normalizedId);
        const existingDoc = await docRef.get();
        const now = new Date();

        const sutroAutoSource = {
          stationId: "sutro",
          showName: show.showName,
          lastSeen: now,
        };

        if (existingDoc.exists) {
          const existingData = existingDoc.data();
          if (existingData?.source !== "auto") {
            skipped++;
            continue;
          }
          // Append a new sutro autoSource entry (or refresh existing one for
          // this show), preserving entries from other stations.
          const existingSources: Array<{ stationId: string; showName: string; lastSeen: unknown }> =
            Array.isArray(existingData.autoSources) ? existingData.autoSources : [];
          const otherSources = existingSources.filter(
            (s) => !(s.stationId === "sutro" && s.showName === show.showName)
          );
          const nextSources = [...otherSources, sutroAutoSource];

          const update: Record<string, unknown> = {
            djName: canonical,
            chatUsername: canonical,
            chatUsernameNormalized: normalizedId,
            normalizedName: canonical.toLowerCase(),
            autoSources: nextSources,
            "djProfile.socialLinks.soundcloud": show.soundcloudUrl,
            validatedFrom: SUTRO_RESIDENTS_URL,
            updatedAt: now,
          };
          batch.update(docRef, update);
          if (!seenResidents.has(normalizedId)) updated++;
        } else {
          batch.set(docRef, {
            djName: canonical,
            chatUsername: canonical,
            chatUsernameNormalized: normalizedId,
            normalizedName: canonical.toLowerCase(),
            source: "auto",
            status: "pending",
            autoSources: [sutroAutoSource],
            djProfile: {
              bio: null,
              photoUrl: null,
              location: null,
              genres: [],
              socialLinks: { soundcloud: show.soundcloudUrl },
            },
            validatedFrom: SUTRO_RESIDENTS_URL,
            createdAt: now,
            updatedAt: now,
          });
          created++;
        }

        seenResidents.set(normalizedId, { displayName: resident, canonical });
        batchCount++;

        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
          console.log(`[sync-sutro-residents] Committed batch (${created + updated + skipped} processed)`);
        }
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    // Reserve canonical + alias usernames so the orchestrator's
    // findMatchingProfiles links shows to these pending DJs.
    let usernamesReserved = 0;
    const usernamesRef = db.collection("usernames");
    for (const [normalizedId, info] of Array.from(seenResidents.entries())) {
      const usernameDoc = await usernamesRef.doc(normalizedId).get();
      if (!usernameDoc.exists) {
        await usernamesRef.doc(normalizedId).set({
          displayName: info.canonical,
          usernameHandle: normalizedId,
          uid: `pending:${normalizedId}`,
          isPending: true,
          claimedAt: FieldValue.serverTimestamp(),
        });
        usernamesReserved++;
      }
      // Also reserve any alias handles (e.g. "TMFD" for "The Man From Dyatron")
      // so schedule strings using the abbreviation still match the same DJ.
      const aliasEntry = SUTRO_NAME_ALIASES[info.displayName];
      if (aliasEntry) {
        for (const alias of aliasEntry.aliases) {
          const aliasId = normalizeForId(alias);
          if (!aliasId || aliasId === normalizedId) continue;
          const aliasDoc = await usernamesRef.doc(aliasId).get();
          if (!aliasDoc.exists) {
            await usernamesRef.doc(aliasId).set({
              displayName: info.canonical,
              usernameHandle: aliasId,
              uid: `pending:${normalizedId}`,
              isPending: true,
              isAlias: true,
              claimedAt: FieldValue.serverTimestamp(),
            });
            usernamesReserved++;
          }
        }
      }
    }

    console.log(
      `[sync-sutro-residents] Complete: shows=${shows.length}, residents=${totalResidents}, created=${created}, updated=${updated}, skipped=${skipped}, usernamesReserved=${usernamesReserved}`
    );

    return NextResponse.json({
      success: true,
      totalShows: shows.length,
      totalResidents,
      created,
      updated,
      skipped,
      usernamesReserved,
    });
  } catch (error) {
    console.error("[sync-sutro-residents] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to sync Sutro residents", details: errorMessage },
      { status: 500 }
    );
  }
}
