"use client";

import { memo } from "react";

interface TimeAxisProps {
  pixelsPerHour: number;
  startHour: number;
  position?: "left" | "right";
  className?: string;
}

function TimeAxisComponent({ pixelsPerHour, startHour, position = "left", className = "" }: TimeAxisProps) {
  // Only show hours from startHour to 24
  const hours = Array.from({ length: 24 - startHour }, (_, i) => startHour + i);

  const formatHour = (hour: number) => {
    if (hour === 0) return "12a";
    if (hour < 12) return `${hour}a`;
    if (hour === 12) return "12p";
    return `${hour - 12}p`;
  };

  const isRight = position === "right";

  return (
    <div className={`${isRight ? "sticky right-0" : "sticky left-0"} z-10 bg-black w-14 flex-shrink-0 ${isRight ? "border-l" : "border-r"} border-gray-900 ${className}`}>
      <div className="h-12" /> {/* Header spacer */}
      <div className="relative">
        {hours.map((hour, index) => (
          <div
            key={hour}
            className={`absolute w-full ${isRight ? "text-left pl-2" : "text-right pr-2"} text-[11px] text-gray-600 font-light`}
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
