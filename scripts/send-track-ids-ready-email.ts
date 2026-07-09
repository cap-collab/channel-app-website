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
import { normalizeUsername } from '../src/lib/dj-matching';
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
  displayName: string;  // chatUsername/name — how this DJ is named in others' block
  archiveCount: number; // # of their archives with track IDs (audit signal)
  profileSlug?: string; // recipient's own chatUsernameNormalized → /dj/<slug>
  signInMethod?: string; // google | apple | password | emailLink → footer reminder
  // "someone played YOUR track": the DJs (name + profile slug) who played a
  // track tagged to this recipient. Combined into one paragraph.
  playedBy?: { name: string; slug?: string }[];
  // "YOU played someone's track": the tracks this recipient played that are
  // tagged to another Channel DJ. Combined into one paragraph.
  youPlayed?: { track: string; djName: string }[];
}

const HEART = '\u{1F90D}'; // 🤍

// Sign-in reminder footer, ported from src/lib/email.ts signInReminderHtml so
// the DJ is reminded how they log in (avoids duplicate-account confusion).
// Returns "" for an unknown method. Apple omits the email (Hide-My-Email relay).
function signInReminderHtml(method?: string, email?: string): string {
  const at = 'at <a href="https://channel-app.com" style="color: #999; text-decoration: underline;">channel-app.com</a>';
  let line: string;
  switch (method) {
    case 'google':
      line = `You sign in with <strong>Google</strong>${email ? ` (${email})` : ''} ${at}.`;
      break;
    case 'apple':
      line = `You sign in with <strong>Apple</strong> ${at}.`;
      break;
    case 'password':
      line = `You sign in with your <strong>email &amp; password</strong>${email ? ` (${email})` : ''} ${at}.`;
      break;
    case 'emailLink':
      line = `You sign in with a <strong>magic link</strong> — enter your email ${at} and we'll send it on that email address.`;
      break;
    default:
      return '';
  }
  return line;
}

// Plain-text variant of the sign-in reminder.
function signInReminderText(method?: string, email?: string): string {
  switch (method) {
    case 'google':
      return `You sign in with Google${email ? ` (${email})` : ''} at channel-app.com.`;
    case 'apple':
      return 'You sign in with Apple at channel-app.com.';
    case 'password':
      return `You sign in with your email & password${email ? ` (${email})` : ''} at channel-app.com.`;
    case 'emailLink':
      return "You sign in with a magic link — enter your email at channel-app.com and we'll send it on that email address.";
    default:
      return '';
  }
}

// Build the bold relationship paragraph (sits directly under the Studio line).
// The prose is bold; any URL is left OUTSIDE the <strong> so links aren't bold.
// Returns { html, text }; exactly one variant applies per recipient.
function buildRelationshipBlock(t: Target): { html: string; text: string } {
  // "Someone played YOUR track" — recipient is the tagged DJ. The links are the
  // profiles of the DJs who PLAYED it (so listeners can find them), not the
  // recipient's own profile.
  if (t.playedBy && t.playedBy.length) {
    const names = joinNames(t.playedBy.map((d) => d.name));
    const withSlug = t.playedBy.filter((d) => d.slug);
    // Each playing DJ's profile URL on its own line (easier to read), not bold.
    const urlsHtml = withSlug
      .map((d) => `<a href="https://channel-app.com/dj/${d.slug}">channel-app.com/dj/${d.slug}</a>`)
      .join('<br />');
    const urlsText = withSlug.map((d) => `channel-app.com/dj/${d.slug}`).join('\n');
    const lead =
      `We noticed ${names} played your track on their latest show. ` +
      `We've linked the track ID back to your profile so listeners can discover your work.`;
    // Bold sentence, then non-bold stacked URLs on the very next lines (no gap).
    return {
      html: `<strong>${escapeHtml(lead)}</strong><br />${urlsHtml}`,
      text: lead + '\n' + urlsText,
    };
  }

  // "YOU played someone's track" — recipient is the archive owner. No URL.
  if (t.youPlayed && t.youPlayed.length) {
    const phrase = joinNames(t.youPlayed.map((p) => `${p.track} by ${p.djName}`));
    const line =
      `We noticed you played ${phrase}. We've linked it to their profile and let them know. ` +
      `Thanks for supporting fellow channel artists. ${HEART}`;
    return { html: `<strong>${escapeHtml(line)}</strong>`, text: line };
  }

  // Fallback — no tag relationship: invite them to flag missed tracks. No URL.
  const line =
    `If you played a track from another channel artist and I missed it, just let me know. ` +
    `I'll link the track to their profile and make sure they see it ${HEART}`;
  return { html: `<strong>${escapeHtml(line)}</strong>`, text: line };
}

