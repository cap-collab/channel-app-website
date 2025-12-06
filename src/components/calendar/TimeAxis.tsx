"use client";

import { memo } from "react";

interface TimeAxisProps {
  pixelsPerHour: number;
}

function TimeAxisComponent({ pixelsPerHour }: TimeAxisProps) {
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="sticky left-0 z-10 bg-black w-14 flex-shrink-0 border-r border-gray-900">
      <div className="h-12" /> {/* Header spacer */}
      <div className="relative">
        {hours.map((hour) => (
          <div
            key={hour}
            className="absolute w-full text-right pr-2 text-[11px] text-gray-600 font-light"
            style={{ top: hour * pixelsPerHour - 6 }}
          >
            {hour === 0
              ? "12a"
              : hour < 12
                ? `${hour}a`
                : hour === 12
                  ? "12p"
                  : `${hour - 12}p`}
          </div>
        ))}
      </div>
    </div>
  );
}

export const TimeAxis = memo(TimeAxisComponent);
