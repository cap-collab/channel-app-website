import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

const VALID_PRIORITIES = ['high', 'medium', 'low'] as const;

export async function PATCH(request: NextRequest) {
  try {
    const { archiveId, priority } = await request.json();

    if (!archiveId) {
      return NextResponse.json({ error: 'Archive ID required' }, { status: 400 });
    }

    if (!priority || !VALID_PRIORITIES.includes(priority)) {
      return NextResponse.json({ error: 'Invalid priority. Must be high, medium, or low' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const archiveRef = db.collection('archives').doc(archiveId);
    const archiveDoc = await archiveRef.get();

    if (!archiveDoc.exists) {
      return NextResponse.json({ error: 'Archive not found' }, { status: 404 });
    }

    await archiveRef.update({ priority });

    return NextResponse.json({ success: true, priority });
  } catch (error) {
    console.error('Update archive priority error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update priority';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
