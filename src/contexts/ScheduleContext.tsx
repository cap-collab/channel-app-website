"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { collection, query, where, orderBy, getDocs, doc, getDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Show, IRLShowData, CuratorRec, DJProfile } from "@/types";

interface ScheduleContextType {
  shows: Show[];
  irlShows: IRLShowData[];
  curatorRecs: CuratorRec[];
  djProfiles: DJProfile[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const ScheduleContext = createContext<ScheduleContextType>({
  shows: [],
  irlShows: [],
  curatorRecs: [],
  djProfiles: [],
  loading: true,
  error: null,
  refetch: () => {},
});

// Fetch broadcast shows directly from Firebase client SDK
// The /api/schedule runs server-side where the client SDK may not work,
// so broadcast shows can be missing from the API response
async function fetchBroadcastShowsClient(): Promise<Show[]> {
  if (!db) return [];

  try {
    const now = new Date();
    const pastCutoff = new Date(now);
    pastCutoff.setDate(pastCutoff.getDate() - 1);
    pastCutoff.setHours(0, 0, 0, 0);
    const futureCutoff = new Date(now);
    futureCutoff.setDate(futureCutoff.getDate() + 14);

    const q = query(
      collection(db, "broadcast-slots"),
      where("startTime", ">=", Timestamp.fromDate(pastCutoff)),
      where("startTime", "<", Timestamp.fromDate(futureCutoff)),
      orderBy("startTime")
    );

    const snapshot = await getDocs(q);
    const shows: Show[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.status === "cancelled" || data.broadcastType === "recording") return;

      const startTime = (data.startTime as Timestamp).toDate().toISOString();
      const endTime = (data.endTime as Timestamp).toDate().toISOString();
      const djSlots = data.djSlots as Array<{
        djName?: string; djUsername?: string; djUserId?: string;
        djEmail?: string; djPhotoUrl?: string; djBio?: string;
        djPromoText?: string; djPromoHyperlink?: string;
        startTime: number; endTime: number; liveDjUserId?: string;
      }> | undefined;

      if (djSlots && djSlots.length > 0) {
        for (const slot of djSlots) {
          shows.push({
            id: `broadcast-${doc.id}-${slot.startTime}`,
            name: data.showName as string,
            dj: slot.djName,
            startTime: new Date(slot.startTime).toISOString(),
            endTime: new Date(slot.endTime).toISOString(),
            stationId: "broadcast",
            type: data.status === "live" ? "live" : undefined,
            djUserId: slot.djUserId || slot.liveDjUserId || data.djUserId,
            djEmail: slot.djEmail || data.djEmail,
            djUsername: slot.djUsername || data.djUsername,
            broadcastSlotId: doc.id,
            djBio: slot.djBio,
            djPhotoUrl: slot.djPhotoUrl,
            promoText: slot.djPromoText || data.showPromoText,
            promoUrl: slot.djPromoHyperlink || data.showPromoHyperlink,
            imageUrl: data.showImageUrl,
          });
        }
      } else {
        shows.push({
          id: `broadcast-${doc.id}`,
          name: data.showName as string,
          dj: data.djName,
          startTime,
          endTime,
          stationId: "broadcast",
          type: data.status === "live" ? "live" : undefined,
          djUserId: data.liveDjUserId || data.djUserId,
          djEmail: data.djEmail,
          djUsername: data.djUsername,
          broadcastSlotId: doc.id,
          djBio: data.liveDjBio,
          djPhotoUrl: data.liveDjPhotoUrl,
          promoText: data.showPromoText,
          promoUrl: data.showPromoHyperlink,
          imageUrl: data.showImageUrl,
        });
      }
    });

    return shows;
  } catch (error) {
    console.error("[ScheduleContext] Error fetching broadcast shows:", error);
    return [];
  }
}

