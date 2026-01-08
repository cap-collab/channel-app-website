import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// GET - Test endpoint to verify webhook route is reachable and Firebase works
export async function GET(request: NextRequest) {
  const checks = {
    routeReachable: true,
    stripeSecretKeySet: !!process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecretSet: !!process.env.STRIPE_WEBHOOK_SECRET,
    stripeWebhookSecretLength: process.env.STRIPE_WEBHOOK_SECRET?.length || 0,
    firebaseProjectIdSet: !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    firebaseAdminClientEmailSet: !!process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    firebaseAdminPrivateKeySet: !!process.env.FIREBASE_ADMIN_PRIVATE_KEY,
    firebaseDbWorking: false,
    error: null as string | null,
  };

  try {
    const db = getAdminDb();
    if (db) {
      // Try to read something to verify connection works
      const testDoc = await db.collection('tips').limit(1).get();
      checks.firebaseDbWorking = true;
    }
  } catch (error) {
    checks.error = error instanceof Error ? error.message : 'Unknown error';
  }

  return NextResponse.json(checks);
}
// trigger deploy
