"use client";

import { useState, useEffect } from "react";
import { Show } from "@/types";
import { STATIONS } from "@/lib/stations";
import { getCurrentShows } from "@/lib/metadata";

interface NowPlayingGridProps {
  onClose: () => void;
}

export function NowPlayingGrid({ onClose }: NowPlayingGridProps) {
  const [currentShows, setCurrentShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCurrentShows() {
      try {
        const shows = await getCurrentShows();
        setCurrentShows(shows);
      } catch (err) {
        console.error("Failed to load current shows:", err);
      } finally {
        setLoading(false);
      }
    }

    loadCurrentShows();

    // Refresh every minute
    const interval = setInterval(loadCurrentShows, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black overflow-auto">
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-xl font-medium text-white">Live Now</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-600 hover:text-white transition-colors"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-2 border-gray-800 border-t-white rounded-full animate-spin" />
          </div>
        ) : currentShows.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-500">No shows are currently live.</p>
            <p className="text-gray-700 mt-2 text-sm">Check back later!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {STATIONS.map((station) => {
              const show = currentShows.find((s) => s.stationId === station.id);

              return (
                <div
                  key={station.id}
                  className="border border-gray-900 rounded-lg overflow-hidden"
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: station.accentColor }}
                        />
                        <span className="text-xs text-gray-500">
                          {station.name}
                        </span>
                      </div>
                      {show && (
                        <span className="flex items-center gap-1.5 text-[10px] text-red-400 uppercase tracking-wider">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                          Live
                        </span>
                      )}
                    </div>

                    {show ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-white font-medium">{show.name}</h3>
                          {show.dj && (
                            <p className="text-gray-600 text-sm">{show.dj}</p>
                          )}
                        </div>
                        <a
                          href={station.websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
                        >
                          Listen
                        </a>
                      </div>
                    ) : (
                      <p className="text-gray-700 text-sm">
                        No scheduled show
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
