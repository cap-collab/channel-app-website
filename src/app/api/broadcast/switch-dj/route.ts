import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// POST - Switch to a new DJ slot during a venue broadcast
// Called when time-based detection triggers a slot change
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      console.error('[switch-dj] Database not configured');
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { slotId, djSlotId } = body;

    if (!slotId || !djSlotId) {
      return NextResponse.json({ error: 'Missing slotId or djSlotId' }, { status: 400 });
    }

    // Get the broadcast slot
    const slotRef = db.collection('broadcast-slots').doc(slotId);
    const slotDoc = await slotRef.get();

    if (!slotDoc.exists) {
      return NextResponse.json({ error: 'Broadcast slot not found' }, { status: 404 });
    }

    const slotData = slotDoc.data();
    if (!slotData) {
      return NextResponse.json({ error: 'Broadcast slot data is empty' }, { status: 404 });
    }

    // Verify this is a venue broadcast with DJ slots
    if (slotData.broadcastType !== 'venue') {
      return NextResponse.json({ error: 'Not a venue broadcast' }, { status: 400 });
    }

    if (!slotData.djSlots || !Array.isArray(slotData.djSlots)) {
      return NextResponse.json({ error: 'No DJ slots configured' }, { status: 400 });
    }

    // Find the target DJ slot
    const djSlot = slotData.djSlots.find((dj: { id: string }) => dj.id === djSlotId);
    if (!djSlot) {
      return NextResponse.json({ error: 'DJ slot not found' }, { status: 404 });
    }

    // Don't switch if already on this slot
    if (slotData.currentDjSlotId === djSlotId) {
      return NextResponse.json({
        success: true,
        message: 'Already on this DJ slot',
        currentDjSlotId: djSlotId
      });
    }

    // Look up user profile by email if DJ slot has an email
    let userProfileData: Record<string, unknown> | null = null;
    if (djSlot.djEmail) {
      const userByEmailSnapshot = await db.collection('users')
        .where('email', '==', djSlot.djEmail)
        .limit(1)
        .get();

      if (!userByEmailSnapshot.empty) {
        userProfileData = userByEmailSnapshot.docs[0].data();
        console.log('[switch-dj] Found user profile by email:', { djEmail: djSlot.djEmail, hasProfile: !!userProfileData?.djProfile });
      }
    }

    // Copy DJ info from the slot to the broadcast's live fields
    // Priority: DJ slot config > user profile by email
    const djProfile = userProfileData?.djProfile as Record<string, unknown> | undefined;
    const liveDjUsername = djSlot.djUsername || djSlot.djName || userProfileData?.chatUsername || null;
    const liveDjBio = djSlot.djBio || djProfile?.bio || null;
    const liveDjPhotoUrl = djSlot.djPhotoUrl || djProfile?.photoUrl || null;
    const liveDjPromoText = djSlot.djPromoText || djProfile?.promoText || null;
    const liveDjPromoHyperlink = djSlot.djPromoHyperlink || djProfile?.promoHyperlink || null;

    const updateData: Record<string, unknown> = {
      currentDjSlotId: djSlotId,
      liveDjUserId: djSlot.djUserId || null,
      liveDjUsername,
      liveDjBio,
      liveDjPhotoUrl,
      liveDjPromoText,
      liveDjPromoHyperlink,
      djEmail: djSlot.djEmail || null,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Also update the DJ slot's runtime fields
    const updatedDjSlots = slotData.djSlots.map((dj: { id: string }) => {
      if (dj.id === djSlotId) {
        return {
          ...dj,
          liveDjUserId: djSlot.djUserId || null,
          liveDjUsername: liveDjUsername || null,
          promoText: djSlot.djPromoText || null,
          promoHyperlink: djSlot.djPromoHyperlink || null,
        };
      }
      return dj;
    });

    updateData.djSlots = updatedDjSlots;

    await slotRef.update(updateData);

    console.log('[switch-dj] Switched to DJ slot:', {
      slotId,
      djSlotId,
      djName: djSlot.djName,
      liveDjUsername,
      hasDjUserId: !!djSlot.djUserId,
    });

    return NextResponse.json({
      success: true,
      currentDjSlotId: djSlotId,
      liveDjUsername,
      liveDjUserId: djSlot.djUserId || null,
    });
  } catch (error) {
    console.error('[switch-dj] Error:', error);
    return NextResponse.json({ error: 'Failed to switch DJ' }, { status: 500 });
  }
}
