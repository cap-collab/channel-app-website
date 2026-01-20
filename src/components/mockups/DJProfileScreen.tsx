export default function DJProfileScreen() {
  const genres = ["house", "dub", "ambiant", "d&b", "jungle", "electronic", "bass"];

  return (
    <div className="h-full bg-[#1a1a1a] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="text-[#E91E63] font-bold text-sm tracking-wider">CHANNEL</div>
        <button className="text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Profile section */}
      <div className="flex flex-col items-center px-4 pb-3">
        {/* Avatar with gradient border */}
        <div className="w-20 h-20 rounded-full p-1 bg-gradient-to-br from-pink-500 via-purple-500 to-blue-500 mb-3">
          <div className="w-full h-full rounded-full bg-[#2a2a2a] flex items-center justify-center overflow-hidden">
            <div className="w-full h-full bg-gradient-to-b from-pink-400/30 to-transparent" />
          </div>
        </div>

        {/* Name */}
        <h2 className="text-white font-bold text-lg mb-2">DJ cap</h2>

        {/* Action buttons */}
        <div className="flex gap-2 mb-2">
          <button className="bg-white text-black px-4 py-1.5 rounded-full text-xs font-medium">
            Add to watchlist
          </button>
          <button className="bg-white text-black px-4 py-1.5 rounded-full text-xs font-medium">
            Tip
          </button>
        </div>

        {/* Description */}
        <p className="text-gray-500 text-[10px] text-center mb-2 px-2">
          Receive emails when this DJ is adding a new event or playing live on any stations
        </p>

        {/* Location */}
        <div className="text-gray-300 text-xs mb-2">Los Angeles</div>

        {/* Genre tags */}
        <div className="flex flex-wrap justify-center gap-1 mb-2">
          {genres.slice(0, 5).map((genre, i) => (
            <span
              key={i}
              className="bg-[#2a2a2a] text-gray-400 px-2 py-0.5 rounded-full text-[10px]"
            >
              {genre}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-1 mb-2">
          {genres.slice(5).map((genre, i) => (
            <span
              key={i}
              className="bg-[#2a2a2a] text-gray-400 px-2 py-0.5 rounded-full text-[10px]"
            >
              {genre}
            </span>
          ))}
        </div>

        {/* Bio */}
        <p className="text-gray-400 text-[10px] text-center mb-2">
          Music lover, communities-first, founder of Channel
        </p>

        {/* Link button */}
        <button className="bg-gradient-to-r from-pink-500 to-pink-400 text-white px-4 py-1.5 rounded-full text-[10px] font-medium flex items-center gap-1 mb-2">
          New DJ platform is out
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>

        {/* Social icons */}
        <div className="flex gap-4 text-gray-500 mb-3">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073z" />
          </svg>
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
          </svg>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
      </div>

      {/* Upcoming shows section */}
      <div className="px-4">
        <div className="text-gray-500 text-[10px] font-medium tracking-wider mb-2">UPCOMING SHOWS</div>
        <div className="bg-[#252525] rounded-lg p-3 border-l-4 border-yellow-600 flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-400 to-teal-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-white font-medium text-sm">Morning sesh</div>
            <div className="text-gray-500 text-[10px]">Sat, Jan 24, 11:00 AM - 12:00 PM</div>
            <div className="text-gray-600 text-[10px]">Channel Broadcast</div>
          </div>
          <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </div>
      </div>
    </div>
  );
}
