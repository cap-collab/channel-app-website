// Shared "your track IDs are ready" send path.
//
// One archive → resolve its show owner(s) → resolve any played-track DJ tags →
// send the per-archive email → stamp `trackIdsReadyEmailStatus: 'sent'`.
//
// Used by BOTH:
//   • the metadata route, which sends immediately the first time an admin
//     generates track IDs for an archive (the common case), and
//   • the daily archive-track-ids-emails cron, which drains any archive left
//     'pending' (e.g. a click-time send that failed on a transient error).
//
// Both call sites derive owners + relationships identically because the logic
// lives here once.

import type { Firestore } from "firebase-admin/firestore";
import { sendArchiveTrackIdsEmail } from "@/lib/email";
import { resolveFirstName, EXCLUDE_EMAILS } from "@/lib/channel-newsletter";
import { normalizeUsername } from "@/lib/dj-matching";
import { normalizeTrackIds, playedTrackTags, PlayedTrackTag } from "@/lib/track-ids";

const DJ_ROLES = new Set(["dj", "broadcaster", "admin"]);
const HEART = "\u{1F90D}"; // 🤍

// Grammatical join: ["A"]→"A", ["A","B"]→"A and B", ["A","B","C"]→"A, B and C".
function joinNames(items: string[]): string {
  if (items.length <= 1) return items[0] || "";
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// The bold relationship paragraph HTML: either "you played X by <DJ> … 🤍"
// (when tags resolved) or the fallback invite.
function relationshipHtml(tags: PlayedTrackTag[]): string {
  if (tags.length) {
    const phrase = joinNames(tags.map((t) => `${t.trackTitle} by ${t.djName}`));
    const line =
      `We noticed you played ${phrase}. We've linked it to their profile and let them know. ` +
      `Thanks for supporting fellow channel artists. ${HEART}`;
    return `<strong>${escapeHtml(line)}</strong>`;
  }
  const line =
    `If you played a track from another channel artist and I missed it, just let me know. ` +
    `I'll link the track to their profile and make sure they see it ${HEART}`;
  return `<strong>${escapeHtml(line)}</strong>`;
}

export interface TrackIdsEmailOutcome {
  // 'sent'    → at least one owner emailed; caller should stamp 'sent'.
  // 'skipped' → ineligible (no tracks / hidden / no resolvable owner / no
  //             eligible owner email); caller should stamp 'sent' so it never
  //             re-queues, but NO email went out.
  // 'failed'  → had eligible owner(s) but every send errored; caller should
  //             leave it 'pending' so the cron retries.
  status: "sent" | "skipped" | "failed";
  sentCount: number;
  reason?: string;
}

// Resolve owners + tags for one archive and send the email to each owner.
// Pure send — does NOT write the archive doc; the caller owns the status stamp
// (so the metadata route and the cron can each stamp in their own transaction
// shape). `slugToOwners` maps a collective slug → its owner uids; pass a
// prebuilt map (cron builds it once per run) or let this build one on demand.
export async function sendTrackIdsEmailForArchive(
  db: Firestore,
  archive: { id: string; data: Record<string, unknown> },
  opts?: { slugToOwners?: Map<string, string[]> },
): Promise<TrackIdsEmailOutcome> {
  const a = archive.data;

  // Only email archives that actually have track IDs and aren't hidden.
  const tracks = normalizeTrackIds(a.trackIds);
  if (tracks.length === 0 || a.priority === "hidden") {
    return { status: "skipped", sentCount: 0, reason: "no tracks or hidden" };
  }

  // Collective slug → owners[]. Reuse the caller's map when provided.
  let slugToOwners = opts?.slugToOwners;
  const primaryUsername =
    Array.isArray(a.djs) && a.djs[0]?.username ? String(a.djs[0].username) : null;
  if (!slugToOwners && primaryUsername) {
    slugToOwners = new Map<string, string[]>();
    const cSnap = await db
      .collection("collectives")
      .where("slug", "==", primaryUsername)
      .limit(1)
      .get();
    if (!cSnap.empty) {
      const d = cSnap.docs[0].data();
      if (d.slug && Array.isArray(d.owners)) {
        slugToOwners.set(String(d.slug), d.owners.map(String));
      }
    }
  }

  // Resolve the PRIMARY owner uid(s). collective archive → each owner uid;
  // uploads → uploadedBy; live → djs[0].userId.
  const ownerUids: string[] = [];
  if (primaryUsername && slugToOwners?.has(primaryUsername)) {
    ownerUids.push(...slugToOwners.get(primaryUsername)!);
  } else if (typeof a.uploadedBy === "string" && a.uploadedBy.trim()) {
    ownerUids.push(a.uploadedBy);
  } else if (Array.isArray(a.djs) && a.djs[0]?.userId) {
    ownerUids.push(String(a.djs[0].userId));
  }

  if (ownerUids.length === 0) {
    return { status: "skipped", sentCount: 0, reason: "no resolvable owner" };
  }

  // Resolve played-track DJ tags → { trackTitle, djName } via chatUsernameNormalized.
  const tagNameCache = new Map<string, string | null>();
  for (const t of tracks) {
    if (t.private || !t.djUsername) continue;
    const handle = normalizeUsername(t.djUsername);
    if (tagNameCache.has(handle)) continue;
    const s = await db
      .collection("users")
      .where("chatUsernameNormalized", "==", handle)
      .limit(1)
      .get();
    const name = s.empty
      ? null
      : String(s.docs[0].data().chatUsername || s.docs[0].data().name || "") || null;
    tagNameCache.set(handle, name);
  }
  const tags = playedTrackTags(a.trackIds, normalizeUsername, (h) => tagNameCache.get(h) ?? null);
  const relHtml = relationshipHtml(tags);

  // Send to each owner (usually one; collectives can have a few).
  let sentCount = 0;
  let hadEligibleOwner = false;
  for (const uid of Array.from(new Set(ownerUids))) {
    const uSnap = await db.collection("users").doc(uid).get();
    if (!uSnap.exists) continue;
    const u = uSnap.data()!;
    const email = String(u.email || "").trim().toLowerCase();
    if (!email) continue;
    if (!DJ_ROLES.has(String(u.role || ""))) continue;
    if (EXCLUDE_EMAILS.has(email)) continue;

    hadEligibleOwner = true;
    const firstName = resolveFirstName(email, u.name, u.chatUsername, u.displayName);
    const profileSlug = (u.chatUsernameNormalized && String(u.chatUsernameNormalized)) || null;
    const signInMethod = typeof u.signInMethod === "string" ? u.signInMethod : undefined;

    const ok = await sendArchiveTrackIdsEmail({
      to: email,
      djName: firstName,
      profileSlug,
      relationshipHtml: relHtml,
      signInMethod,
      signInEmail: email,
    });
    if (ok) sentCount++;
  }

  if (sentCount > 0) return { status: "sent", sentCount };
  // Eligible owner existed but every send errored → retryable. No eligible
  // owner at all → skip (stamp 'sent' so it doesn't jam the queue forever).
  return hadEligibleOwner
    ? { status: "failed", sentCount: 0, reason: "all sends failed" }
    : { status: "skipped", sentCount: 0, reason: "no eligible owner email" };
}
