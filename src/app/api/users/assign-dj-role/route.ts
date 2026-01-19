import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// POST - Mark an email as pending DJ role assignment
// Called when someone submits a DJ application without being logged in
// When they later create an account, the role will be assigned via reconciliation
export async function POST(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // First check if user already exists with this email
    const usersSnapshot = await db.collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (!usersSnapshot.empty) {
      // User exists - assign DJ role directly if they don't have a higher role
      const userDoc = usersSnapshot.docs[0];
      const userData = userDoc.data();
      const currentRole = userData.role;

      if (!currentRole || currentRole === 'user') {
        await userDoc.ref.update({
          role: 'dj',
          djTermsAcceptedAt: Timestamp.now()
        });
        console.log(`[assign-dj-role] Assigned DJ role directly to existing user ${userDoc.id} (${normalizedEmail})`);
      }

      return NextResponse.json({ success: true, existingUser: true });
    }

    // User doesn't exist - store in pending-dj-roles for future reconciliation
    // Check if already pending
    const pendingSnapshot = await db.collection('pending-dj-roles')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();

    if (pendingSnapshot.empty) {
      await db.collection('pending-dj-roles').add({
        email: normalizedEmail,
        createdAt: Timestamp.now(),
        source: 'studio-join-application',
        djTermsAcceptedAt: Timestamp.now(),
      });
      console.log(`[assign-dj-role] Created pending DJ role for ${normalizedEmail}`);
    } else {
      console.log(`[assign-dj-role] Pending DJ role already exists for ${normalizedEmail}`);
    }

    return NextResponse.json({ success: true, pendingCreated: true });
  } catch (error) {
    console.error('[assign-dj-role] Error:', error);
    return NextResponse.json({ error: 'Failed to assign DJ role' }, { status: 500 });
  }
}
