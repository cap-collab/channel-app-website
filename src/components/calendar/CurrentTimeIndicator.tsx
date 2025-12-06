"use client";

import { useEffect, useState, memo } from "react";

interface CurrentTimeIndicatorProps {
  pixelsPerHour: number;
}

function CurrentTimeIndicatorComponent({
  pixelsPerHour,
}: CurrentTimeIndicatorProps) {
  const [position, setPosition] = useState<number | null>(null);

  useEffect(() => {
    const updatePosition = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const totalMinutes = hours * 60 + minutes;
      setPosition((totalMinutes / 60) * pixelsPerHour);
    };

    updatePosition();
    const interval = setInterval(updatePosition, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [pixelsPerHour]);

  if (position === null) return null;

  return (
    <div
      className="absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top: position }}
    >
      <div className="flex items-center">
        <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
        <div className="flex-1 h-[2px] bg-red-500" />
      </div>
    </div>
  );
}

export const CurrentTimeIndicator = memo(CurrentTimeIndicatorComponent);
