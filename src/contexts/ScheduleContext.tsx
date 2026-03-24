"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { collection, query, where, orderBy, getDocs, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Show, IRLShowData, CuratorRec } from "@/types";

interface ScheduleContextType {
  shows: Show[];
  irlShows: IRLShowData[];
  curatorRecs: CuratorRec[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const ScheduleContext = createContext<ScheduleContextType>({
  shows: [],
  irlShows: [],
  curatorRecs: [],
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
    futureCutoff.setDate(futureCutoff.getDate() + 5);

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

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [shows, setShows] = useState<Show[]>([]);
  const [irlShows, setIrlShows] = useState<IRLShowData[]>([]);
  const [curatorRecs, setCuratorRecs] = useState<CuratorRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSchedule = useCallback(() => {
    setLoading(true);

    // Fetch schedule API and broadcast shows in parallel
    Promise.all([
      fetch("/api/schedule").then((res) => res.json()),
      fetchBroadcastShowsClient(),
    ])
      .then(([data, clientBroadcasts]) => {
        const apiShows: Show[] = data.shows || [];

        // Merge: use client-fetched broadcasts to fill in any missing from API
        const apiIds = new Set(apiShows.map((s: Show) => s.id));
        const missingBroadcasts = clientBroadcasts.filter((s) => !apiIds.has(s.id));
        setShows([...apiShows, ...missingBroadcasts]);

        setIrlShows(data.irlShows || []);
        setCuratorRecs(data.curatorRecs || []);
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
    <ScheduleContext.Provider value={{ shows, irlShows, curatorRecs, loading, error, refetch: fetchSchedule }}>
      {children}
    </ScheduleContext.Provider>
  );
}

export function useSchedule() {
  return useContext(ScheduleContext);
}
