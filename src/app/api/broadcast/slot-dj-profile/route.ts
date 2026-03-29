import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// GET - Fetch DJ profile data for a broadcast slot
// Returns promo text, promo hyperlink, and thank you message from the DJ's profile
// Priority: DJ slot data > user profile > pending DJ profile
export async function GET(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const broadcastToken = searchParams.get('token');

    if (!broadcastToken) {
      return NextResponse.json({ error: 'No token provided' }, { status: 400 });
    }

    // Look up the slot by token
    const snapshot = await db.collection('broadcast-slots')
      .where('broadcastToken', '==', broadcastToken)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
    }

    const slotData = snapshot.docs[0].data();
    const now = Date.now();

    // For multi-DJ shows, find the active DJ slot
    let activeDjSlot = null;
    if (slotData.djSlots && slotData.djSlots.length > 0) {
      activeDjSlot = slotData.djSlots.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (djSlot: any) => {
          const slotStart = typeof djSlot.startTime === 'number' ? djSlot.startTime : djSlot.startTime?.toMillis?.() || 0;
          const slotEnd = typeof djSlot.endTime === 'number' ? djSlot.endTime : djSlot.endTime?.toMillis?.() || 0;
          return slotStart <= now && slotEnd > now;
        }
      );
    }

    // If we have DJ slot data with profile info, use it directly
    if (activeDjSlot) {
      return NextResponse.json({
        djUserId: activeDjSlot.djUserId || null,
        chatUsername: activeDjSlot.djUsername || null,
        promoText: activeDjSlot.djPromoText || activeDjSlot.promoText || null,
        promoHyperlink: activeDjSlot.djPromoHyperlink || activeDjSlot.promoHyperlink || null,
        thankYouMessage: activeDjSlot.djThankYouMessage || null,
      });
    }

    // Single-DJ show: look up profile by djUserId or djEmail
    // Use the slot's configured DJ (djUserId), NOT liveDjUserId (which is whoever logged in to broadcast)
    const djUserId = slotData.djUserId;
    const djEmail = slotData.djEmail;

    // Try user profile first
    if (djUserId) {
      const userDoc = await db.collection('users').doc(djUserId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        const djProfile = userData?.djProfile;
        return NextResponse.json({
          djUserId,
          chatUsername: userData?.chatUsername || null,
          promoText: djProfile?.promoText || slotData.showPromoText || null,
          promoHyperlink: djProfile?.promoHyperlink || slotData.showPromoHyperlink || null,
          thankYouMessage: djProfile?.thankYouMessage || null,
        });
      }
    }

    // Try pending DJ profile by email
    if (djEmail) {
      // First check if there's a user with this email
      const userByEmail = await db.collection('users')
        .where('email', '==', djEmail)
        .limit(1)
        .get();

      if (!userByEmail.empty) {
        const foundUserId = userByEmail.docs[0].id;
        const userData = userByEmail.docs[0].data();
        const djProfile = userData?.djProfile;
        return NextResponse.json({
          djUserId: foundUserId,
          chatUsername: userData?.chatUsername || null,
          promoText: djProfile?.promoText || slotData.showPromoText || null,
          promoHyperlink: djProfile?.promoHyperlink || slotData.showPromoHyperlink || null,
          thankYouMessage: djProfile?.thankYouMessage || null,
        });
      }

      // Fall back to pending DJ profile
      const pendingSnapshot = await db.collection('pending-dj-profiles')
        .where('email', '==', djEmail.toLowerCase())
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (!pendingSnapshot.empty) {
        const pendingData = pendingSnapshot.docs[0].data();
        const djProfile = pendingData?.djProfile;
        return NextResponse.json({
          djUserId: null,
          chatUsername: pendingData?.chatUsername || null,
          promoText: djProfile?.promoText || slotData.showPromoText || null,
          promoHyperlink: djProfile?.promoHyperlink || slotData.showPromoHyperlink || null,
          thankYouMessage: djProfile?.thankYouMessage || null,
        });
      }
    }

    // Fallback: show-level promo only
    return NextResponse.json({
      djUserId: null,
      chatUsername: null,
      promoText: slotData.showPromoText || null,
      promoHyperlink: slotData.showPromoHyperlink || null,
      thankYouMessage: null,
    });
  } catch (error) {
    console.error('[slot-dj-profile] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch DJ profile' }, { status: 500 });
  }
}
