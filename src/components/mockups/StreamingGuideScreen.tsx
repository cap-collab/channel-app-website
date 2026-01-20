export default function StreamingGuideScreen() {
  return (
    <div className="h-full bg-gradient-to-b from-[#2a1a2a] via-[#1a1a2a] to-[#1a1a1a] flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex-1" />
        <div className="text-white font-semibold text-lg">My Shows</div>
        <div className="flex-1 flex justify-end">
          <button className="text-blue-400 font-medium text-sm">Done</button>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-4 py-2">
        <div className="bg-[#252525]/80 rounded-xl px-4 py-3 flex items-center gap-3">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-gray-500 text-sm">Search DJ or show...</span>
        </div>
      </div>

      {/* Live Now Section */}
      <div className="px-4 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 bg-red-500 rounded-full" />
          <span className="text-gray-400 text-xs font-medium tracking-wider">LIVE NOW</span>
        </div>
        <div className="bg-[#252525]/60 rounded-xl p-3 border-l-4 border-pink-500">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="text-gray-400 text-[10px] font-medium tracking-wider mb-0.5">NEWTOWN RADIO</div>
              <div className="text-white font-semibold text-sm mb-0.5">YOUR FAVORITE DJ&apos;S FAVORITE DJ</div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-xs">Today at 3:00 PM</span>
                <span className="bg-pink-500 text-white text-[9px] px-2 py-0.5 rounded font-medium">biweekly</span>
              </div>
            </div>
            <svg className="w-4 h-4 text-pink-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Coming Up Section */}
      <div className="px-4 pt-4">
        <span className="text-gray-400 text-xs font-medium tracking-wider">COMING UP</span>
        <div className="space-y-2 mt-2">
          {/* Test Radio */}
          <div className="bg-[#252525]/60 rounded-xl p-3 border-l-4 border-lime-400">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="text-gray-400 text-[10px] font-medium tracking-wider mb-0.5">TEST RADIO</div>
                <div className="text-white font-semibold text-sm mb-0.5">MixRaw</div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-xs">Tomorrow at 9:00 AM</span>
                  <span className="bg-gray-600 text-white text-[9px] px-2 py-0.5 rounded font-medium">monthly</span>
                </div>
              </div>
              <svg className="w-4 h-4 text-lime-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
              </svg>
            </div>
          </div>

          {/* Dublab */}
          <div className="bg-[#252525]/60 rounded-xl p-3 border-l-4 border-cyan-500">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="text-gray-400 text-[10px] font-medium tracking-wider mb-0.5">DUBLAB</div>
                <div className="text-white font-semibold text-sm mb-0.5 truncate">Daddy Differently and Dirty Dave - Things...</div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-xs">Fri at 10:00 AM</span>
                  <span className="bg-cyan-500 text-white text-[9px] px-2 py-0.5 rounded font-medium">weekly</span>
                </div>
              </div>
              <svg className="w-4 h-4 text-cyan-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Returning Soon Section */}
      <div className="px-4 pt-4">
        <span className="text-gray-400 text-xs font-medium tracking-wider">RETURNING SOON</span>
        <p className="text-gray-600 text-[10px] mt-0.5 mb-2">These shows usually come back, we&apos;ll ping you</p>
        <div className="bg-[#252525]/60 rounded-xl p-3 border-l-4 border-blue-500">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="text-gray-400 text-[10px] font-medium tracking-wider">RINSE FM</div>
            </div>
            <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
