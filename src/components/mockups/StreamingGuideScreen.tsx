export default function StreamingGuideScreen() {
  const stations = [
    { name: "NTS 1", bpm: "140 BPM", show: "5 GATE TEMPLE", color: "#E91E63" },
    { name: "Rinse FM", bpm: "127 BPM", show: "Surusinghe", color: "#8BC34A" },
    { name: "Subtle Radio", bpm: "127 BPM", show: "Bassfreight Sound", color: "#CDDC39" },
    { name: "NTS 2", bpm: "192 BPM", show: "LOS HITTERS", color: "#00BCD4" },
    { name: "Rinse FR", bpm: "136 BPM", show: "Playlist France", color: "#E91E63" },
    { name: "dublab", bpm: "126 BPM", show: "sounds of NOW", color: "#8BC34A" },
  ];

  return (
    <div className="h-full bg-[#1a1a1a] flex flex-col pt-3">
      {/* Station list */}
      <div className="flex-1 overflow-hidden space-y-1 px-2">
        {stations.map((station, i) => (
          <div
            key={i}
            className="bg-[#252525] rounded-lg flex items-stretch overflow-hidden"
          >
            {/* Left color bar */}
            <div
              className="w-1 flex-shrink-0"
              style={{ backgroundColor: station.color }}
            />

            {/* Station info */}
            <div className="flex-1 py-3 px-3 flex items-center justify-between">
              <div className="flex-shrink-0 w-24">
                <div className="text-white font-medium text-sm">{station.name}</div>
                <div className="text-gray-500 text-xs">{station.bpm}</div>
              </div>

              {/* Show info */}
              <div className="flex-1 bg-[#3a3a3a] rounded-lg py-3 px-4 ml-3">
                <div className="text-red-400 text-[10px] font-semibold tracking-wider mb-0.5">LIVE</div>
                <div className="text-white font-medium text-sm truncate">{station.show}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
