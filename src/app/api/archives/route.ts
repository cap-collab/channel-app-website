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
    const snapshot = await archivesRef
      .orderBy('recordedAt', 'desc')
      .limit(100)
      .get();

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
      };
    });

    return NextResponse.json({ archives });
  } catch (error) {
    console.error('Error fetching archives:', error);
    return NextResponse.json({ error: 'Failed to fetch archives' }, { status: 500 });
  }
}
