"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STATIONS: Record<string, string> = {
  subtle: "Subtle Radio",
  dublab: "dublab",
  "rinse-fm": "Rinse FM",
  "rinse-fr": "Rinse FR",
  "nts-1": "NTS 1",
  "nts-2": "NTS 2",
};

export default function ListenPage({ params }: { params: { station: string } }) {
  const [showDownload, setShowDownload] = useState(false);
  const stationId = params.station;
  const stationName = STATIONS[stationId] || stationId;

  useEffect(() => {
    // Try to open the app
    const appUrl = `channel://station/${stationId}`;
    window.location.href = appUrl;

    // If still here after 1.5 seconds, show download prompt
    const timer = setTimeout(() => {
      setShowDownload(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, [stationId]);

  return (
    <div className="min-h-screen flex justify-center items-center">
      <div className="max-w-[600px] px-5 py-10 text-center">
        {!showDownload ? (
          <div>
            <div className="w-10 h-10 border-[3px] border-gray-700 border-t-white rounded-full animate-spin mx-auto mb-6" />
            <h2 className="text-2xl font-semibold mb-4">Opening Channel...</h2>
            <p className="text-gray-500">Redirecting to {stationName}</p>
          </div>
        ) : (
          <div>
            <h2 className="text-2xl font-semibold mb-4">Get Channel</h2>
            <p className="text-gray-500 mb-6">
              Download the app to listen to {stationName} and chat with fellow listeners.
            </p>
            <Link
              href="/"
              className="inline-block bg-white text-black px-8 py-4 rounded-xl text-lg font-semibold hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(255,255,255,0.15)] transition-all mb-4"
            >
              Download Channel
            </Link>
            <br />
            <br />
            <a
              href={`channel://station/${stationId}`}
              className="text-gray-500 underline text-sm hover:text-white"
            >
              Try opening the app again
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