// Grammatical join: ["A"] → "A", ["A","B"] → "A and B", ["A","B","C"] → "A, B and C".
function joinNames(items: string[]): string {
  if (items.length <= 1) return items[0] || '';
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ownerDisplayName(t: Target): string {
  return t.displayName || t.firstName || 'a DJ';
}

// Track text is stored "Artist – Track" (en-dash). Return the title (after the
// dash); if there's no dash, return the whole thing.
function trackTitle(text: string): string {
  const idx = text.indexOf('–');
  return idx >= 0 ? text.slice(idx + 1).trim() : text.trim();
}

// Plain-text email — no branded wrapper, no button, no logo, no explicit
// unsubscribe UI. Just the message, with inline clickable links.
// (List-Unsubscribe header is still attached at send time for deliverability.)
// If firstName is "there" (no name resolved), open with plain "Hi,".
function buildEmailHtml(t: Target): string {
  const greeting = t.firstName === 'there' ? 'Hi,' : `Hi ${t.firstName},`;
  const profileUrl = t.profileSlug ? `https://channel-app.com/dj/${t.profileSlug}` : 'https://channel-app.com';
  const profileShort = t.profileSlug ? `channel-app.com/dj/${t.profileSlug}` : 'channel-app.com';
  const rel = buildRelationshipBlock(t);
  const lines = [
    `${greeting}`,
    '',
    'I just launched a first version of automatic track IDs.',
    '',
    `<strong>I've generated track IDs for your existing shows, and they're now available on your profile :</strong> <a href="${profileUrl}">${profileShort}</a>`,
    '',
    'You can review them anytime, edit any track, add missing ones, or make individual tracks private from your Studio:',
    '<a href="https://channel-app.com/studio">channel-app.com/studio</a>',
    '',
    rel.html,
    '',
    "I'm sharing the feature with you first while I test and refine it before officially launching it to listeners next week.",
    '',
    "If you notice anything inaccurate, have ideas for improving it, or run into any issues, I'd really appreciate your feedback.",
    '',
    'Thanks again for helping me build channel.',
    '',
    'Cap',
  ];
  const footer = signInReminderHtml(t.signInMethod, t.email);
  if (footer) {
    lines.push('', `<span style="font-size: 13px; color: #999;">${footer}</span>`);
  }
  return lines.join('\n').replace(/\n/g, '<br />\n');
}

// Plain-text alternative (helps deliverability; some clients prefer it).
function buildEmailText(t: Target): string {
  const greeting = t.firstName === 'there' ? 'Hi,' : `Hi ${t.firstName},`;
  const profileShort = t.profileSlug ? `channel-app.com/dj/${t.profileSlug}` : 'channel-app.com';
  const rel = buildRelationshipBlock(t);
  const lines = [
    greeting,
    '',
    'I just launched a first version of automatic track IDs.',
    '',
    `I've generated track IDs for your existing shows, and they're now available on your profile : ${profileShort}`,
    '',
    'You can review them anytime, edit any track, add missing ones, or make individual tracks private from your Studio:',
    'https://channel-app.com/studio',
    '',
    rel.text,
    '',
    "I'm sharing the feature with you first while I test and refine it before officially launching it to listeners next week.",
    '',
    "If you notice anything inaccurate, have ideas for improving it, or run into any issues, I'd really appreciate your feedback.",
    '',
    'Thanks again for helping me build channel.',
    '',
    'Cap',
  ];
  const footer = signInReminderText(t.signInMethod, t.email);
  if (footer) lines.push('', footer);
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes('--send');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).toLowerCase() : null;

  // --preview=<email>: deliver ONE email to <email> for eyeballing. By default
  // renders a sample "Cap" body; add --preview-as=<recipient-email> to render a
  // specific real recipient's exact email (incl. their P.S.) but deliver it to
  // the --preview address. Runs the full scan so P.S. data is live.
  const previewArg = args.find((a) => a.startsWith('--preview='));
  const preview = previewArg ? previewArg.slice('--preview='.length).trim() : null;
  const previewAsArg = args.find((a) => a.startsWith('--preview-as='));
  const previewAs = previewAsArg ? previewAsArg.slice('--preview-as='.length).trim().toLowerCase() : null;

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

  // 2. Scan archives (raw admin read — unmasked tags); collect UIDs of everyone
  // tied to a with-tracks archive, AND the per-track DJ tags for the P.S. lines.
  const archivesSnap = await db.collection('archives').get();
  const uidArchiveCount = new Map<string, number>(); // uid → # with-tracks archives
  let withTracks = 0;
  let hiddenSkipped = 0;

  // Raw tag relationships: one row per tagged track (non-hidden archives).
  interface TagRel {
    ownerUids: string[];      // who played it (archive owner uids)
    ownerName: string;        // display name of the primary owner (for the tagged DJ's P.S.)
    tagNorm: string;          // normalizeUsername(djUsername) — matches chatUsernameNormalized
    track: string;            // track title (after the en-dash)
    private: boolean;
  }
  const tagRels: TagRel[] = [];

  // Every archive that has track IDs (incl. hidden). On --send we stamp these
  // trackIdsReadyEmailStatus:'sent' so the recurring cron never re-emails an
  // archive this one-time blast already covered. (Replaces a separate backfill.)
  const trackIdArchiveIds: string[] = [];

  for (const doc of archivesSnap.docs) {
    const a = doc.data();
    const tracks = normalizeTrackIds(a.trackIds);
    if (tracks.length === 0) continue;
    trackIdArchiveIds.push(doc.id);
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

    // Tag relationships — a track tagged to another Channel DJ.
    const ownerUids = [...uidsForArchive];
    const ownerName = (Array.isArray(a.djs) && a.djs[0]?.username) ? String(a.djs[0].username) : (a.showName || 'a DJ');
    for (const t of tracks) {
      if (!t.djUsername) continue;
      tagRels.push({
        ownerUids,
        ownerName,
        tagNorm: normalizeUsername(t.djUsername),
        track: trackTitle(t.text),
        private: !!t.private,
      });
    }
  }
  console.log(
    `Scanned ${archivesSnap.size} archives → ${withTracks} with track IDs ` +
      `(${hiddenSkipped} hidden skipped). ${uidArchiveCount.size} distinct UIDs. ` +
      `${tagRels.length} tagged tracks.`,
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
      const profileSlug = (d.chatUsernameNormalized && String(d.chatUsernameNormalized).trim())
        || (d.chatUsername ? normalizeUsername(String(d.chatUsername)) : undefined);
      const displayName = String(d.chatUsername || d.name || d.displayName || firstName);
      const signInMethod = typeof d.signInMethod === 'string' ? d.signInMethod : undefined;
      targets.push({ uid, email, firstName, displayName, archiveCount: count, profileSlug: profileSlug || undefined, signInMethod });
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

  // 3b. Wire P.S. tag relationships onto recipients.
  //  - Resolve each tagged handle (tagNorm) → the tagged DJ's user (uid + name).
  //  - "Someone played YOUR track": for each tag, the tagged DJ's email gets the
  //    names of the owners who played it.
  //  - "YOU played someone's track": each owner's email gets (track, taggedDjName).
  //    Private tracks are skipped on THIS side (they name the track).
  const uidToRecipient = new Map<string, Target>();
  for (const r of recipients) uidToRecipient.set(r.uid, r);

  // Resolve distinct tag handles → { uid, name } via chatUsernameNormalized.
  const distinctTags = [...new Set(tagRels.map((r) => r.tagNorm))];
  const tagToDj = new Map<string, { uid: string; name: string; slug: string } | null>();
  for (const norm of distinctTags) {
    const s = await db.collection('users').where('chatUsernameNormalized', '==', norm).limit(1).get();
    if (s.empty) { tagToDj.set(norm, null); continue; }
    const d = s.docs[0].data();
    const name = resolveFirstName(String(d.email || ''), d.name, d.chatUsername, d.displayName);
    // For the tagged DJ's display name in "you played X by <name>", prefer the
    // full chatUsername (the artist handle), not just the first name.
    const displayName = String(d.chatUsername || d.name || name);
    tagToDj.set(norm, { uid: s.docs[0].id, name: displayName, slug: String(d.chatUsernameNormalized || norm) });
  }

  // Resolve any owner uid (a DJ who PLAYED a tagged track) → { name, slug } so
  // the "someone played your track" block can link to THEIR profile. Recipients
  // already have this; look up the rest.
  const ownerInfo = new Map<string, { name: string; slug?: string }>();
  const missingOwnerUids = new Set<string>();
  for (const rel of tagRels) for (const u of rel.ownerUids) {
    if (uidToRecipient.has(u)) {
      const r = uidToRecipient.get(u)!;
      ownerInfo.set(u, { name: ownerDisplayName(r), slug: r.profileSlug });
    } else {
      missingOwnerUids.add(u);
    }
  }
  if (missingOwnerUids.size) {
    const refs = [...missingOwnerUids].map((u) => db.collection('users').doc(u));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      const d = s.data()!;
      const name = String(d.chatUsername || d.name || d.displayName || 'a DJ');
      const slug = (d.chatUsernameNormalized && String(d.chatUsernameNormalized)) || undefined;
      ownerInfo.set(s.id, { name, slug });
    }
  }

  // Accumulators keyed by recipient uid.
  const playedByAccum = new Map<string, Map<string, { name: string; slug?: string }>>(); // taggedDj uid → owner uid → {name,slug}
  const youPlayedAccum = new Map<string, { track: string; djName: string }[]>();          // owner uid → tracks

  for (const rel of tagRels) {
    const tagged = tagToDj.get(rel.tagNorm);
    if (!tagged) continue;

    // "Someone played YOUR track" → tagged DJ, listing the DJs who played it.
    if (uidToRecipient.has(tagged.uid)) {
      const m = playedByAccum.get(tagged.uid) || new Map<string, { name: string; slug?: string }>();
      for (const ownerUid of rel.ownerUids) {
        if (ownerUid === tagged.uid) continue; // ignore self-plays
        m.set(ownerUid, ownerInfo.get(ownerUid) || { name: rel.ownerName });
      }
      playedByAccum.set(tagged.uid, m);
    }

    // "YOU played someone's track" → each owner recipient. Skip private tracks.
    if (!rel.private) {
      for (const ownerUid of rel.ownerUids) {
        if (!uidToRecipient.has(ownerUid)) continue;
        // Don't tell a DJ they "played their own track" if they tagged themselves.
        if (ownerUid === tagged.uid) continue;
        const arr = youPlayedAccum.get(ownerUid) || [];
        arr.push({ track: rel.track, djName: tagged.name });
        youPlayedAccum.set(ownerUid, arr);
      }
    }
  }

  for (const r of recipients) {
    const played = playedByAccum.get(r.uid);
    if (played && played.size) r.playedBy = [...played.values()];
    const you = youPlayedAccum.get(r.uid);
    if (you && you.length) {
      // Dedup identical (track, djName) pairs.
      const seen = new Set<string>();
      r.youPlayed = you.filter((p) => {
        const k = `${p.track}|${p.djName}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
  }

  if (only) recipients = recipients.filter((r) => r.email === only);

  // 4. Report.
  console.log(`\n=== MAILING LIST: ${recipients.length} recipients ===`);
  for (const r of recipients) {
    const greeting = r.firstName === 'there' ? 'Hi,' : `Hi ${r.firstName},`;
    const ps: string[] = [];
    if (r.playedBy?.length) ps.push(`played-by: ${joinNames(r.playedBy.map((d) => `${d.name}(/dj/${d.slug || '?'})`))}`);
    if (r.youPlayed?.length) ps.push(`you-played: ${r.youPlayed.map((p) => `${p.track} by ${p.djName}`).join(', ')}`);
    const psStr = ps.length ? `  [${ps.join(' | ')}]` : '';
    console.log(`  ${r.email.padEnd(40)} → "${greeting}"  (${r.archiveCount} show${r.archiveCount === 1 ? '' : 's'})  /dj/${r.profileSlug || '?'}${psStr}`);
  }
  if (skipped.length) {
    console.log(`\n${skipped.length} UIDs skipped:`);
    const byReason = new Map<string, number>();
    for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) || 0) + 1);
    for (const [reason, n] of byReason) console.log(`  ${reason}: ${n}`);
  }

  // Preview: deliver one email to the --preview address and stop.
  if (preview) {
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
    if (!resend) throw new Error('RESEND_API_KEY not set');
    let sample: Target;
    if (previewAs) {
      const match = [...byEmail.values()].find((r) => r.email === previewAs);
      if (!match) throw new Error(`--preview-as=${previewAs} is not a recipient`);
      sample = match;
      console.log(`Previewing ${previewAs}'s exact email (played-by=${match.playedBy?.length || 0}, you-played=${match.youPlayed?.length || 0})`);
    } else {
      sample = { uid: 'preview', email: preview, firstName: 'Cap', displayName: 'Cap', archiveCount: 1, profileSlug: 'cap', signInMethod: 'google' };
    }
    const { data, error } = await resend.emails.send({
      from: NEWSLETTER_FROM_EMAIL,
      to: preview,
      subject: SUBJECT,
      html: buildEmailHtml(sample),
      text: buildEmailText(sample),
      headers: buildListUnsubscribeHeaders(preview, 'dj'),
    });
    console.log(error ? `PREVIEW FAILED: ${JSON.stringify(error)}` : `Preview sent to ${preview} (id=${data?.id})`);
    return;
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
        html: buildEmailHtml(r),
        text: buildEmailText(r),
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

  // Stamp every current track-ID archive 'sent' so the recurring cron
  // (archive-track-ids-emails) never re-emails a show this blast covered.
  console.log(`\nStamping ${trackIdArchiveIds.length} track-ID archives as 'sent'...`);
  let stamped = 0;
  for (const id of trackIdArchiveIds) {
    await db.collection('archives').doc(id).update({
      trackIdsReadyEmailStatus: 'sent',
      trackIdsReadyEmailSentAt: Date.now(),
    });
    stamped++;
  }
  console.log(`Stamped ${stamped} archives.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
