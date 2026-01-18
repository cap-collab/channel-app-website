import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { ArchiveSerialized } from '@/types/broadcast';

export async function GET() {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const archivesRef = db.collection('archives');
    // Get all archives without orderBy to avoid index requirement
    const snapshot = await archivesRef.get();

    const archives: ArchiveSerialized[] = snapshot.docs.map((doc) => {
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
      };
    });

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
