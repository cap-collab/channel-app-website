import { getAdminDb } from '@/lib/firebase-admin';
import { ArchiveSerialized } from '@/types/broadcast';

const MIN_DURATION_SECONDS = 2700; // 45 minutes

// Lightweight server-side fetch for hero carousel only.
// Returns the top ~10 priority=high archives, no DJ profile joins.
export async function getHeroArchives(): Promise<ArchiveSerialized[]> {
  const db = getAdminDb();
  if (!db) return [];

  try {
    const snap = await db
      .collection('archives')
      .where('priority', '==', 'high')
      .get();

    const archives: ArchiveSerialized[] = snap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          slug: data.slug,
          broadcastSlotId: data.broadcastSlotId,
          showName: data.showName,
          djs: data.djs || [],
          recordingUrl: data.recordingUrl,
          duration: data.duration || 0,
          recordedAt: data.recordedAt,
          createdAt: data.createdAt,
          stationId: data.stationId || 'channel-main',
          showImageUrl: data.showImageUrl,
          streamCount: data.streamCount,
          isPublic: data.isPublic,
          sourceType: data.sourceType,
          publishedAt: data.publishedAt,
          priority: data.priority || 'medium',
          uploadStatus: data.uploadStatus,
        } as ArchiveSerialized & { uploadStatus?: string };
      })
      .filter((a) => {
        const withStatus = a as ArchiveSerialized & { uploadStatus?: string };
        if (withStatus.uploadStatus === 'uploading') return false;
        if (a.isPublic === false) return false;
        if (a.duration < MIN_DURATION_SECONDS) return false;
        return true;
      })
      .sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0))
      .slice(0, 10);

    return archives;
  } catch (err) {
    console.error('[getHeroArchives] Error:', err);
    return [];
  }
}
