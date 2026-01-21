import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { ArchiveSerialized } from '@/types/broadcast';

export const dynamic = 'force-dynamic';

interface DJInfo {
  name: string;
  username?: string;
  photoUrl?: string;
  userId?: string;
  email?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const archivesRef = db.collection('archives');
    const snapshot = await archivesRef
      .where('slug', '==', slug)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ error: 'Archive not found' }, { status: 404 });
    }

    const doc = snapshot.docs[0];
    const data = doc.data();
    let djs: DJInfo[] = data.djs || [];

    // Check if any DJ is missing both username AND email (need to look up slot)
    const needsSlotLookup = djs.some((dj) => !dj.username && !dj.email);

    // Look up broadcast slot to get DJ emails if needed
    if (needsSlotLookup && data.broadcastSlotId) {
      const slotDoc = await db.collection('broadcast-slots').doc(data.broadcastSlotId).get();
      if (slotDoc.exists) {
        const slotData = slotDoc.data();
        if (slotData) {
          const djNameToEmail = new Map<string, string>();

          // Check djSlots array (venue broadcasts)
          if (slotData.djSlots && Array.isArray(slotData.djSlots)) {
            for (const slot of slotData.djSlots) {
              if (slot.djName && slot.djEmail) {
                djNameToEmail.set(slot.djName.toLowerCase(), slot.djEmail.toLowerCase());
              }
            }
          }

          // Check top-level DJ info (remote broadcasts)
          if (slotData.djEmail && (slotData.djName || slotData.liveDjUsername)) {
            const name = (slotData.djName || slotData.liveDjUsername) as string;
            djNameToEmail.set(name.toLowerCase(), (slotData.djEmail as string).toLowerCase());
          }

          // Enrich DJs with emails from slot
          djs = djs.map((dj) => {
            if (!dj.email && !dj.username) {
              const email = djNameToEmail.get(dj.name.toLowerCase());
              if (email) {
                return { ...dj, email };
              }
            }
            return dj;
          });
        }
      }
    }

    // Collect emails needing pending profile lookup
    const emailsNeedingLookup = new Set<string>();
    djs.forEach((dj) => {
      if (!dj.username && dj.email) {
        emailsNeedingLookup.add(dj.email.toLowerCase());
      }
    });

    // Look up pending profiles for DJs without usernames
    if (emailsNeedingLookup.size > 0) {
      const pendingProfilesRef = db.collection('pending-dj-profiles');
      const pendingSnapshot = await pendingProfilesRef
        .where('status', '==', 'pending')
        .get();

      const emailToUsername = new Map<string, string>();
      pendingSnapshot.docs.forEach((pendingDoc) => {
        const profile = pendingDoc.data();
        if (profile.email && profile.chatUsernameNormalized) {
          const email = profile.email.toLowerCase();
          if (emailsNeedingLookup.has(email)) {
            emailToUsername.set(email, profile.chatUsername);
          }
        }
      });

      // Enrich DJs with pending profile usernames
      djs = djs.map((dj) => {
        if (!dj.username && dj.email) {
          const username = emailToUsername.get(dj.email.toLowerCase());
          if (username) {
            return { ...dj, username };
          }
        }
        return dj;
      });
    }

    const archive: ArchiveSerialized = {
      id: doc.id,
      slug: data.slug,
      broadcastSlotId: data.broadcastSlotId,
      showName: data.showName,
      djs,
      recordingUrl: data.recordingUrl,
      duration: data.duration || 0,
      recordedAt: data.recordedAt,
      createdAt: data.createdAt,
      stationId: data.stationId || 'channel-main',
      showImageUrl: data.showImageUrl,
    };

    return NextResponse.json({ archive });
  } catch (error) {
    console.error('Error fetching archive:', error);
    return NextResponse.json({ error: 'Failed to fetch archive' }, { status: 500 });
  }
}
