import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      );
    }

    const { email, timezone } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // City from Vercel IP geolocation (most granular available)
    const geoCity = request.headers.get('x-vercel-ip-city');

    await db.collection('radio-notify-waitlist').add({
      email: email.trim().toLowerCase(),
      ...(geoCity && { city: decodeURIComponent(geoCity) }),
      ...(timezone && { timezone }),
      marketingOptIn: true,
      submittedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in radio-notify:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
