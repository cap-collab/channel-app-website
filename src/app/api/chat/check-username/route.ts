import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// Reserved usernames that cannot be registered (case-insensitive)
const RESERVED_USERNAMES = ['channel', 'admin', 'system', 'moderator', 'mod'];

// GET - Check if a username is available
export async function GET(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    const userId = searchParams.get('userId');

    if (!username) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    const trimmed = username.trim();

    // Basic validation
    if (trimmed.length < 2 || trimmed.length > 20) {
      return NextResponse.json({
        available: false,
        reason: 'Username must be 2-20 characters',
      });
    }

    // Generate normalized handle (remove spaces, lowercase)
    const handle = trimmed.replace(/\s+/g, '').toLowerCase();

    // Check reserved usernames
    if (RESERVED_USERNAMES.includes(handle)) {
      return NextResponse.json({
        available: false,
        reason: 'This username is reserved',
      });
    }

    // Check if username exists in usernames collection
    const usernameDoc = await db.collection('usernames').doc(handle).get();

    if (!usernameDoc.exists) {
      // Username is available
      return NextResponse.json({ available: true });
    }

    // Username exists - check if it belongs to the requesting user
    const existingUid = usernameDoc.data()?.uid;
    if (userId && existingUid === userId) {
      // User already owns this username
      return NextResponse.json({ available: true, owned: true });
    }

    // Username taken by someone else
    return NextResponse.json({
      available: false,
      reason: 'Username is already taken',
    });
  } catch (error) {
    console.error('[check-username] Error:', error);
    return NextResponse.json({ error: 'Failed to check username' }, { status: 500 });
  }
}
