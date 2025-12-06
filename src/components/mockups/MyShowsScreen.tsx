export default function MyShowsScreen() {
  return (
    <div className="h-full bg-black px-4 pt-2">
      {/* Header */}
      <div className="text-center mb-4">
        <h2 className="text-white font-semibold text-lg">My Shows</h2>
      </div>

      {/* Search bar */}
      <div className="bg-gray-800 rounded-xl px-4 py-3 flex items-center gap-3 mb-6">
        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="text-gray-500 text-sm">Search DJ or show...</span>
      </div>

      {/* Live Now */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span className="text-gray-500 text-xs font-medium tracking-wider">LIVE NOW</span>
        </div>
        <div className="bg-gray-900/60 rounded-xl p-4 border-l-4 border-pink-500">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-3 w-16 bg-gray-600 rounded blur-[5px] mb-2" />
              <div className="h-4 w-24 bg-gray-500 rounded blur-[5px] mb-1" />
              <div className="h-2 w-32 bg-gray-700 rounded blur-[5px]" />
            </div>
            <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Coming Up Today */}
      <div className="mb-5">
        <span className="text-gray-500 text-xs font-medium tracking-wider mb-3 block">COMING UP TODAY</span>
        <div className="bg-gray-900/60 rounded-xl p-4 border-l-4 border-cyan-500">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-3 w-14 bg-gray-600 rounded blur-[5px] mb-2" />
              <div className="h-4 w-20 bg-gray-500 rounded blur-[5px] mb-1" />
              <div className="h-2 w-28 bg-gray-700 rounded blur-[5px]" />
            </div>
            <svg className="w-5 h-5 text-cyan-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Tomorrow */}
      <div className="mb-5">
        <span className="text-gray-500 text-xs font-medium tracking-wider mb-3 block">TOMORROW</span>
        <div className="bg-gray-900/60 rounded-xl p-4 border-l-4 border-lime-400">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-3 w-20 bg-gray-600 rounded blur-[5px] mb-2" />
              <div className="h-4 w-16 bg-gray-500 rounded blur-[5px] mb-1" />
              <div className="h-2 w-32 bg-gray-700 rounded blur-[5px]" />
            </div>
            <svg className="w-5 h-5 text-lime-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Watch List */}
      <div>
        <span className="text-gray-500 text-xs font-medium tracking-wider mb-1 block">WATCH LIST</span>
        <span className="text-gray-600 text-xs mb-3 block">Shows you&apos;ve starred but aren&apos;t currently scheduled</span>
        <div className="bg-gray-900/60 rounded-xl p-4 border-l-4 border-gray-600">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-3 w-16 bg-gray-600 rounded blur-[5px] mb-2" />
              <div className="h-4 w-20 bg-gray-500 rounded blur-[5px]" />
            </div>
            <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          </div>
        </div>
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
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 1.74.5 3.37 1.41 4.84.95 1.54 2.2 2.86 3.16 4.4.47.75.81 1.45 1.17 2.26.26.55.47 1.5 1.26 1.5s1-1 1.26-1.5c.36-.81.7-1.51 1.17-2.26.96-1.53 2.21-2.85 3.16-4.4C18.5 12.37 19 10.74 19 9c0-3.87-3.13-7-7-7zm0 9.75a2.5 2.5 0 010-5 2.5 2.5 0 010 5z" />
          </svg>
        </div>
      </div>
    </div>
  );
}
