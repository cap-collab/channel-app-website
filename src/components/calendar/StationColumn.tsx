"use client";

import { memo } from "react";
import { Show, Station } from "@/types";
import { ShowBlock } from "./ShowBlock";

interface StationColumnProps {
  station: Station;
  shows: Show[];
  pixelsPerHour: number;
  selectedDate: Date;
  searchQuery?: string;
  isLast?: boolean;
}

function StationColumnComponent({
  station,
  shows,
  pixelsPerHour,
  selectedDate,
  searchQuery = "",
  isLast = false,
}: StationColumnProps) {
  // Day boundaries
  const dayStart = new Date(selectedDate);
  dayStart.setHours(0, 0, 0, 0);

  const dayEnd = new Date(selectedDate);
  dayEnd.setHours(23, 59, 59, 999);

  // Filter shows for this day
  const dayShows = shows.filter((show) => {
    const showStart = new Date(show.startTime);
    const showEnd = new Date(show.endTime);
    return showStart < dayEnd && showEnd > dayStart;
  });

  // Check if a show matches the search query
  const matchesSearch = (show: Show) => {
    if (!searchQuery) return false;
    const query = searchQuery.toLowerCase();
    return (
      show.name.toLowerCase().includes(query) ||
      show.dj?.toLowerCase().includes(query)
    );
  };

  const totalHeight = 24 * pixelsPerHour;

  return (
    <div
      className={`flex-shrink-0 w-44 ${!isLast ? "border-r border-gray-800/50" : ""}`}
    >
      {/* Station header - minimal with accent underline */}
      <div className="h-12 flex flex-col justify-center px-3 sticky top-0 z-10 bg-black">
        <span className="font-medium text-white text-sm truncate">
          {station.name}
        </span>
        <div
          className="h-[2px] w-8 mt-1 rounded-full"
          style={{ backgroundColor: station.accentColor }}
        />
      </div>

      {/* Timeline */}
      <div className="relative" style={{ height: totalHeight }}>
        {/* Hour grid lines - very subtle */}
        {Array.from({ length: 24 }, (_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-gray-900"
            style={{ top: i * pixelsPerHour }}
          />
        ))}

        {/* Shows */}
        {dayShows.map((show) => (
          <ShowBlock
            key={show.id}
            show={show}
            pixelsPerHour={pixelsPerHour}
            accentColor={station.accentColor}
            dayStart={dayStart}
            stationName={station.name}
            stationUrl={station.websiteUrl}
            isHighlighted={matchesSearch(show)}
          />
        ))}
      </div>
    </div>
  );
}

export const StationColumn = memo(StationColumnComponent);
