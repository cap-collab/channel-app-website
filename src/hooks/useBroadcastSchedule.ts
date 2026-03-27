'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getFirestore, collection, query, where, orderBy, onSnapshot, Timestamp, getDocs, limit } from 'firebase/firestore';
import { getApps, initializeApp } from 'firebase/app';
import { BroadcastSlotSerialized } from '@/types/broadcast';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getFirebaseApp() {
  if (getApps().length === 0) {
    return initializeApp(firebaseConfig);
  }
  return getApps()[0];
}

interface UseBroadcastScheduleReturn {
  shows: BroadcastSlotSerialized[];
  loading: boolean;
  error: string | null;
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
}

export function useBroadcastSchedule(options?: { jumpToEarliestShow?: boolean }): UseBroadcastScheduleReturn {
  const [shows, setShows] = useState<BroadcastSlotSerialized[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  });
  const hasJumped = useRef(false);

  // Get start and end of selected date
  const getDateRange = useCallback((date: Date) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, []);

  useEffect(() => {
    const app = getFirebaseApp();
    const db = getFirestore(app);

    const { start, end } = getDateRange(selectedDate);

    const slotsRef = collection(db, 'broadcast-slots');
    // Fetch shows that OVERLAP with the selected day
    // A show overlaps if: startTime < dayEnd AND endTime > dayStart
    // Firestore limitation: we query by endTime > dayStart, then filter client-side
    const q = query(
      slotsRef,
      where('endTime', '>', Timestamp.fromDate(start)),
      orderBy('endTime', 'asc')
    );

    setLoading(true);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const slots: BroadcastSlotSerialized[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          slots.push({
            id: doc.id,
            stationId: data.stationId || 'broadcast',
            showName: data.showName || 'Broadcast',
            djName: data.djName,
            djUserId: data.djUserId,
            djEmail: data.djEmail,
            djSlots: data.djSlots,
            startTime: (data.startTime as Timestamp).toMillis(),
            endTime: (data.endTime as Timestamp).toMillis(),
            broadcastToken: data.broadcastToken,
            tokenExpiresAt: (data.tokenExpiresAt as Timestamp).toMillis(),
            createdAt: (data.createdAt as Timestamp).toMillis(),
            createdBy: data.createdBy,
            status: data.status,
            broadcastType: data.broadcastType,
            liveDjUserId: data.liveDjUserId,
            liveDjUsername: data.liveDjUsername,
            liveDjBio: data.liveDjBio,
            liveDjPhotoUrl: data.liveDjPhotoUrl,
            showPromoText: data.showPromoText,
            showPromoHyperlink: data.showPromoHyperlink,
            showImageUrl: data.showImageUrl,
            // Restream fields
            archiveId: data.archiveId,
            archiveRecordingUrl: data.archiveRecordingUrl,
            archiveDuration: data.archiveDuration,
            restreamDjs: data.restreamDjs,
          });
        });
        // Filter to only shows that overlap with selected day
        // (endTime > dayStart is already enforced by query)
        // Now filter: startTime < dayEnd (show must start before day ends)
        const endTime = end.getTime();
        const filteredSlots = slots.filter(slot => slot.startTime < endTime);
        setShows(filteredSlots);
        setLoading(false);
        setError(null);

        // On first load with jumpToEarliestShow, if no shows today, jump to earliest upcoming show
        if (options?.jumpToEarliestShow && !hasJumped.current && filteredSlots.length === 0) {
          hasJumped.current = true;
          const now = new Date();
          const slotsCol = collection(db, 'broadcast-slots');
          const futureQuery = query(
            slotsCol,
            where('startTime', '>', Timestamp.fromDate(now)),
            orderBy('startTime', 'asc'),
            limit(1)
          );
          getDocs(futureQuery).then((snap) => {
            if (!snap.empty) {
              const earliest = (snap.docs[0].data().startTime as Timestamp).toDate();
              const jumpDate = new Date(earliest);
              jumpDate.setHours(0, 0, 0, 0);
              setSelectedDate(jumpDate);
            }
          }).catch(() => {});
        } else if (filteredSlots.length > 0) {
          hasJumped.current = true;
        }
      },
      (err) => {
        console.error('Schedule subscription error:', err);
        setError('Failed to load schedule');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [selectedDate, getDateRange]);

  return {
    shows,
    loading,
    error,
    selectedDate,
    setSelectedDate,
  };
}
