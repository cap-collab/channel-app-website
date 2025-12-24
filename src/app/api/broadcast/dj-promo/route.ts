import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { BroadcastSlot } from '@/types/broadcast';
import { FieldValue } from 'firebase-admin/firestore';

// POST - Set or update DJ promo link for a broadcast slot
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { broadcastToken, promoUrl, promoTitle, username } = body;

    if (!broadcastToken) {
      return NextResponse.json({ error: 'No broadcast token provided' }, { status: 400 });
    }

    if (!promoUrl) {
      return NextResponse.json({ error: 'No promo URL provided' }, { status: 400 });
    }

    // Validate URL format
    try {
      const url = new URL(promoUrl);
      // Only allow http/https
      if (!['http:', 'https:'].includes(url.protocol)) {
        return NextResponse.json({ error: 'Invalid URL protocol' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    // Validate URL length
    if (promoUrl.length > 500) {
      return NextResponse.json({ error: 'URL too long (max 500 chars)' }, { status: 400 });
    }

    // Validate title if provided
    if (promoTitle && promoTitle.length > 100) {
      return NextResponse.json({ error: 'Title too long (max 100 chars)' }, { status: 400 });
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

    // Check if slot is still valid
    if (slot.status === 'completed' || slot.status === 'missed') {
      return NextResponse.json({ error: 'This broadcast slot has ended' }, { status: 410 });
    }

    // Check if promo has already been set (one-and-done for single DJ)
    // For multi-DJ, we check the current DJ slot instead
    if (slot.djSlots && slot.djSlots.length > 0) {
      // Multi-DJ: find current DJ slot and check their promo
      const currentDjSlot = slot.djSlots.find(
        dj => dj.startTime <= now && dj.endTime > now
      );
      if (currentDjSlot?.promoUrl) {
        return NextResponse.json({ error: 'Promo link already set for this DJ slot' }, { status: 409 });
      }
      // Update the specific DJ slot's promo
      const djSlotIndex = slot.djSlots.findIndex(
        dj => dj.startTime <= now && dj.endTime > now
      );
      if (djSlotIndex >= 0) {
        const updatedDjSlots = [...slot.djSlots];
        updatedDjSlots[djSlotIndex] = {
          ...updatedDjSlots[djSlotIndex],
          promoUrl,
          promoTitle: promoTitle || null,
        };
        await doc.ref.update({ djSlots: updatedDjSlots });
      }
    } else {
      // Single DJ: check show-level promo
      if (slot.showPromoUrl) {
        return NextResponse.json({ error: 'Promo link already set for this broadcast' }, { status: 409 });
      }
      // Update show-level promo
      await doc.ref.update({
        showPromoUrl: promoUrl,
        showPromoTitle: promoTitle || null,
      });
    }

    // Also post as a chat message
    const chatMessage = {
      stationId: 'broadcast',
      username: username || slot.liveDjUsername || 'DJ',
      message: promoTitle || promoUrl,
      timestamp: FieldValue.serverTimestamp(),
      isDJ: true,
      djSlotId: doc.id,
      messageType: 'promo',
      promoUrl,
      promoTitle: promoTitle || null,
    };

    const chatRef = await db.collection('chats').doc('broadcast').collection('messages').add(chatMessage);

    return NextResponse.json({
      success: true,
      promoUrl,
      promoTitle: promoTitle || null,
      messageId: chatRef.id,
    });
  } catch (error) {
    console.error('Error setting DJ promo:', error);
    return NextResponse.json({ error: 'Failed to set promo link' }, { status: 500 });
  }
}
