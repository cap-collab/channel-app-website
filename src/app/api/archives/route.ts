import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { enrichArchives, DJInfo, RawArchive } from '@/lib/archives-enrich';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includePrivate = searchParams.get('includePrivate') === 'true';
    // includeHidden gates the priority='hidden' tier (the strongest
    // exclusion below 'low'). Public surfaces (homepage, DJ pages, scenes,
    // social render picker) call without it; the admin Archives tab
    // passes includeHidden=true so admin can still see + un-hide them.
    const includeHidden = searchParams.get('includeHidden') === 'true';

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const archivesRef = db.collection('archives');
    // Get all archives without orderBy to avoid index requirement
    const snapshot = await archivesRef.get();

    // Anchored archives must resolve on the public player even when they're
    // hidden/private — an admin can pin such an archive as a radio anchor, and
    // the archive-radio loop force-includes it (see archive-schedule-server
    // forceIncludeAnchorArchives). Without this allow-list the player's
    // currentArchive lookup would be null → blank title/cover/scene/DJ. Build
    // the set of archive IDs pinned as an upcoming/active anchor's curated
    // archive. Scoped to anchor slots only — not a general hidden/private leak.
    const anchorArchiveIds = new Set<string>();
    try {
      const nowMs = Date.now();
      const anchorSlotsSnap = await db.collection('broadcast-slots')
        .where('broadcastType', '==', 'anchor')
        .get();
      anchorSlotsSnap.forEach((slot) => {
        const s = slot.data();
        if (s.status !== 'scheduled' && s.status !== 'live') return;
        // Keep until the anchor's block has passed (endTime in the future).
        const endMs = s.endTime?.toMillis ? s.endTime.toMillis() : 0;
        if (endMs && endMs < nowMs) return;
        const id = typeof s.postLiveArchiveId === 'string' ? s.postLiveArchiveId : null;
        if (id) anchorArchiveIds.add(id);
      });
    } catch (err) {
      console.warn('[api/archives] anchor allow-list lookup failed:', err);
    }

    // First pass: filter to the archives we'll serve.
    // Filter out unpublished recordings (isPublic === false means explicitly private)
    // Unless includePrivate=true (for DJ dashboard to see their own recordings)
    const rawArchives: RawArchive[] = snapshot.docs
      .filter((doc) => {
        const data = doc.data();
        // Skip archives still being uploaded
        if (data.uploadStatus === 'uploading') return false;
        // Anchored archives always pass — the radio pins them by id and the
        // player must be able to resolve their metadata.
        if (anchorArchiveIds.has(doc.id)) return true;
        // Drop hidden-priority archives unless caller explicitly opted in
        // (admin Archives tab). Hidden is below 'low' — even admin views
        // that surface 'low' archives don't want them by default.
        if (!includeHidden && data.priority === 'hidden') return false;
        // If includePrivate is true, include all archives
        // Otherwise, include only if isPublic is true or undefined (legacy archives)
        return includePrivate || data.isPublic !== false;
      })
      .map((doc) => ({ id: doc.id, data: doc.data(), djs: (doc.data().djs || []) as DJInfo[] }));

    // Enrich (slot emails, pending usernames, live profile data, track masking)
    // via the shared helper so this route and the per-DJ recordings route stay
    // in sync.
    const archives = await enrichArchives(db, rawArchives);

    // Sort by recordedAt descending (most recent first)
    archives.sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0));

    // Limit to 100
    const limitedArchives = archives.slice(0, 100);

    return NextResponse.json({ archives: limitedArchives });
  } catch (error) {
    console.error('Error fetching archives:', error);
    return NextResponse.json({ error: 'Failed to fetch archives' }, { status: 500 });
  }
}
