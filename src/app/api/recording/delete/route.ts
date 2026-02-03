import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export async function DELETE(request: NextRequest) {
  try {
    const { archiveId, userId } = await request.json();

    if (!archiveId) {
      return NextResponse.json({ error: 'Recording ID required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get the broadcast slot document (recordings are stored in broadcast-slots)
    const slotRef = db.collection('broadcast-slots').doc(archiveId);
    const slotDoc = await slotRef.get();

    if (!slotDoc.exists) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    const slotData = slotDoc.data();

    // Verify ownership - check if the user owns this recording
    if (slotData?.djUserId !== userId && slotData?.liveDjUserId !== userId && slotData?.createdBy !== userId) {
      return NextResponse.json({ error: 'Not authorized to delete this recording' }, { status: 403 });
    }

    // Only allow deleting recordings (not live broadcast slots)
    if (slotData?.broadcastType !== 'recording') {
      return NextResponse.json({ error: 'Only recordings can be deleted' }, { status: 400 });
    }

    // Delete the broadcast slot document
    await slotRef.delete();

    // Note: The actual audio file in R2 is NOT deleted here
    // This could be added later if needed, but for now we just remove the database records

    return NextResponse.json({
      success: true,
      message: 'Recording deleted successfully',
    });

  } catch (error) {
    console.error('Delete recording error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete recording';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
