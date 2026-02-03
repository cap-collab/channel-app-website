import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export async function POST(request: NextRequest) {
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

    // Verify the user owns this recording
    // Check if the user is one of the DJs on this archive
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
            return NextResponse.json({ error: 'Not authorized to publish this recording' }, { status: 403 });
          }
        } else {
          return NextResponse.json({ error: 'Not authorized to publish this recording' }, { status: 403 });
        }
      } else {
        return NextResponse.json({ error: 'Not authorized to publish this recording' }, { status: 403 });
      }
    }

    // Check if it's a recording type (only recordings need publishing)
    if (archiveData?.sourceType !== 'recording') {
      return NextResponse.json({ error: 'Only recordings can be published' }, { status: 400 });
    }

    // Check if already published
    if (archiveData?.isPublic === true) {
      return NextResponse.json({
        success: true,
        message: 'Recording is already published',
        archive: {
          id: archiveId,
          isPublic: true,
          publishedAt: archiveData.publishedAt,
        },
      });
    }

    // Publish the recording
    const publishedAt = Date.now();
    await archiveRef.update({
      isPublic: true,
      publishedAt,
    });

    // Also update the broadcast slot if it exists
    const slotId = archiveData?.broadcastSlotId;
    if (slotId) {
      try {
        await db.collection('broadcast-slots').doc(slotId).update({
          isPublic: true,
          publishedAt,
        });
      } catch (slotError) {
        console.error('Failed to update slot publish status:', slotError);
        // Don't fail the request if slot update fails
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Recording published successfully',
      archive: {
        id: archiveId,
        isPublic: true,
        publishedAt,
      },
    });

  } catch (error) {
    console.error('Publish recording error:', error);
    const message = error instanceof Error ? error.message : 'Failed to publish recording';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Unpublish a recording (make it private again)
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

    // Verify ownership (same check as publish)
    const djs = archiveData?.djs || [];
    const isOwner = djs.some((dj: { userId?: string }) => dj.userId === userId);

    if (!isOwner) {
      const slotId = archiveData?.broadcastSlotId;
      if (slotId) {
        const slotDoc = await db.collection('broadcast-slots').doc(slotId).get();
        if (slotDoc.exists) {
          const slotData = slotDoc.data();
          if (slotData?.djUserId !== userId && slotData?.liveDjUserId !== userId && slotData?.createdBy !== userId) {
            return NextResponse.json({ error: 'Not authorized to unpublish this recording' }, { status: 403 });
          }
        } else {
          return NextResponse.json({ error: 'Not authorized to unpublish this recording' }, { status: 403 });
        }
      } else {
        return NextResponse.json({ error: 'Not authorized to unpublish this recording' }, { status: 403 });
      }
    }

    // Only recordings can be unpublished
    if (archiveData?.sourceType !== 'recording') {
      return NextResponse.json({ error: 'Only recordings can be unpublished' }, { status: 400 });
    }

    // Unpublish the recording
    await archiveRef.update({
      isPublic: false,
      publishedAt: null,
    });

    // Also update the broadcast slot
    const slotId = archiveData?.broadcastSlotId;
    if (slotId) {
      try {
        await db.collection('broadcast-slots').doc(slotId).update({
          isPublic: false,
          publishedAt: null,
        });
      } catch (slotError) {
        console.error('Failed to update slot unpublish status:', slotError);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Recording unpublished successfully',
      archive: {
        id: archiveId,
        isPublic: false,
      },
    });

  } catch (error) {
    console.error('Unpublish recording error:', error);
    const message = error instanceof Error ? error.message : 'Failed to unpublish recording';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
