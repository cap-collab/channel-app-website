import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

// GET - Fetch tip history for a user (grouped by DJ for inbox display)
export async function GET(request: NextRequest) {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    // Fetch all succeeded tips for this user
    const tipsSnapshot = await db.collection('tips')
      .where('tipperUserId', '==', userId)
      .where('status', '==', 'succeeded')
      .orderBy('createdAt', 'desc')
      .get();

    // Transform and group tips by DJ
    const tips = tipsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        djUserId: data.djUserId,
        djUsername: data.djUsername,
        djThankYouMessage: data.djThankYouMessage || 'Thanks for the tip!',
        tipAmountCents: data.tipAmountCents,
        showName: data.showName,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      };
    });

    // Group tips by DJ
    const groupedByDj = tips.reduce((acc, tip) => {
      const key = tip.djUserId;
      if (!acc[key]) {
        acc[key] = {
          djUserId: tip.djUserId,
          djUsername: tip.djUsername,
          tips: [],
          totalAmountCents: 0,
          latestTipDate: tip.createdAt,
        };
      }
      acc[key].tips.push(tip);
      acc[key].totalAmountCents += tip.tipAmountCents;
      return acc;
    }, {} as Record<string, {
      djUserId: string;
      djUsername: string;
      tips: typeof tips;
      totalAmountCents: number;
      latestTipDate: string;
    }>);

    // Fetch DJ profile photos
    const djUserIds = Object.keys(groupedByDj).filter(id => id && id !== 'pending');
    const djPhotos: Record<string, string | null> = {};

    if (djUserIds.length > 0) {
      const userDocs = await Promise.all(
        djUserIds.map(id => db.collection('users').doc(id).get())
      );
      userDocs.forEach((doc, index) => {
        if (doc.exists) {
          const data = doc.data();
          djPhotos[djUserIds[index]] = data?.djProfile?.photoUrl || null;
        }
      });
    }

    // Convert to array, add photos, and sort by most recent tip
    const djGroups = Object.values(groupedByDj)
      .map(group => ({
        ...group,
        djPhotoUrl: djPhotos[group.djUserId] || null,
      }))
      .sort((a, b) =>
        new Date(b.latestTipDate).getTime() - new Date(a.latestTipDate).getTime()
      );

    return NextResponse.json({
      djGroups,
      totalTips: tips.length,
    });
  } catch (error) {
    console.error('Error fetching tip history:', error);
    return NextResponse.json({ error: 'Failed to fetch tip history' }, { status: 500 });
  }
}
