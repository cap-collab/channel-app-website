import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { ArchiveSerialized } from '@/types/broadcast';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const archivesRef = db.collection('archives');
    const snapshot = await archivesRef
      .where('slug', '==', slug)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'Archive not found' }, { status: 404 });
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    const archive: ArchiveSerialized = {
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

    return NextResponse.json({ archive });
  } catch (error) {
    console.error('Error fetching archive:', error);
    return NextResponse.json({ error: 'Failed to fetch archive' }, { status: 500 });
  }
}
