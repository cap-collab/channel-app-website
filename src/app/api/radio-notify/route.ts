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

    const { email, timezone, city, genres } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // City from client filter selection / device timezone, with Vercel IP geolocation as fallback
    const geoCity = request.headers.get('x-vercel-ip-city');
    const resolvedCity = city || (geoCity ? decodeURIComponent(geoCity) : undefined);

    await db.collection('radio-notify-waitlist').add({
      email: email.trim().toLowerCase(),
      ...(resolvedCity && { city: resolvedCity }),
      ...(timezone && { timezone }),
      ...(Array.isArray(genres) && genres.length > 0 && { genres }),
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
