export default function TipsInboxScreen() {
  const tippers = [
    { name: "cap", tips: 2, amount: "$2.00" },
    { name: "channelbroadcast", tips: 1, amount: "$1.00" },
    { name: "capsi", tips: 2, amount: "$2.00" },
  ];

  return (
    <div className="h-full bg-[#1a1a1a] flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-800">
        <div className="flex-1" />
        <div className="text-white font-semibold text-lg">Inbox</div>
        <div className="flex-1 flex justify-end">
          <button className="text-blue-400 font-medium text-sm">Done</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 py-3">
        <div className="bg-[#252525] rounded-lg p-1 flex">
          <button className="flex-1 py-2 text-sm text-gray-400 rounded-md">
            Sent
          </button>
          <button className="flex-1 py-2 text-sm text-white bg-[#3a3a3a] rounded-md font-medium">
            Received
          </button>
        </div>
      </div>

      {/* Total */}
      <div className="px-4 py-2 flex items-center justify-between">
        <div>
          <div className="text-gray-500 text-xs">Total Received</div>
          <div className="text-green-400 text-2xl font-bold">$5.00</div>
        </div>
        <div className="text-gray-500 text-sm">5 tips</div>
      </div>

      {/* Tippers list */}
      <div className="flex-1 px-4 py-2 space-y-2">
        {tippers.map((tipper, i) => (
          <div
            key={i}
            className="flex items-center gap-3 py-3"
          >
            {/* Avatar */}
            <div className="w-10 h-10 rounded-full bg-green-900 flex items-center justify-center flex-shrink-0">
              <span className="text-green-400 font-semibold text-lg">
                {tipper.name.charAt(0).toUpperCase()}
              </span>
            </div>

            {/* Info */}
            <div className="flex-1">
              <div className="text-white font-medium">{tipper.name}</div>
              <div className="text-gray-500 text-sm">
                {tipper.tips} tip{tipper.tips > 1 ? "s" : ""} &middot; {tipper.amount}
              </div>
            </div>

            {/* Chevron */}
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}
