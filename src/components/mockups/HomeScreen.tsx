export default function HomeScreen() {
  const stations = [
    { color: "#C3E943", progress: 45 },
    { color: "#FFFFFF", progress: 70 },
    { color: "#00D4FF", progress: 55 },
    { color: "#FF6B35", progress: 30 },
  ];

  return (
    <div className="h-full bg-gradient-to-b from-gray-900/50 to-black p-4 space-y-3">
      {stations.map((station, i) => (
        <div
          key={i}
          className="bg-gray-900/80 rounded-2xl p-4 flex items-center gap-4"
        >
          {/* Logo placeholder - colored square */}
          <div
            className="w-14 h-14 rounded-xl flex-shrink-0"
            style={{ backgroundColor: station.color }}
          />

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Blurred station name */}
            <div className="h-4 w-24 bg-gray-600 rounded blur-[6px] mb-2" />
            {/* Blurred DJ name */}
            <div className="h-3 w-32 bg-gray-700 rounded blur-[6px] mb-3" />
            {/* Progress bar */}
            <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${station.progress}%`,
                  backgroundColor: station.color,
                }}
              />
            </div>
          </div>

          {/* Play button */}
          <button
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: station.color }}
          >
            <svg
              className="w-5 h-5 ml-0.5"
              style={{ color: station.color === "#FFFFFF" ? "#000" : "#000" }}
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      ))}

      {/* BPM badge on last visible card */}
      <div className="flex justify-end -mt-1 pr-2">
        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-full">
          ⫼ 142 BPM
        </span>
      </div>

      {/* Mini player bar at bottom */}
      <div className="absolute bottom-8 left-4 right-4 bg-gradient-to-r from-gray-800/90 to-gray-700/90 rounded-2xl p-3 flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-lg flex-shrink-0"
          style={{ backgroundColor: "#C3E943" }}
        />
        <div className="flex-1">
          <div className="h-3 w-20 bg-gray-600 rounded blur-[5px] mb-1" />
          <div className="h-2 w-14 bg-gray-700 rounded blur-[5px]" />
        </div>
        <div className="flex items-center gap-4 text-gray-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          <svg className="w-6 h-6 text-[#C3E943]" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 1.74.5 3.37 1.41 4.84.95 1.54 2.2 2.86 3.16 4.4.47.75.81 1.45 1.17 2.26.26.55.47 1.5 1.26 1.5s1-1 1.26-1.5c.36-.81.7-1.51 1.17-2.26.96-1.53 2.21-2.85 3.16-4.4C18.5 12.37 19 10.74 19 9c0-3.87-3.13-7-7-7zm0 9.75a2.5 2.5 0 010-5 2.5 2.5 0 010 5z" />
          </svg>
        </div>
      </div>
    </div>
  );
}
