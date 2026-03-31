import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { BroadcastSlot } from '@/types/broadcast';
import { FieldValue } from 'firebase-admin/firestore';
import { normalizeUrl } from '@/lib/url';

// POST - Update DJ's tip button link during broadcast
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { broadcastToken, tipButtonLink } = body;

    if (!broadcastToken) {
      return NextResponse.json({ error: 'No broadcast token provided' }, { status: 400 });
    }

    // Normalize and validate URL if provided
    let normalizedLink: string | null = null;
    const trimmed = tipButtonLink?.trim();
    if (trimmed) {
      normalizedLink = normalizeUrl(trimmed);
      try {
        const url = new URL(normalizedLink);
        if (!['http:', 'https:'].includes(url.protocol)) {
          return NextResponse.json({ error: 'Invalid URL protocol' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
      }
      if (normalizedLink.length > 500) {
        return NextResponse.json({ error: 'URL too long (max 500 chars)' }, { status: 400 });
      }
    }

    // Look up slot by token
    const snapshot = await db.collection('broadcast-slots')
      .where('broadcastToken', '==', broadcastToken)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'Invalid broadcast token' }, { status: 404 });
    }

    const doc = snapshot.docs[0];
    const slot = doc.data() as Omit<BroadcastSlot, 'id'>;

    // Update liveDjTipButtonLink on the slot
    await doc.ref.update({
      liveDjTipButtonLink: normalizedLink || FieldValue.delete(),
    });

    // Sync to the slot's configured DJ profile
    const slotDjUserId = slot.djUserId;
    if (slotDjUserId) {
      try {
        const updateData: Record<string, string | FieldValue> = {};
        if (normalizedLink) {
          updateData['djProfile.tipButtonLink'] = normalizedLink;
        } else {
          updateData['djProfile.tipButtonLink'] = FieldValue.delete();
        }
        await db.collection('users').doc(slotDjUserId).update(updateData);
      } catch (err) {
        console.error('Failed to sync tipButtonLink to DJ profile:', err);
      }
    } else if (slot.djEmail) {
      try {
        const pendingSnapshot = await db.collection('pending-dj-profiles')
          .where('email', '==', slot.djEmail.toLowerCase())
          .where('status', '==', 'pending')
          .limit(1)
          .get();
        if (!pendingSnapshot.empty) {
          const updateData: Record<string, string | FieldValue> = {};
          if (normalizedLink) {
            updateData['djProfile.tipButtonLink'] = normalizedLink;
          } else {
            updateData['djProfile.tipButtonLink'] = FieldValue.delete();
          }
          await pendingSnapshot.docs[0].ref.update(updateData);
        }
      } catch (err) {
        console.error('Failed to sync tipButtonLink to pending DJ profile:', err);
      }
    }

    return NextResponse.json({
      success: true,
      tipButtonLink: normalizedLink,
    });
  } catch (error) {
    console.error('[update-tip-link] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
