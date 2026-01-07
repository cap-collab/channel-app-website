import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// GET - Debug endpoint to check recent tips
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get recent tips
    const tipsSnapshot = await db.collection('tips')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const tips = tipsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
      transferredAt: doc.data().transferredAt?.toDate?.()?.toISOString() || null,
    }));

    return NextResponse.json({ tips });
  } catch (error) {
    console.error('Error fetching tips:', error);
    return NextResponse.json({ error: 'Failed to fetch tips' }, { status: 500 });
  }
}
