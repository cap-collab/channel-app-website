import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Generate a URL-friendly slug from the show name
function generateSlug(showName: string, slotId: string): string {
  const slugBase = showName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);

  // Add a short unique suffix from the slot ID
  const suffix = slotId.substring(0, 8);
  return `${slugBase}-${suffix}`;
}

export async function POST(request: NextRequest) {
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

    // Verify ownership
    if (slotData?.djUserId !== userId && slotData?.liveDjUserId !== userId && slotData?.createdBy !== userId) {
      return NextResponse.json({ error: 'Not authorized to publish this recording' }, { status: 403 });
    }

    // Check if it's a recording type
    if (slotData?.broadcastType !== 'recording') {
      return NextResponse.json({ error: 'Only recordings can be published' }, { status: 400 });
    }

    // Check if recording is ready
    if (slotData?.recordingStatus !== 'ready') {
      return NextResponse.json({ error: 'Recording is not ready yet' }, { status: 400 });
    }

    // Check if already published
    if (slotData?.isPublic === true) {
      return NextResponse.json({
        success: true,
        message: 'Recording is already published',
        recording: {
          id: archiveId,
          isPublic: true,
          publishedAt: slotData.publishedAt,
        },
      });
    }

    // Publish the recording
    const publishedAt = Date.now();
    await slotRef.update({
      isPublic: true,
      publishedAt,
    });

    // Create or update an archive document so it appears in the DJ profile
    const slug = generateSlug(slotData.showName || 'recording', archiveId);
    const archiveRef = db.collection('archives').doc(archiveId);

    // Build DJs array from slot data
    const djs = [{
      name: slotData.liveDjUsername || slotData.djUsername || 'DJ',
      username: slotData.liveDjChatUsername || slotData.djUsername,
      userId: slotData.liveDjUserId || slotData.djUserId,
      email: slotData.djEmail,
      photoUrl: slotData.liveDjPhotoUrl,
    }];

    await archiveRef.set({
      slug,
      broadcastSlotId: archiveId,
      showName: slotData.showName || 'Recording',
      djs,
      recordingUrl: slotData.recordingUrl,
      duration: slotData.recordingDuration || 0,
      recordedAt: slotData.createdAt?.toMillis?.() || slotData.createdAt || publishedAt,
      createdAt: FieldValue.serverTimestamp(),
      stationId: slotData.stationId || 'channel-main',
      isPublic: true,
      sourceType: 'recording',
      publishedAt,
    }, { merge: true });

    return NextResponse.json({
      success: true,
      message: 'Recording published successfully',
      recording: {
        id: archiveId,
        slug,
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
      return NextResponse.json({ error: 'Recording ID required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get the broadcast slot document
    const slotRef = db.collection('broadcast-slots').doc(archiveId);
    const slotDoc = await slotRef.get();

    if (!slotDoc.exists) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    const slotData = slotDoc.data();

    // Verify ownership
    if (slotData?.djUserId !== userId && slotData?.liveDjUserId !== userId && slotData?.createdBy !== userId) {
      return NextResponse.json({ error: 'Not authorized to unpublish this recording' }, { status: 403 });
    }

    // Only recordings can be unpublished
    if (slotData?.broadcastType !== 'recording') {
      return NextResponse.json({ error: 'Only recordings can be unpublished' }, { status: 400 });
    }

    // Unpublish the recording in broadcast-slots
    await slotRef.update({
      isPublic: false,
      publishedAt: null,
    });

    // Update the archive document to mark as not public
    const archiveRef = db.collection('archives').doc(archiveId);
    const archiveDoc = await archiveRef.get();
    if (archiveDoc.exists) {
      await archiveRef.update({
        isPublic: false,
        publishedAt: null,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Recording unpublished successfully',
      recording: {
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
