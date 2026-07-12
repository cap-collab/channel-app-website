import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { INTERSTITIALS_COLLECTION } from '@/lib/archive-schedule';
import type { Interstitial } from '@/types/broadcast';
import type { FieldNoteCaption } from '@/types/field-notes';

// Read-only list of the interlude (interstitial) clips. The archive-radio player
// self-fetches this once per mount to resolve the currently-playing interlude's
// captions + waveform for the hero-slide overlay (mirrors how it self-fetches
// /api/archives to resolve the current archive). The collection is tiny (a
// handful of clips) and changes rarely, so cache it briefly.
export const revalidate = 300;

export async function GET() {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const snap = await db.collection(INTERSTITIALS_COLLECTION).get();
    const interstitials: Interstitial[] = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      if (!d.url || !d.durationSec) continue;
      const item: Interstitial = {
        id: doc.id,
        url: d.url,
        durationSec: Number(d.durationSec),
        label: d.label,
        uploadedAtMs: Number(d.uploadedAtMs ?? 0),
      };
      // Denormalized subtitle/waveform data, present only on backfilled clips.
      if (typeof d.fieldNoteId === 'string') item.fieldNoteId = d.fieldNoteId;
      if (Array.isArray(d.captions)) {
        item.captions = (d.captions as unknown[]).filter(
          (c): c is FieldNoteCaption =>
            !!c && typeof c === 'object' &&
            typeof (c as FieldNoteCaption).from === 'number' &&
            typeof (c as FieldNoteCaption).to === 'number' &&
            typeof (c as FieldNoteCaption).text === 'string',
        );
      }
      if (Array.isArray(d.waveform)) {
        item.waveform = (d.waveform as unknown[]).filter((n): n is number => typeof n === 'number');
      }
      interstitials.push(item);
    }

    return NextResponse.json({ interstitials });
  } catch (error) {
    console.error('Error fetching interstitials:', error);
    return NextResponse.json({ error: 'Failed to fetch interstitials' }, { status: 500 });
  }
}
