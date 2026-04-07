import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getR2Client, getR2PublicUrl } from '@/lib/r2-upload';

const ADMIN_DELETE_PASSWORD = process.env.ADMIN_ARCHIVE_DELETE_PASSWORD || '';

export async function DELETE(request: NextRequest) {
  try {
    const { archiveId, password, skipPasswordCheck } = await request.json();

    if (!archiveId) {
      return NextResponse.json({ error: 'Archive ID required' }, { status: 400 });
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

    const archiveData = archiveDoc.data()!;

    // Check if password is required
    const isLive = archiveData.sourceType === 'live';
    const durationSec = archiveData.duration || 0;
    const isLong = durationSec > 20 * 60; // > 20 minutes

    if ((isLive || isLong) && !skipPasswordCheck) {
      if (!ADMIN_DELETE_PASSWORD) {
        return NextResponse.json({ error: 'Admin delete password not configured on server' }, { status: 500 });
      }
      if (!password || password !== ADMIN_DELETE_PASSWORD) {
        return NextResponse.json({
          error: 'Incorrect password',
          requiresPassword: true,
          reason: isLive ? 'live' : 'long',
        }, { status: 403 });
      }
    }

    // Try to delete the R2 file
    const recordingUrl = archiveData.recordingUrl as string | undefined;
    let r2Deleted = false;

    if (recordingUrl) {
      const r2PublicUrl = getR2PublicUrl();
      const r2Client = getR2Client();
      const r2Bucket = process.env.R2_BUCKET_NAME || '';

      if (r2Client && r2PublicUrl && r2Bucket && recordingUrl.startsWith(r2PublicUrl)) {
        const r2Key = recordingUrl.replace(`${r2PublicUrl}/`, '');
        try {
          await r2Client.send(new DeleteObjectCommand({
            Bucket: r2Bucket,
            Key: r2Key,
          }));
          r2Deleted = true;
        } catch (err) {
          console.error('Failed to delete R2 file:', r2Key, err);
          // Continue with Firestore deletion even if R2 fails
        }
      }
    }

    // Delete the archive document from Firestore
    await archiveRef.delete();

    // Also delete corresponding studio-session if it exists (same ID pattern)
    try {
      const studioRef = db.collection('studio-sessions').doc(archiveId);
      const studioDoc = await studioRef.get();
      if (studioDoc.exists) {
        await studioRef.delete();
      }
    } catch {
      // Ignore - studio session may not exist
    }

    return NextResponse.json({
      success: true,
      r2Deleted,
      message: `Archive deleted${r2Deleted ? ' (storage freed)' : ' (database only)'}`,
    });

  } catch (error) {
    console.error('Admin archive delete error:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete archive';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
