import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { normalizeUsername } from '@/lib/dj-matching';
import { recordPlay } from '@/lib/played-archives';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Parse optional userId + gateTriggered + played + gateCredit from body
    let userId: string | null = null;
    let gateTriggered = false;
    let played = false;
    let gateCredit = false;
    let tracklistView = false;
    try {
      const body = await request.json();
      userId = body.userId || null;
      gateTriggered = body.gateTriggered === true;
      played = body.played === true;
      gateCredit = body.gateCredit === true;
      tracklistView = body.tracklistView === true;
      console.log('[archive/stream] userId from body:', userId, 'gateTriggered:', gateTriggered, 'played:', played, 'gateCredit:', gateCredit, 'tracklistView:', tracklistView);
    } catch {
      console.log('[archive/stream] No body or invalid JSON, skipping user tracking');
    }

    // Find archive by slug
    const archivesRef = db.collection('archives');
    const snapshot = await archivesRef
      .where('slug', '==', slug)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'Archive not found' }, { status: 404 });
    }

    const archiveDoc = snapshot.docs[0];
    const archiveRef = archiveDoc.ref;
    const archiveData = archiveDoc.data();

    const djsArr = (archiveData.djs || []) as { name?: string; username?: string; photoUrl?: string }[];

    // Tracklist view (fired when a signed-in user opens an archive's tracklist,
    // via the profile card or the chat "track id" reply). Dual write, mirroring
    // the streamCount/streamHistory shape below: a per-user record (recs signal)
    // + an archive-doc tally (popularity). Writes a DISJOINT field
    // (tracklistViewCount) so it can never collide with the recording pipeline
    // or the streamCount path. Requires an authenticated user.
    if (tracklistView) {
      if (userId) {
        const viewRef = db
          .collection('users').doc(userId)
          .collection('tracklistViews').doc(archiveDoc.id);
        const existing = await viewRef.get();
        await viewRef.set({
          archiveId: archiveDoc.id,
          viewCount: FieldValue.increment(1),
          lastViewedAt: FieldValue.serverTimestamp(),
          ...(existing.exists ? {} : { firstViewedAt: FieldValue.serverTimestamp() }),
        }, { merge: true });
        await archiveRef.update({ tracklistViewCount: FieldValue.increment(1) });
      }
      return NextResponse.json({ success: true, tracklistView: !!userId });
    }

    // "Played" marker (fired on play-start, any duration): record an
    // exclusion-only signal so the rec engine stops re-recommending this
    // archive. This does NOT touch the global streamCount or streamHistory (a
    // bare play is not a stream and not taste). Requires an authenticated user.
    if (played) {
      if (userId) {
        await recordPlay(db, userId, archiveDoc.id, Date.now());
      }
      return NextResponse.json({ success: true, played: !!userId });
    }

    // Gate credit: the user listened 16 min to this archive while logged out,
    // hit the sign-in wall, and just authenticated. That's a genuine deep
    // engagement — credit it as a full STREAM (taste, real streamCount) + PLAY
    // (exclusion) + LOVE for each credited DJ. Idempotent via a gateCreditedAt
    // stamp on the streamHistory doc so a re-login can't double-credit.
    if (gateCredit && userId) {
      const streamHistoryRef = db
        .collection('users').doc(userId).collection('streamHistory').doc(archiveDoc.id);
      const existing = await streamHistoryRef.get();

      // Already gate-credited → no-op (a re-login shouldn't re-love / re-count).
      if (existing.exists && existing.data()?.gateCreditedAt) {
        return NextResponse.json({ success: true, gateCredit: 'already' });
      }

      const djUsernames = Array.from(new Set(
        djsArr.map((d) => (d.username || '').toString().trim()).filter((u) => u.length > 0),
      ));
      const djUsernamesNormalized = Array.from(new Set(
        djUsernames.map((u) => normalizeUsername(u)).filter((u) => u.length > 0),
      ));

      // 1) STREAM — a real streamCount so it feeds taste like any 15-min listen.
      const historyData: Record<string, unknown> = {
        archiveId: archiveDoc.id,
        slug,
        showName: archiveData.showName || '',
        djs: djsArr.map((d) => ({ name: d.name || '', username: d.username || null, photoUrl: d.photoUrl || null })),
        djUsernames,
        djUsernamesNormalized,
        stationId: archiveData.stationId || '',
        showImageUrl: archiveData.showImageUrl || null,
        sourceType: 'archive',
        streamCount: FieldValue.increment(1),
        lastStreamedAt: FieldValue.serverTimestamp(),
        gateCreditedAt: FieldValue.serverTimestamp(),
      };
      if (!existing.exists) historyData.firstStreamedAt = FieldValue.serverTimestamp();
      await streamHistoryRef.set(historyData, { merge: true });

      // Global stream count too (matches a normal authed stream).
      await archiveRef.update({ streamCount: FieldValue.increment(1) });

      // 2) PLAY — exclusion marker.
      await recordPlay(db, userId, archiveDoc.id, Date.now());

      // 3) LOVE — one per credited DJ (display-keyed doc, mirrors the chat love).
      await Promise.all(djUsernames.map((uname) =>
        db.collection('users').doc(userId!).collection('loveHistory').doc(uname).set({
          djUsername: uname,
          djUsernameNormalized: normalizeUsername(uname),
          djDisplayName: uname,
          loveCount: FieldValue.increment(1),
          contexts: FieldValue.arrayUnion('archive'),
          lastLovedAt: FieldValue.serverTimestamp(),
          firstLovedAt: FieldValue.serverTimestamp(),
          source: 'gate-16min',
        }, { merge: true }),
      ));

      return NextResponse.json({ success: true, gateCredit: true });
    }

    // Increment the global stream count (skip for gate-triggered sign-in logs)
    if (!gateTriggered) {
      await archiveRef.update({
        streamCount: FieldValue.increment(1),
      });
    }

    // Write per-user stream history if authenticated
    if (userId) {
      const streamHistoryRef = db
        .collection('users')
        .doc(userId)
        .collection('streamHistory')
        .doc(archiveDoc.id);

      const existing = await streamHistoryRef.get();
      const historyData: Record<string, unknown> = {
        archiveId: archiveDoc.id,
        slug,
        showName: archiveData.showName || '',
        djs: djsArr.map((d) => ({
          name: d.name || '',
          username: d.username || null,
          photoUrl: d.photoUrl || null,
        })),
        // Flat searchable mirror of djs[].username — Firestore doesn't index
        // inside array-of-objects, so the go-live cron uses array_contains
        // on this field to find streamers of a given DJ.
        djUsernames: Array.from(
          new Set(
            djsArr
              .map((d) => (d.username || '').toString().trim())
              .filter((u) => u.length > 0),
          ),
        ),
        // Canonical form for go-live cron queries (matches chatUsernameNormalized).
        djUsernamesNormalized: Array.from(
          new Set(
            djsArr
              .map((d) => normalizeUsername((d.username || '').toString().trim()))
              .filter((u) => u.length > 0),
          ),
        ),
        stationId: archiveData.stationId || '',
        showImageUrl: archiveData.showImageUrl || null,
        sourceType: 'archive',
      };

      if (gateTriggered) {
        historyData.gateTriggered = true;
        historyData.gateTriggeredAt = FieldValue.serverTimestamp();
      } else {
        historyData.streamCount = FieldValue.increment(1);
        historyData.lastStreamedAt = FieldValue.serverTimestamp();
      }

      if (!existing.exists) {
        historyData.firstStreamedAt = FieldValue.serverTimestamp();
      }

      await streamHistoryRef.set(historyData, { merge: true });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error incrementing stream count:', error);
    return NextResponse.json({ error: 'Failed to increment stream count' }, { status: 500 });
  }
}
