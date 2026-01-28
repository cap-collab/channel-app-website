import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

interface EmailCaptureRequest {
  email: string;
  djName: string;
  showName: string;
  showTime: string;
  djUserId?: string;
  djEmail?: string;
}

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      );
    }

    const body: EmailCaptureRequest = await request.json();
    const { email, djName, showName, showTime, djUserId, djEmail } = body;

    if (!email || !djName) {
      return NextResponse.json(
        { error: 'Email and DJ name are required' },
        { status: 400 }
      );
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists with this email
    const usersRef = db.collection('users');
    const existingUserQuery = await usersRef.where('email', '==', normalizedEmail).limit(1).get();

    if (!existingUserQuery.empty) {
      // User exists - add DJ to their watchlist and enable notifications
      const userDoc = existingUserQuery.docs[0];

      // Enable watchlist notifications
      await userDoc.ref.update({
        'emailNotifications.watchlistMatch': true,
      });

      // Add DJ to watchlist
      const favoritesRef = userDoc.ref.collection('favorites');
      const normalizedTerm = djName.toLowerCase().replace(/[\s-]+/g, '');

      // Check if already in watchlist
      const existingFavorite = await favoritesRef
        .where('term', '==', normalizedTerm)
        .where('type', '==', 'search')
        .limit(1)
        .get();

      if (existingFavorite.empty) {
        await favoritesRef.add({
          term: normalizedTerm,
          type: 'search',
          djName,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'web',
        });
      }

      return NextResponse.json({
        success: true,
        message: 'Reminder set for existing user',
        isExistingUser: true,
      });
    }

    // Create pending reminder for new user
    const pendingRemindersRef = db.collection('pending-reminders');
    await pendingRemindersRef.add({
      email: normalizedEmail,
      djName,
      djNameNormalized: djName.toLowerCase().replace(/[\s-]+/g, ''),
      showName,
      showTime,
      djUserId: djUserId || null,
      djEmail: djEmail || null,
      createdAt: FieldValue.serverTimestamp(),
      status: 'pending',
    });

    return NextResponse.json({
      success: true,
      message: 'Reminder created',
      isExistingUser: false,
    });
  } catch (error) {
    console.error('Error in email capture:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
