import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { BroadcastSlot } from '@/types/broadcast';
import { FieldValue } from 'firebase-admin/firestore';
import { normalizeUrl } from '@/lib/url';

// POST - Set or update DJ promo link for a broadcast slot
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { broadcastToken, promoText, promoHyperlink, username } = body;

    if (!broadcastToken) {
      return NextResponse.json({ error: 'No broadcast token provided' }, { status: 400 });
    }

    if (!promoText) {
      return NextResponse.json({ error: 'No promo text provided' }, { status: 400 });
    }

    // Validate promo text length
    if (promoText.length > 200) {
      return NextResponse.json({ error: 'Promo text too long (max 200 chars)' }, { status: 400 });
    }

    // Normalize and validate hyperlink if provided
    let normalizedHyperlink: string | undefined = undefined;
    const trimmedHyperlink = promoHyperlink?.trim();
    if (trimmedHyperlink) {
      normalizedHyperlink = normalizeUrl(trimmedHyperlink);

      // Validate URL format
      try {
        const url = new URL(normalizedHyperlink);
        // Only allow http/https
        if (!['http:', 'https:'].includes(url.protocol)) {
          return NextResponse.json({ error: 'Invalid URL protocol' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
      }

      // Validate URL length
      if (normalizedHyperlink.length > 500) {
        return NextResponse.json({ error: 'URL too long (max 500 chars)' }, { status: 400 });
      }
    }

    // Look up the slot by token
    const snapshot = await db.collection('broadcast-slots')
      .where('broadcastToken', '==', broadcastToken)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'Invalid broadcast token' }, { status: 404 });
    }

    const doc = snapshot.docs[0];
    const slot = doc.data() as Omit<BroadcastSlot, 'id'>;

    // Check if token has expired
    const now = Date.now();
    if (slot.tokenExpiresAt.toMillis() < now) {
      return NextResponse.json({ error: 'Token has expired' }, { status: 410 });
    }

    // Check if slot end time has passed
    const slotEndTime = slot.endTime.toMillis();
    if (now > slotEndTime) {
      return NextResponse.json({ error: 'This broadcast slot has ended' }, { status: 410 });
    }

    // Update promo (can be changed multiple times during broadcast)
    if (slot.djSlots && slot.djSlots.length > 0) {
      // Multi-DJ: update the specific DJ slot's promo
      const djSlotIndex = slot.djSlots.findIndex(
        dj => dj.startTime <= now && dj.endTime > now
      );
      if (djSlotIndex >= 0) {
        const updatedDjSlots = [...slot.djSlots];
        updatedDjSlots[djSlotIndex] = {
          ...updatedDjSlots[djSlotIndex],
          promoText: promoText,
          promoHyperlink: normalizedHyperlink,
        };
        await doc.ref.update({ djSlots: updatedDjSlots });
      }
    } else {
      // Single DJ: update show-level promo
      await doc.ref.update({
        showPromoText: promoText,
        showPromoHyperlink: normalizedHyperlink,
      });
    }

    // Also post as a chat message
    const chatMessage = {
      stationId: 'broadcast',
      username: username || slot.liveDjUsername || 'DJ',
      message: promoText,
      timestamp: FieldValue.serverTimestamp(),
      isDJ: true,
      djSlotId: doc.id,
      messageType: 'promo',
      promoText: promoText,
      promoHyperlink: normalizedHyperlink,
    };

    const chatRef = await db.collection('chats').doc('broadcast').collection('messages').add(chatMessage);

    return NextResponse.json({
      success: true,
      promoText: promoText,
      promoHyperlink: normalizedHyperlink,
      messageId: chatRef.id,
    });
  } catch (error) {
    console.error('Error setting DJ promo:', error);
    return NextResponse.json({ error: 'Failed to set promo link' }, { status: 500 });
  }
}
