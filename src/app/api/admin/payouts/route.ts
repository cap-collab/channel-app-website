import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { getAdminAuth } from '@/lib/firebase-admin';

// Check if user is admin/broadcaster
async function verifyAdminAccess(request: NextRequest): Promise<boolean> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return false;
    }

    const token = authHeader.slice(7);
    const auth = getAdminAuth();
    if (!auth) return false;

    const decodedToken = await auth.verifyIdToken(token);
    const db = getAdminDb();
    if (!db) return false;

    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    const userData = userDoc.data();
    const role = userData?.role;

    return role === 'admin' || role === 'broadcaster';
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const hasAccess = await verifyAdminAccess(request);
  if (!hasAccess) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get status filter from query params
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status'); // 'pending', 'transferred', 'reallocated_to_pool', or null for all

    // Get all tips
    let tipsQuery = db.collection('tips').where('status', '==', 'succeeded');
    const tipsSnapshot = await tipsQuery.get();

    // Calculate stats and build tips list
    let pendingCents = 0;
    let pendingCount = 0;
    let transferredCents = 0;
    let transferredCount = 0;
    let reallocatedCents = 0;
    let reallocatedCount = 0;

    interface TipRecord {
      id: string;
      createdAt: number;
      djUserId: string;
      djUsername: string;
      djEmail?: string;
      tipAmountCents: number;
      payoutStatus: string;
      transferredAt?: number;
      reallocatedAt?: number;
    }

    const tips: TipRecord[] = [];

    for (const doc of tipsSnapshot.docs) {
      const tip = doc.data();
      const tipRecord: TipRecord = {
        id: doc.id,
        createdAt: tip.createdAt?.toMillis() || 0,
        djUserId: tip.djUserId,
        djUsername: tip.djUsername,
        djEmail: tip.djEmail,
        tipAmountCents: tip.tipAmountCents,
        payoutStatus: tip.payoutStatus,
        transferredAt: tip.transferredAt?.toMillis(),
        reallocatedAt: tip.reallocatedAt?.toMillis(),
      };

      // Calculate stats
      if (tip.payoutStatus === 'pending' || tip.payoutStatus === 'pending_dj_account') {
        pendingCents += tip.tipAmountCents;
        pendingCount++;
      } else if (tip.payoutStatus === 'transferred') {
        transferredCents += tip.tipAmountCents;
        transferredCount++;
      } else if (tip.payoutStatus === 'reallocated_to_pool') {
        reallocatedCents += tip.tipAmountCents;
        reallocatedCount++;
      }

      // Filter tips by status if requested
      if (statusFilter) {
        if (statusFilter === 'pending' && (tip.payoutStatus === 'pending' || tip.payoutStatus === 'pending_dj_account')) {
          tips.push(tipRecord);
        } else if (statusFilter === tip.payoutStatus) {
          tips.push(tipRecord);
        }
      } else {
        tips.push(tipRecord);
      }
    }

    // Sort by createdAt descending (newest first)
    tips.sort((a, b) => b.createdAt - a.createdAt);

    return NextResponse.json({
      stats: {
        pending: { cents: pendingCents, count: pendingCount },
        transferred: { cents: transferredCents, count: transferredCount },
        reallocated: { cents: reallocatedCents, count: reallocatedCount },
      },
      tips,
    });
  } catch (error) {
    console.error('[api/admin/payouts] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch payouts data' }, { status: 500 });
  }
}
