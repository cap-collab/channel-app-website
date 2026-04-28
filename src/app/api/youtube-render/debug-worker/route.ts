import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

async function verifyAdminAccess(request: NextRequest): Promise<boolean> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return false;
    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return false;
    const decoded = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return false;
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    const role = userDoc.data()?.role;
    return role === 'admin' || role === 'broadcaster';
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!(await verifyAdminAccess(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workerUrl = process.env.YOUTUBE_RENDER_WORKER_URL;
  const sharedSecret = process.env.SHARED_SECRET || process.env.CRON_SECRET;
  const result: Record<string, unknown> = {
    YOUTUBE_RENDER_WORKER_URL: workerUrl ? `set (${workerUrl})` : 'MISSING',
    SHARED_SECRET: sharedSecret ? `set (length=${sharedSecret.length})` : 'MISSING',
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  };
  // If the URL is set, try a no-op fetch to see if we can even reach it
  if (workerUrl && sharedSecret) {
    try {
      const r = await fetch(`${workerUrl.replace(/\/$/, '')}/status`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${sharedSecret}` },
      });
      result.workerStatus = r.status;
      try {
        result.workerBody = await r.json();
      } catch {
        result.workerBody = '(non-JSON body)';
      }
    } catch (err) {
      result.workerFetchError = err instanceof Error ? err.message : String(err);
    }
  }
  return NextResponse.json(result);
}
