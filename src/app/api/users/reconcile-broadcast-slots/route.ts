import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// POST - Reconcile broadcast slots and tips when a DJ user is created
// Called when a user is created - checks if they have approved DJ slots and assigns DJ role
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { userId, email } = body;

    if (!userId || !email) {
      return NextResponse.json({ error: 'userId and email are required' }, { status: 400 });
    }

    console.log(`[reconcile] Starting reconciliation for user ${userId} (${email})`);

    let slotsUpdated = 0;
    let tipsUpdated = 0;
    let djRoleAssigned = false;

    // Find broadcast slots where djEmail matches
    const slotsSnapshot = await db.collection('broadcast-slots')
      .where('djEmail', '==', email)
      .get();

    for (const slotDoc of slotsSnapshot.docs) {
      const slotData = slotDoc.data();

      // Only update if djUserId is not already set
      if (!slotData.djUserId) {
        await slotDoc.ref.update({ djUserId: userId });
        slotsUpdated++;
        console.log(`[reconcile] Updated slot ${slotDoc.id} with djUserId ${userId}`);
      }
    }

    // If user has any broadcast slots, assign DJ role if they don't have a higher role
    if (slotsSnapshot.size > 0) {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      const userData = userDoc.data();

      const currentRole = userData?.role;
      if (!currentRole || currentRole === 'user') {
        await userRef.update({ role: 'dj' });
        djRoleAssigned = true;
        console.log(`[reconcile] Assigned DJ role to user ${userId}`);
      }
    }

    // Also reconcile pending tips (where djUserId is 'pending' but djEmail matches)
    const pendingTipsSnapshot = await db.collection('tips')
      .where('djEmail', '==', email)
      .where('djUserId', '==', 'pending')
      .where('status', '==', 'succeeded')
      .get();

    for (const tipDoc of pendingTipsSnapshot.docs) {
      await tipDoc.ref.update({
        djUserId: userId,
        payoutStatus: 'pending', // Ready for transfer when DJ links Stripe
      });
      tipsUpdated++;
      console.log(`[reconcile] Updated tip ${tipDoc.id} with djUserId ${userId}`);
    }

    console.log(`[reconcile] Completed: ${slotsUpdated} slots, ${tipsUpdated} tips updated, djRole=${djRoleAssigned} for ${email}`);

    return NextResponse.json({
      success: true,
      slotsUpdated,
      tipsUpdated,
      djRoleAssigned,
    });
  } catch (error) {
    console.error('[reconcile] Error:', error);
    return NextResponse.json({ error: 'Failed to reconcile broadcast slots' }, { status: 500 });
  }
}
