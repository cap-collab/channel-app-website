"use client";

import { memo } from "react";

interface TimeAxisProps {
  pixelsPerHour: number;
  startHour: number;
}

function TimeAxisComponent({ pixelsPerHour, startHour }: TimeAxisProps) {
  // Only show hours from startHour to 24
  const hours = Array.from({ length: 24 - startHour }, (_, i) => startHour + i);

  const formatHour = (hour: number) => {
    if (hour === 0) return "12a";
    if (hour < 12) return `${hour}a`;
    if (hour === 12) return "12p";
    return `${hour - 12}p`;
  };

  return (
    <div className="sticky left-0 z-10 bg-black w-14 flex-shrink-0 border-r border-gray-900">
      <div className="h-12" /> {/* Header spacer */}
      <div className="relative">
        {hours.map((hour, index) => (
          <div
            key={hour}
            className="absolute w-full text-right pr-2 text-[11px] text-gray-600 font-light"
            style={{ top: index * pixelsPerHour - 6 }}
          >
            {formatHour(hour)}
          </div>
        ))}
      </div>
    </div>
  );
}

export const TimeAxis = memo(TimeAxisComponent);
