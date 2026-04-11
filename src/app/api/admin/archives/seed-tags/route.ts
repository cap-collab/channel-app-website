import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

// One-time seed: assign tags to existing archives based on confirmed mapping
const TAG_MAP: Record<string, string[]> = {
  // Pick Me Up
  'INHALE w/ Pretty Gay Friendly': ['pick-me-up'],
  'Past9': ['pick-me-up'],
  'Sky Rivers Radio': ['pick-me-up'],
  "can't be bothered hour": ['pick-me-up'],
  'VICE EVOLUTION': ['pick-me-up'],
  'Pictures of Infinity': ['pick-me-up'],
  // Chill
  'Live from the Spillzone': ['chill', 'exploratory'],
  'Tapestry': ['chill'],
  'Inner Space': ['chill'],
  'Znc': ['chill', 'exploratory'],
  'one hand clapping': ['chill', 'exploratory'],
  // Exploratory only
  'Celebrity Bitcrush': ['exploratory'],
  'Dissolved Sound': ['exploratory'],
  'Drift': ['exploratory'],
};

export async function POST() {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const snap = await db.collection('archives').get();
    const batch = db.batch();
    let updated = 0;
    let skipped = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const showName = data.showName || '';
      const tags = TAG_MAP[showName];
      if (tags) {
        batch.update(doc.ref, { tags });
        updated++;
      } else {
        skipped++;
      }
    }

    await batch.commit();

    return NextResponse.json({ success: true, total: snap.size, updated, skipped });
  } catch (error) {
    console.error('Seed tags error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
