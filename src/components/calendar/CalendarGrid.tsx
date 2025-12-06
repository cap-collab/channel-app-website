"use client";

import { useState, useEffect, useRef } from "react";
import { Show } from "@/types";
import { STATIONS } from "@/lib/stations";
import { getAllShows } from "@/lib/metadata";
import { TimeAxis } from "./TimeAxis";
import { StationColumn } from "./StationColumn";

const PIXELS_PER_HOUR = 80;

interface CalendarGridProps {
  searchQuery?: string;
}

export function CalendarGrid({ searchQuery = "" }: CalendarGridProps) {
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  useEffect(() => {
    async function loadShows() {
      try {
        setLoading(true);
        const allShows = await getAllShows();
        setShows(allShows);
        setError(null);
      } catch (err) {
        console.error("Failed to load shows:", err);
        setError("Failed to load schedule. Please try again.");
      } finally {
        setLoading(false);
      }
    }

    loadShows();
  }, []);

  // Scroll to current time on initial load
  useEffect(() => {
    if (!loading && !hasScrolledRef.current && scrollContainerRef.current) {
      const now = new Date();
      const today = new Date();
      const isToday =
        selectedDate.getFullYear() === today.getFullYear() &&
        selectedDate.getMonth() === today.getMonth() &&
        selectedDate.getDate() === today.getDate();

      if (isToday) {
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const scrollPosition =
          (currentHour + currentMinute / 60) * PIXELS_PER_HOUR - 100;
        scrollContainerRef.current.scrollTop = Math.max(0, scrollPosition);
        hasScrolledRef.current = true;
      }
    }
  }, [loading, selectedDate]);

  // Get shows for each station
  const getShowsForStation = (stationId: string): Show[] => {
    return shows.filter((show) => show.stationId === stationId);
  };

  // Date navigation
  const goToDate = (offset: number) => {
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + offset);
    setSelectedDate(newDate);
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  // Format date for display
  const formatDate = (date: Date) => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return "Tomorrow";
    } else {
      return date.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-[3px] border-gray-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-white text-black px-6 py-2 rounded-lg font-medium hover:bg-gray-200 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Date navigation */}
      <div className="flex items-center justify-center gap-4 py-4 bg-black sticky top-0 z-30 border-b border-gray-800">
        <button
          onClick={() => goToDate(-1)}
          className="p-2 text-gray-400 hover:text-white transition-colors"
          aria-label="Previous day"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>

        <button
          onClick={goToToday}
          className="text-lg font-semibold text-white hover:text-gray-300 transition-colors min-w-[150px]"
        >
          {formatDate(selectedDate)}
        </button>

        <button
          onClick={() => goToDate(1)}
          className="p-2 text-gray-400 hover:text-white transition-colors"
          aria-label="Next day"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      {/* Calendar grid */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        <div className="flex min-w-max relative">
          {/* Time axis */}
          <TimeAxis pixelsPerHour={PIXELS_PER_HOUR} />

          {/* Station columns */}
          {STATIONS.map((station, index) => (
            <StationColumn
              key={station.id}
              station={station}
              shows={getShowsForStation(station.id)}
              pixelsPerHour={PIXELS_PER_HOUR}
              selectedDate={selectedDate}
              searchQuery={searchQuery}
              isLast={index === STATIONS.length - 1}
            />
          ))}

          {/* Global current time indicator */}
          <CurrentTimeLine
            pixelsPerHour={PIXELS_PER_HOUR}
            selectedDate={selectedDate}
          />
        </div>
      </div>
    </div>
  );
}

// Global current time line that spans all columns
function CurrentTimeLine({
  pixelsPerHour,
  selectedDate,
}: {
  pixelsPerHour: number;
  selectedDate: Date;
}) {
  const [position, setPosition] = useState<number | null>(null);

  const today = new Date();
  const isToday =
    selectedDate.getFullYear() === today.getFullYear() &&
    selectedDate.getMonth() === today.getMonth() &&
    selectedDate.getDate() === today.getDate();

  useEffect(() => {
    if (!isToday) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const totalMinutes = hours * 60 + minutes;
      setPosition((totalMinutes / 60) * pixelsPerHour + 48); // +48 for header height
    };

    updatePosition();
    const interval = setInterval(updatePosition, 60000);
    return () => clearInterval(interval);
  }, [pixelsPerHour, isToday]);

  if (position === null) return null;

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
      style={{ top: position }}
    >
      <div className="w-14 flex justify-end pr-1">
        <div className="w-3 h-3 rounded-full bg-red-500" />
      </div>
      <div className="flex-1 h-[2px] bg-red-500" />
    </div>
  );
}
