import { NextResponse } from 'next/server';
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

export async function GET() {
  try {
    const db = getAdminDb();
    if (!db) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const archivesRef = db.collection('archives');
    // Get all archives without orderBy to avoid index requirement
    const snapshot = await archivesRef.get();

    // First pass: collect archives and identify which need slot lookups
    const slotIdsNeedingLookup = new Set<string>();
    const rawArchives = snapshot.docs.map((doc) => {
      const data = doc.data();
      const djs: DJInfo[] = data.djs || [];

      // Check if any DJ is missing both username AND email (need to look up slot)
      const needsSlotLookup = djs.some((dj) => !dj.username && !dj.email);
      if (needsSlotLookup && data.broadcastSlotId) {
        slotIdsNeedingLookup.add(data.broadcastSlotId);
      }

      return {
        id: doc.id,
        data,
        djs,
      };
    });

    // Look up broadcast slots to get DJ emails for archives missing them
    const slotDjEmails = new Map<string, Map<string, string>>(); // slotId -> (djName -> email)
    if (slotIdsNeedingLookup.size > 0) {
      const slotsRef = db.collection('broadcast-slots');
      // Firestore doesn't support whereIn with more than 30 items, so batch if needed
      const slotIds = Array.from(slotIdsNeedingLookup);
      const batches = [];
      for (let i = 0; i < slotIds.length; i += 30) {
        batches.push(slotIds.slice(i, i + 30));
      }

      for (const batch of batches) {
        const slotDocs = await Promise.all(
          batch.map((slotId) => slotsRef.doc(slotId).get())
        );

        for (const slotDoc of slotDocs) {
          if (!slotDoc.exists) continue;
          const slotData = slotDoc.data();
          if (!slotData) continue;

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

          if (djNameToEmail.size > 0) {
            slotDjEmails.set(slotDoc.id, djNameToEmail);
          }
        }
      }
    }

    // Second pass: enrich DJs with emails from slots, collect all emails for pending profile lookup
    const emailsNeedingLookup = new Set<string>();
    const enrichedRawArchives = rawArchives.map(({ id, data, djs }) => {
      const enrichedDjs = djs.map((dj) => {
        // If DJ already has email, use it
        if (dj.email) {
          if (!dj.username) {
            emailsNeedingLookup.add(dj.email.toLowerCase());
          }
          return dj;
        }

        // Try to get email from slot lookup
        if (!dj.username && data.broadcastSlotId) {
          const slotEmails = slotDjEmails.get(data.broadcastSlotId);
          if (slotEmails) {
            const email = slotEmails.get(dj.name.toLowerCase());
            if (email) {
              emailsNeedingLookup.add(email);
              return { ...dj, email };
            }
          }
        }

        return dj;
      });

      return { id, data, djs: enrichedDjs };
    });

    // Look up pending profiles for DJs without usernames
    const emailToUsername = new Map<string, string>();
    if (emailsNeedingLookup.size > 0) {
      const pendingProfilesRef = db.collection('pending-dj-profiles');
      const pendingSnapshot = await pendingProfilesRef
        .where('status', '==', 'pending')
        .get();

      pendingSnapshot.docs.forEach((doc) => {
        const profile = doc.data();
        if (profile.email && profile.chatUsernameNormalized) {
          const email = profile.email.toLowerCase();
          if (emailsNeedingLookup.has(email)) {
            emailToUsername.set(email, profile.chatUsername);
          }
        }
      });
    }

    // Build final archives with enriched DJ data
    const archives: ArchiveSerialized[] = enrichedRawArchives.map(({ id, data, djs }) => {
      // Enrich DJs with pending profile usernames
      const enrichedDjs = djs.map((dj) => {
        if (!dj.username && dj.email) {
          const username = emailToUsername.get(dj.email.toLowerCase());
          if (username) {
            return { ...dj, username };
          }
        }
        return dj;
      });

      return {
        id,
        slug: data.slug,
        broadcastSlotId: data.broadcastSlotId,
        showName: data.showName,
        djs: enrichedDjs,
        recordingUrl: data.recordingUrl,
        duration: data.duration || 0,
        recordedAt: data.recordedAt,
        createdAt: data.createdAt,
        stationId: data.stationId || 'channel-main',
        showImageUrl: data.showImageUrl,
      };
    });

    // Sort by recordedAt descending (most recent first)
    archives.sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0));

    // Limit to 100
    const limitedArchives = archives.slice(0, 100);

    return NextResponse.json({ archives: limitedArchives });
  } catch (error) {
    console.error('Error fetching archives:', error);
    return NextResponse.json({ error: 'Failed to fetch archives' }, { status: 500 });
  }
}
