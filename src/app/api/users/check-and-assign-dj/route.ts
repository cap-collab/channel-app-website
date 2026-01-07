import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

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

    // Look up user by email
    const usersSnapshot = await db.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      // User doesn't exist
      return NextResponse.json({ userExists: false });
    }

    const userDoc = usersSnapshot.docs[0];
    const userData = userDoc.data();
    const currentRole = userData.role;

    // Only assign DJ role if they don't already have a higher role
    // Role hierarchy: admin > broadcaster > dj > user (undefined)
    if (!currentRole || currentRole === 'user') {
      await userDoc.ref.update({ role: 'dj' });
      console.log(`Assigned DJ role to user ${userDoc.id} (${email})`);
    } else {
      console.log(`User ${userDoc.id} already has role: ${currentRole}, not changing`);
    }

    return NextResponse.json({ userExists: true, userId: userDoc.id });
  } catch (error) {
    console.error('Error checking/assigning DJ role:', error);
    return NextResponse.json({ error: 'Failed to check user' }, { status: 500 });
  }
}
