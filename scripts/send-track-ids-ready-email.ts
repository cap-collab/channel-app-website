/**
 * One-off: email every DJ and collective owner who has track IDs on at least
 * one of their archives, announcing the first version of automatic track IDs.
 *
 * Recipient = any user (role dj/broadcaster/admin) associated with an archive
 * that has a non-empty `trackIds`, via:
 *   - archive.uploadedBy (uploader/owner of an uploaded recording)
 *   - archive.djs[].userId (credited DJs; djs[0] carries live-recording owners)
 *   - collective owners: archive.djs[0].username === collective.slug
 *       → collectives.owners[] (Firebase UIDs)
 *
 * Hidden archives (priority === 'hidden') are ignored — a hidden show's tracks
 * aren't visible to the DJ's audience so they aren't part of this launch.
 *
 * Dedupes by email. Greeting via resolveFirstName (override → name →
 * displayName → chatUsername → "Hi" with no name). Respects EXCLUDE_EMAILS.
 *
 * Usage:
 *   npx tsx scripts/send-track-ids-ready-email.ts            # dry-run: print the mailing list, send nothing
 *   npx tsx scripts/send-track-ids-ready-email.ts --send     # actually send
 *   npx tsx scripts/send-track-ids-ready-email.ts --only=you@x.com   # dry-run/send to one address (test)
 */
import './lib/load-env';
import { getAdminDb } from '../src/lib/firebase-admin';
import { normalizeTrackIds } from '../src/lib/track-ids';
import {
  resolveFirstName,
  EXCLUDE_EMAILS,
  NEWSLETTER_FROM_EMAIL,
  buildListUnsubscribeHeaders,
} from '../src/lib/channel-newsletter';
import { Resend } from 'resend';

const SUBJECT = 'Your track IDs are ready';
const DJ_ROLES = new Set(['dj', 'broadcaster', 'admin']);

// DJs with no real personal name — their resolved "first name" is a DJ handle
// (TAJ, Liquid Giraffe, logo, Rivussy) or username. Force a plain "Hi," rather
// than greeting a handle. Confirmed by Cap 2026-07-08.
const FORCE_PLAIN_GREETING = new Set<string>([
  'theaveragejoe45s@gmail.com',
  'liquidgiraffemusic@gmail.com',
  'laurengold404@gmail.com',
  'grok.tunes@gmail.com',
  'antumau.mo@gmail.com',
]);

interface Target {
  uid: string;
  email: string;
  firstName: string;
  archiveCount: number; // # of their archives with track IDs (audit signal)
}

// Plain-text email — no branded wrapper, no button, no logo, no explicit
// unsubscribe UI. Just the message, with an inline clickable studio link.
// (List-Unsubscribe header is still attached at send time for deliverability.)
// If firstName is "there" (no name resolved), open with plain "Hi,".
function buildEmailHtml(firstName: string): string {
  const greeting = firstName === 'there' ? 'Hi,' : `Hi ${firstName},`;
  return [
    `${greeting}`,
    '',
    'I just launched a first version of automatic track IDs.',
    '',
    "<strong>I've generated track IDs for your existing shows, and they're now available on your profile.</strong>",
    '',
    'You can review them anytime, edit any track, add missing ones, or make individual tracks private from your Studio page:',
    '<a href="https://channel-app.com/studio">channel-app.com/studio</a>',
    '',
    "I'm sharing the feature with DJs first while I test and refine it before officially launching it to listeners next week.",
    '',
    "If you notice anything inaccurate, have ideas for improving it, or run into any issues, I'd really appreciate your feedback.",
    '',
    'Thanks again for helping me build Channel.',
    '',
    'Cap',
  ].join('\n').replace(/\n/g, '<br />\n');
}

