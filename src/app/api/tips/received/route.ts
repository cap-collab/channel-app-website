import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// GET - Fetch tips received by a DJ (grouped by tipper for inbox display)
export async function GET(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const djUserId = searchParams.get('djUserId');

    if (!djUserId) {
      return NextResponse.json({ error: 'DJ User ID required' }, { status: 400 });
    }

    // Fetch all succeeded tips received by this DJ
    const tipsSnapshot = await db.collection('tips')
      .where('djUserId', '==', djUserId)
      .where('status', '==', 'succeeded')
      .orderBy('createdAt', 'desc')
      .get();

    // Transform and group tips by tipper
    const tips = tipsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        tipperUserId: data.tipperUserId || null,
        tipperUsername: data.tipperUsername || 'Anonymous',
        tipAmountCents: data.tipAmountCents,
        showName: data.showName,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      };
    });

    // Group tips by tipper
    const groupedByTipper = tips.reduce((acc, tip) => {
      const key = tip.tipperUsername;
      if (!acc[key]) {
        acc[key] = {
          tipperUserId: tip.tipperUserId,
          tipperUsername: tip.tipperUsername,
          tips: [],
          totalAmountCents: 0,
          latestTipDate: tip.createdAt,
        };
      }
      acc[key].tips.push(tip);
      acc[key].totalAmountCents += tip.tipAmountCents;
      return acc;
    }, {} as Record<string, {
      tipperUserId: string | null;
      tipperUsername: string;
      tips: typeof tips;
      totalAmountCents: number;
      latestTipDate: string;
    }>);

    // Convert to array and sort by most recent tip
    const tipperGroups = Object.values(groupedByTipper)
      .sort((a, b) =>
        new Date(b.latestTipDate).getTime() - new Date(a.latestTipDate).getTime()
      );

    // Calculate totals
    const totalReceivedCents = tips.reduce((sum, tip) => sum + tip.tipAmountCents, 0);

    return NextResponse.json({
      tipperGroups,
      totalTips: tips.length,
      totalReceivedCents,
    });
  } catch (error) {
    console.error('Error fetching received tips:', error);
    // Check if it's an index error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('index')) {
      return NextResponse.json({
        error: 'Database index required. Please create a composite index for tips collection with fields: djUserId, status, createdAt',
        details: errorMessage
      }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to fetch received tips', details: errorMessage }, { status: 500 });
  }
}
