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

    // Get the studio session document
    const slotRef = db.collection('studio-sessions').doc(archiveId);
    const slotDoc = await slotRef.get();

    if (!slotDoc.exists) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    const slotData = slotDoc.data();

    // Verify ownership - check if the user owns this recording
    if (slotData?.djUserId !== userId && slotData?.liveDjUserId !== userId && slotData?.createdBy !== userId) {
      return NextResponse.json({ error: 'Not authorized to delete this recording' }, { status: 403 });
    }

    // Delete the studio session document
    await slotRef.delete();

    // Also delete the corresponding archive document if it exists.
    // Capture its duration first so we can refund the monthly quota below.
    const archiveRef = db.collection('archives').doc(archiveId);
    const archiveDoc = await archiveRef.get();
    const deletedDuration = archiveDoc.exists ? (archiveDoc.data()?.duration || 0) : 0;
    const deletedAtMs = archiveDoc.exists
      ? (archiveDoc.data()?.recordedAt || archiveDoc.data()?.createdAt || 0)
      : 0;
    if (archiveDoc.exists) {
      await archiveRef.delete();
    }

    // Refund the recording's duration to the monthly quota. Completing an
    // upload/recording charges usedSeconds; deleting must credit it back, or a
    // DJ who deletes and re-uploads gets stuck at "0 minutes remaining". Only
    // refund when it was charged in the CURRENT quota month, and clamp at 0.
    if (deletedDuration > 0) {
      try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        const quota = userDoc.data()?.recordingQuota;
        if (quota?.monthKey) {
          const recMonth = new Date(deletedAtMs).toISOString().slice(0, 7);
          if (recMonth === quota.monthKey) {
            await userRef.update({
              'recordingQuota.usedSeconds': Math.max(0, (quota.usedSeconds || 0) - deletedDuration),
            });
          }
        }
      } catch (refundErr) {
        console.error('Quota refund on delete failed:', refundErr);
        // Non-fatal — the records are already deleted.
      }
    }

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