// Enrich broadcast shows with DJ profile data (runs on merged shows)
async function enrichBroadcastShowsClient(shows: Show[]): Promise<Show[]> {
  if (!db) return shows;
  const broadcastShows = shows.filter((s) => s.stationId === "broadcast" && !s.djPhotoUrl);
  if (broadcastShows.length === 0) return shows;

  type DJProfile = { photoUrl?: string; username?: string; userId?: string; location?: string; genres?: string[]; bio?: string };
  const profileByUserId = new Map<string, DJProfile>();
  const profileByName = new Map<string, DJProfile>();

  // Helper to build profile from user doc
  const buildProfile = (userDoc: { id: string; data: () => Record<string, unknown> | undefined }): DJProfile | null => {
    const data = userDoc.data();
    if (!data) return null;
    const djProfile = data.djProfile as Record<string, unknown> | undefined;
    return {
      photoUrl: djProfile?.photoUrl as string | undefined,
      username: (data.chatUsername as string)?.replace(/\s+/g, "").toLowerCase(),
      userId: userDoc.id,
      location: djProfile?.location as string | undefined,
      genres: djProfile?.genres as string[] | undefined,
      bio: djProfile?.bio as string | undefined,
    };
  };

  // 1. Lookup by djUserId (direct doc fetch)
  const userIdsToFetch = new Set<string>();
  for (const show of broadcastShows) {
    if (show.djUserId) userIdsToFetch.add(show.djUserId);
  }
  if (userIdsToFetch.size > 0) {
    await Promise.all(
      Array.from(userIdsToFetch).map(async (userId) => {
        try {
          const userDoc = await getDoc(doc(db!, "users", userId));
          if (userDoc.exists()) {
            const profile = buildProfile({ id: userDoc.id, data: () => userDoc.data() });
            if (profile) {
              profileByUserId.set(userId, profile);
              if (profile.username) profileByName.set(profile.username, profile);
            }
          }
        } catch (err) {
          console.error(`[ScheduleContext] Failed to fetch DJ profile for userId ${userId}:`, err);
        }
      })
    );
  }

  // 2. Lookup remaining by DJ name using chatUsernameNormalized doc ID convention
  // Since querying by chatUsername may not be allowed, fetch by normalized username as doc lookup
  const namesToFetch: string[] = [];
  for (const show of broadcastShows) {
    if (!show.djUserId && show.dj) {
      const normalized = show.dj.toLowerCase();
      if (!profileByName.has(normalized)) namesToFetch.push(show.dj);
    }
  }
  // Use role-based query to find DJs by name (parallel lookups)
  if (namesToFetch.length > 0) {
    await Promise.all(
      namesToFetch.map(async (djName) => {
        try {
          const q = query(
            collection(db!, "users"),
            where("role", "in", ["dj", "broadcaster", "admin"]),
            where("chatUsername", "==", djName)
          );
          const snapshot = await getDocs(q);
          snapshot.forEach((userDoc) => {
            const profile = buildProfile({ id: userDoc.id, data: () => userDoc.data() });
            if (profile) {
              if (profile.username) profileByName.set(profile.username, profile);
              profileByUserId.set(userDoc.id, profile);
            }
          });
        } catch (err) {
          console.error(`[ScheduleContext] Failed to fetch DJ profile for name ${djName}:`, err);
        }
      })
    );
  }

  // 3. Lookup remaining in pending-dj-profiles (for DJs who haven't created accounts yet)
  const stillMissing: string[] = [];
  for (const show of broadcastShows) {
    if (!show.djUserId && show.dj) {
      const normalized = show.dj.toLowerCase();
      if (!profileByName.has(normalized)) stillMissing.push(show.dj);
    }
  }
  if (stillMissing.length > 0) {
    await Promise.all(
      stillMissing.map(async (djName) => {
        try {
          const normalized = djName.replace(/[\s-]+/g, "").toLowerCase();
          const q = query(
            collection(db!, "pending-dj-profiles"),
            where("chatUsernameNormalized", "==", normalized)
          );
          const snapshot = await getDocs(q);
          snapshot.forEach((pendingDoc) => {
            const profile = buildProfile({ id: pendingDoc.id, data: () => pendingDoc.data() });
            if (profile) {
              profileByName.set(djName.toLowerCase(), profile);
            }
          });
        } catch (err) {
          console.error(`[ScheduleContext] Failed to fetch pending DJ profile for ${djName}:`, err);
        }
      })
    );
  }

  console.log('[ScheduleContext] Enriched', profileByUserId.size + profileByName.size, 'broadcast DJ profiles');

  // Apply profiles to shows
  for (const show of shows) {
    if (show.stationId !== "broadcast") continue;
    const profile = (show.djUserId && profileByUserId.get(show.djUserId)) ||
                    (show.dj && profileByName.get(show.dj.toLowerCase()));
    if (profile) {
      if (!show.djPhotoUrl && profile.photoUrl) show.djPhotoUrl = profile.photoUrl;
      if (!show.djUsername && profile.username) show.djUsername = profile.username;
      if (!show.djUserId && profile.userId) show.djUserId = profile.userId;
      if (!show.djLocation && profile.location) show.djLocation = profile.location;
      if (!show.djGenres && profile.genres) show.djGenres = profile.genres;
      if (!show.djBio && profile.bio) show.djBio = profile.bio;
      show.isChannelUser = true;
    }
  }

  return shows;
}

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [shows, setShows] = useState<Show[]>([]);
  const [irlShows, setIrlShows] = useState<IRLShowData[]>([]);
  const [curatorRecs, setCuratorRecs] = useState<CuratorRec[]>([]);
  const [djProfiles, setDjProfiles] = useState<DJProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSchedule = useCallback(() => {
    setLoading(true);

    // Fetch schedule API and broadcast shows in parallel
    Promise.all([
      fetch("/api/schedule").then((res) => res.json()),
      fetchBroadcastShowsClient(),
    ])
      .then(async ([data, clientBroadcasts]) => {
        const apiShows: Show[] = data.shows || [];

        // Merge: use client-fetched broadcasts to fill in any missing from API
        const apiIds = new Set(apiShows.map((s: Show) => s.id));
        const missingBroadcasts = clientBroadcasts.filter((s) => !apiIds.has(s.id));
        const mergedShows = [...apiShows, ...missingBroadcasts];

        // Enrich broadcast shows with DJ profile data
        const enrichedShows = await enrichBroadcastShowsClient(mergedShows);
        setShows(enrichedShows);

        setIrlShows(data.irlShows || []);
        setCuratorRecs(data.curatorRecs || []);
        setDjProfiles(data.djProfiles || []);
        setError(null);
      })
      .catch((err) => {
        console.error("[ScheduleContext] Error fetching schedule:", err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  return (
    <ScheduleContext.Provider value={{ shows, irlShows, curatorRecs, djProfiles, loading, error, refetch: fetchSchedule }}>
      {children}
    </ScheduleContext.Provider>
  );
}

export function useSchedule() {
  return useContext(ScheduleContext);
}
