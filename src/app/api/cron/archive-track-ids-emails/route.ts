import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { sendArchiveTrackIdsEmail } from '@/lib/email';
import { resolveFirstName, EXCLUDE_EMAILS } from '@/lib/channel-newsletter';
import { normalizeUsername } from '@/lib/dj-matching';
import { normalizeTrackIds, playedTrackTags, PlayedTrackTag } from '@/lib/track-ids';

// Small queue drain (only archives flagged 'pending' since the last run), so
// this never approaches the budget — but give headroom.
export const maxDuration = 120;

const DJ_ROLES = new Set(['dj', 'broadcaster', 'admin']);
const HEART = '\u{1F90D}'; // 🤍

function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// Grammatical join: ["A"]→"A", ["A","B"]→"A and B", ["A","B","C"]→"A, B and C".
function joinNames(items: string[]): string {
  if (items.length <= 1) return items[0] || '';
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The bold relationship paragraph HTML for a per-archive email: either "you
// played X by <DJ> … 🤍" (when tags resolved) or the fallback invite. URLs
// are not used here (unlike the one-time blast's played-by variant).
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

export async function GET(request: NextRequest) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  // Indexed pending-only query — never a full-collection scan.
  const pendingSnap = await db
    .collection('archives')
    .where('trackIdsReadyEmailStatus', '==', 'pending')
    .get();

  // Preload collectives → slug→owners[] for collective-archive owner resolution.
  const collectivesSnap = await db.collection('collectives').get();
  const slugToOwners = new Map<string, string[]>();
  for (const doc of collectivesSnap.docs) {
    const d = doc.data();
    if (d.slug && Array.isArray(d.owners)) slugToOwners.set(String(d.slug), d.owners.map(String));
  }

  // Cache tag-handle → tagged DJ name (chatUsername) so repeated tags don't re-query.
  const tagNameCache = new Map<string, string | null>();
  async function resolveTagName(normalizedHandle: string): Promise<string | null> {
    if (tagNameCache.has(normalizedHandle)) return tagNameCache.get(normalizedHandle)!;
    const s = await db!
      .collection('users')
      .where('chatUsernameNormalized', '==', normalizedHandle)
      .limit(1)
      .get();
    const name = s.empty ? null : String(s.docs[0].data().chatUsername || s.docs[0].data().name || '') || null;
    tagNameCache.set(normalizedHandle, name);
    return name;
  }

  const result = { pending: pendingSnap.size, sent: 0, skipped: 0, errors: [] as string[], dryRun,
    wouldSend: [] as { email: string; firstName: string; tags: number }[] };

  for (const doc of pendingSnap.docs) {
    const a = doc.data();

    // Defensive: only email archives that actually have track IDs and aren't
    // hidden. Anything ineligible leaves the queue as 'sent' (no email) so it
    // doesn't jam the pending query forever.
    const tracks = normalizeTrackIds(a.trackIds);
    if (tracks.length === 0 || a.priority === 'hidden') {
      result.skipped++;
      if (!dryRun) await doc.ref.update({ trackIdsReadyEmailStatus: 'sent', trackIdsReadyEmailSentAt: Date.now() });
      continue;
    }

    // Resolve the PRIMARY owner uid(s). Uploads → uploadedBy; live → djs[0].userId;
    // collective archive (djs[0].username === slug) → each owner uid.
    const ownerUids: string[] = [];
    const primaryUsername = Array.isArray(a.djs) && a.djs[0]?.username ? String(a.djs[0].username) : null;
    if (primaryUsername && slugToOwners.has(primaryUsername)) {
      ownerUids.push(...slugToOwners.get(primaryUsername)!);
    } else if (typeof a.uploadedBy === 'string' && a.uploadedBy.trim()) {
      ownerUids.push(a.uploadedBy);
    } else if (Array.isArray(a.djs) && a.djs[0]?.userId) {
      ownerUids.push(String(a.djs[0].userId));
    }

    if (ownerUids.length === 0) {
      // No resolvable owner — drop from queue with a logged reason.
      result.errors.push(`${doc.id}: no resolvable owner`);
      if (!dryRun) await doc.ref.update({ trackIdsReadyEmailStatus: 'sent', trackIdsReadyEmailSentAt: Date.now() });
      continue;
    }

      // Pre-resolve every tag handle on this archive (async Firestore lookups),
    // then feed the shared playedTrackTags() a synchronous cache-backed resolver
    // so the script and cron derive relationships identically.
    for (const t of tracks) {
      if (t.private || !t.djUsername) continue;
      await resolveTagName(normalizeUsername(t.djUsername)); // warm the cache
    }
    const tags = playedTrackTags(a.trackIds, normalizeUsername, (h) => tagNameCache.get(h) ?? null);
    const relHtml = relationshipHtml(tags);

    // Send to each owner (usually one; collectives can have a few).
    let sentAny = false;
    for (const uid of Array.from(new Set(ownerUids))) {
      const uSnap = await db.collection('users').doc(uid).get();
      if (!uSnap.exists) { result.skipped++; continue; }
      const u = uSnap.data()!;
      const email = String(u.email || '').trim().toLowerCase();
      if (!email) { result.skipped++; continue; }
      if (!DJ_ROLES.has(String(u.role || ''))) { result.skipped++; continue; }
      if (EXCLUDE_EMAILS.has(email)) { result.skipped++; continue; }

      const firstName = resolveFirstName(email, u.name, u.chatUsername, u.displayName);
      const profileSlug = (u.chatUsernameNormalized && String(u.chatUsernameNormalized)) || null;
      const signInMethod = typeof u.signInMethod === 'string' ? u.signInMethod : undefined;

      if (dryRun) {
        result.wouldSend.push({ email, firstName, tags: tags.length });
        sentAny = true;
        continue;
      }

      const ok = await sendArchiveTrackIdsEmail({
        to: email,
        djName: firstName,
        profileSlug,
        relationshipHtml: relHtml,
        signInMethod,
        signInEmail: email,
      });
      if (ok) { result.sent++; sentAny = true; }
      else result.errors.push(`${doc.id}: send failed for ${email}`);
    }

    // Stamp 'sent' only if at least one owner was emailed (or dry-run listed).
    // A hard send failure to every owner leaves it 'pending' to retry next run.
    if (!dryRun && sentAny) {
      await doc.ref.update({ trackIdsReadyEmailStatus: 'sent', trackIdsReadyEmailSentAt: Date.now() });
    }
  }

  if (!dryRun) {
    await db.collection('system').doc('archive-track-ids-emails-status').set({
      lastRunAt: Date.now(), ...result,
    });
  }

  return NextResponse.json(result);
}
