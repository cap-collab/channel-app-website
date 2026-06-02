import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';

async function verifyAdminAccess(request: NextRequest): Promise<{ isAdmin: boolean }> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return { isAdmin: false };
    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return { isAdmin: false };
    const decoded = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return { isAdmin: false };
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    const role = userDoc.data()?.role;
    return { isAdmin: role === 'admin' || role === 'broadcaster' };
  } catch {
    return { isAdmin: false };
  }
}

// Manual "Send go-live emails now" trigger from the Marketing tab. Invokes
// the show-starting-emails cron internally so admins don't have to wait for
// the hourly schedule when a DJ goes live late. The cron's own per-user
// dedup (`lastShowStartingEmailAt[showId]`) prevents double-sending if it
// has already fanned out for the current live slot.
export async function POST(request: NextRequest) {
  const { isAdmin } = await verifyAdminAccess(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://channel-app.com';
  try {
    const resp = await fetch(`${appUrl}/api/cron/show-starting-emails`, {
      method: 'GET',
      headers: { 'x-vercel-cron': '1' },
    });
    const body = await resp.json();
    if (!resp.ok) {
      return NextResponse.json({ error: body?.error || 'Cron call failed' }, { status: 500 });
    }
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
