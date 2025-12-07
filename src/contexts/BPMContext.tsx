"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface AudioInfo {
  bpm: number | null;
  type: string; // "bpm", "talk", "ambient", "other"
  genre: string | null;
}

interface BPMContextType {
  stationBPM: Record<string, AudioInfo>;
  loading: boolean;
}

const BPMContext = createContext<BPMContextType>({
  stationBPM: {},
  loading: true,
});

const BPM_API_URL = "https://vibrant-consideration-production.up.railway.app/api/bpm";

interface BPMResponse {
  stations: Record<string, AudioInfo>;
  lastUpdated: string | null;
}

export function BPMProvider({ children }: { children: ReactNode }) {
  const [stationBPM, setStationBPM] = useState<Record<string, AudioInfo>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBPM() {
      try {
        const response = await fetch(BPM_API_URL);
        if (!response.ok) throw new Error("Failed to fetch BPM");
        const data: BPMResponse = await response.json();
        setStationBPM(data.stations);
      } catch (error) {
        console.error("BPM fetch error:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchBPM();

    // Refresh every 60 seconds
    const interval = setInterval(fetchBPM, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <BPMContext.Provider value={{ stationBPM, loading }}>
      {children}
    </BPMContext.Provider>
  );
}

export function useBPM() {
  return useContext(BPMContext);
}