// Plain-text alternative (helps deliverability; some clients prefer it).
function buildEmailText(firstName: string): string {
  const greeting = firstName === 'there' ? 'Hi,' : `Hi ${firstName},`;
  return [
    greeting,
    '',
    'I just launched a first version of automatic track IDs.',
    '',
    "I've generated track IDs for your existing shows, and they're now available on your profile.",
    '',
    'You can review them anytime, edit any track, add missing ones, or make individual tracks private from your Studio page:',
    'https://channel-app.com/studio',
    '',
    "I'm sharing the feature with DJs first while I test and refine it before officially launching it to listeners next week.",
    '',
    "If you notice anything inaccurate, have ideas for improving it, or run into any issues, I'd really appreciate your feedback.",
    '',
    'Thanks again for helping me build Channel.',
    '',
    'Cap',
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes('--send');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).toLowerCase() : null;

  // --preview=<email>: send ONE sample email (exact template + send path) to
  // any address, bypassing the recipient list. For eyeballing before the real send.
  const previewArg = args.find((a) => a.startsWith('--preview='));
  const preview = previewArg ? previewArg.slice('--preview='.length).trim() : null;
  if (preview) {
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
    if (!resend) throw new Error('RESEND_API_KEY not set');
    const { data, error } = await resend.emails.send({
      from: NEWSLETTER_FROM_EMAIL,
      to: preview,
      subject: SUBJECT,
      html: buildEmailHtml('Cap'),
      text: buildEmailText('Cap'),
      headers: buildListUnsubscribeHeaders(preview, 'dj'),
    });
    console.log(error ? `PREVIEW FAILED: ${JSON.stringify(error)}` : `Preview sent to ${preview} (id=${data?.id})`);
    return;
  }

  const db = getAdminDb();
  if (!db) throw new Error('Firestore admin not configured (check .env.prod)');

  // 1. Preload collectives → slug→owners[] map.
  const collectivesSnap = await db.collection('collectives').get();
  const slugToOwners = new Map<string, string[]>();
  for (const doc of collectivesSnap.docs) {
    const d = doc.data();
    if (d.slug && Array.isArray(d.owners)) slugToOwners.set(String(d.slug), d.owners.map(String));
  }
  console.log(`Loaded ${slugToOwners.size} collectives with owners.`);

  // 2. Scan archives; collect UIDs of everyone tied to a with-tracks archive.
  const archivesSnap = await db.collection('archives').get();
  const uidArchiveCount = new Map<string, number>(); // uid → # with-tracks archives
  let withTracks = 0;
  let hiddenSkipped = 0;

  for (const doc of archivesSnap.docs) {
    const a = doc.data();
    if (normalizeTrackIds(a.trackIds).length === 0) continue;
    if (a.priority === 'hidden') { hiddenSkipped++; continue; }
    withTracks++;

    // Collect the distinct UIDs tied to THIS archive, then count each once —
    // otherwise a DJ who is both uploadedBy and djs[0].userId (the norm) gets
    // counted twice for a single show.
    const uidsForArchive = new Set<string>();
    const add = (uid: unknown) => {
      if (typeof uid === 'string' && uid.trim()) uidsForArchive.add(uid);
    };
    add(a.uploadedBy);
    if (Array.isArray(a.djs)) {
      for (const dj of a.djs) add(dj?.userId);
    }
    // Collective archive: djs[0].username === collective slug → owners.
    const primaryUsername = Array.isArray(a.djs) && a.djs[0]?.username;
    if (primaryUsername && slugToOwners.has(String(primaryUsername))) {
      for (const owner of slugToOwners.get(String(primaryUsername))!) add(owner);
    }
    for (const uid of uidsForArchive) {
      uidArchiveCount.set(uid, (uidArchiveCount.get(uid) || 0) + 1);
    }
  }
  console.log(
    `Scanned ${archivesSnap.size} archives → ${withTracks} with track IDs ` +
      `(${hiddenSkipped} hidden skipped). ${uidArchiveCount.size} distinct UIDs.`,
  );

  // 3. Resolve UIDs → user docs (email + name). Filter to DJ-cohort roles.
  const targets: Target[] = [];
  const skipped: { uid: string; reason: string }[] = [];
  const uids = [...uidArchiveCount.keys()];
  for (let i = 0; i < uids.length; i += 400) {
    const chunk = uids.slice(i, i + 400);
    const refs = chunk.map((uid) => db.collection('users').doc(uid));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      const uid = snap.id;
      const count = uidArchiveCount.get(uid) || 0;
      if (!snap.exists) { skipped.push({ uid, reason: 'no user doc' }); continue; }
      const d = snap.data()!;
      const email = String(d.email || '').trim().toLowerCase();
      if (!email) { skipped.push({ uid, reason: 'no email' }); continue; }
      const role = d.role as string | undefined;
      if (!DJ_ROLES.has(role || '')) { skipped.push({ uid, reason: `role=${role || 'none'}` }); continue; }
      if (EXCLUDE_EMAILS.has(email)) { skipped.push({ uid, reason: 'excluded' }); continue; }
      const firstName = FORCE_PLAIN_GREETING.has(email)
        ? 'there' // 'there' triggers the plain "Hi," greeting in the template
        : resolveFirstName(email, d.name, d.chatUsername, d.displayName);
      targets.push({ uid, email, firstName, archiveCount: count });
    }
  }

  // Dedupe by email (a user could surface under multiple UIDs in theory).
  const byEmail = new Map<string, Target>();
  for (const t of targets) {
    const prev = byEmail.get(t.email);
    if (!prev) byEmail.set(t.email, t);
    else prev.archiveCount += t.archiveCount;
  }
  let recipients = [...byEmail.values()].sort((a, b) => b.archiveCount - a.archiveCount);
  if (only) recipients = recipients.filter((r) => r.email === only);

  // 4. Report.
  console.log(`\n=== MAILING LIST: ${recipients.length} recipients ===`);
  for (const r of recipients) {
    const greeting = r.firstName === 'there' ? 'Hi,' : `Hi ${r.firstName},`;
    console.log(`  ${r.email.padEnd(40)} → "${greeting}"   (${r.archiveCount} show${r.archiveCount === 1 ? '' : 's'} w/ IDs)`);
  }
  if (skipped.length) {
    console.log(`\n${skipped.length} UIDs skipped:`);
    const byReason = new Map<string, number>();
    for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) || 0) + 1);
    for (const [reason, n] of byReason) console.log(`  ${reason}: ${n}`);
  }

  if (!send) {
    console.log(`\nDRY RUN — no emails sent. Re-run with --send to send.`);
    return;
  }

  // 5. Send.
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  if (!resend) throw new Error('RESEND_API_KEY not set');

  console.log(`\nSending ${recipients.length} emails from ${NEWSLETTER_FROM_EMAIL}...`);
  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    try {
      const { error } = await resend.emails.send({
        from: NEWSLETTER_FROM_EMAIL,
        to: r.email,
        subject: SUBJECT,
        html: buildEmailHtml(r.firstName),
        text: buildEmailText(r.firstName),
        headers: buildListUnsubscribeHeaders(r.email, 'dj'),
      });
      if (error) { failed++; console.error(`  FAIL ${r.email}: ${JSON.stringify(error)}`); }
      else { sent++; console.log(`  sent ${r.email}`); }
    } catch (e) {
      failed++;
      console.error(`  FAIL ${r.email}: ${e}`);
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  console.log(`\nDone. sent=${sent} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
