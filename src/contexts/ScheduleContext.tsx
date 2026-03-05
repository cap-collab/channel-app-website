"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
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

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [shows, setShows] = useState<Show[]>([]);
  const [irlShows, setIrlShows] = useState<IRLShowData[]>([]);
  const [curatorRecs, setCuratorRecs] = useState<CuratorRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSchedule = useCallback(() => {
    setLoading(true);
    fetch("/api/schedule")
      .then((res) => res.json())
      .then((data) => {
        setShows(data.shows || []);
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
