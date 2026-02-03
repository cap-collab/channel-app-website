import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export async function DELETE(request: NextRequest) {
  try {
    const { archiveId, userId } = await request.json();

    if (!archiveId) {
      return NextResponse.json({ error: 'Archive ID required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get the archive document
    const archiveRef = db.collection('archives').doc(archiveId);
    const archiveDoc = await archiveRef.get();

    if (!archiveDoc.exists) {
      return NextResponse.json({ error: 'Archive not found' }, { status: 404 });
    }

    const archiveData = archiveDoc.data();

    // Verify ownership - check if the user owns this recording
    const djs = archiveData?.djs || [];
    const isOwner = djs.some((dj: { userId?: string }) => dj.userId === userId);

    if (!isOwner) {
      // Also check the broadcast slot for ownership
      const slotId = archiveData?.broadcastSlotId;
      if (slotId) {
        const slotDoc = await db.collection('broadcast-slots').doc(slotId).get();
        if (slotDoc.exists) {
          const slotData = slotDoc.data();
          if (slotData?.djUserId !== userId && slotData?.liveDjUserId !== userId && slotData?.createdBy !== userId) {
            return NextResponse.json({ error: 'Not authorized to delete this recording' }, { status: 403 });
          }
        } else {
          return NextResponse.json({ error: 'Not authorized to delete this recording' }, { status: 403 });
        }
      } else {
        return NextResponse.json({ error: 'Not authorized to delete this recording' }, { status: 403 });
      }
    }

    // Only allow deleting recordings (not live broadcast archives)
    if (archiveData?.sourceType !== 'recording') {
      return NextResponse.json({ error: 'Only recordings can be deleted' }, { status: 400 });
    }

    // Delete the archive document
    await archiveRef.delete();

    // Also delete the broadcast slot if it exists
    const slotId = archiveData?.broadcastSlotId;
    if (slotId) {
      try {
        await db.collection('broadcast-slots').doc(slotId).delete();
      } catch (slotError) {
        console.error('Failed to delete broadcast slot:', slotError);
        // Don't fail if slot deletion fails
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
