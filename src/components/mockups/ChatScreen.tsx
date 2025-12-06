export default function ChatScreen() {
  const messages = [
    {
      user: "splitradix",
      avatar: "🎧",
      avatarBg: "bg-red-600",
      message: "That and getting a shout out.",
      time: "7:53 AM",
      reactions: [{ emoji: "💕", count: 1 }]
    },
    {
      user: "KillCapitalism",
      avatar: "🌅",
      avatarBg: "bg-orange-400",
      message: "Thanks, Margeaux <333 Stay Well!",
      time: "7:53 AM"
    },
    {
      user: "glademaker",
      avatar: "🌱",
      avatarBg: "bg-pink-300",
      message: "I'll have to catch up to the rest of the show, but thanks for the few tunes, lovely!",
      time: "7:56 AM"
    },
    {
      user: "imnatesmith",
      avatar: "😊",
      avatarBg: "bg-blue-500",
      message: "So good Margeaux. Always down for a thought tangent. lol",
      time: "7:57 AM"
    },
  ];

  return (
    <div className="h-full bg-black flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-gray-800/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-white" />
          <div>
            <div className="h-3 w-16 bg-gray-500 rounded blur-[4px] mb-1" />
            <div className="h-2 w-12 bg-gray-600 rounded blur-[4px]" />
          </div>
        </div>
        <button className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        </button>
      </div>

      {/* Chat messages */}
      <div className="flex-1 px-3 py-2 space-y-2 overflow-hidden">
        {messages.map((msg, i) => (
          <div key={i} className="flex gap-2">
            <div className={`w-6 h-6 rounded-full ${msg.avatarBg} flex items-center justify-center text-xs flex-shrink-0`}>
              {msg.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-white font-semibold text-xs blur-[3px]">{msg.user}</span>
                <span className="text-gray-600 text-[10px]">{msg.time}</span>
              </div>
              <p className="text-gray-300 text-xs leading-relaxed">{msg.message}</p>
              {msg.reactions && (
                <div className="flex gap-1 mt-1">
                  {msg.reactions.map((r, j) => (
                    <span key={j} className="bg-gray-800 rounded-full px-1.5 py-0.5 text-[10px]">
                      {r.emoji} {r.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Message input bar */}
      <div className="px-3 py-2 border-t border-gray-800/50">
        <div className="flex items-center gap-2">
          <button className="text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </button>
          <div className="flex-1 bg-gray-900 rounded-full px-3 py-1.5 border border-gray-700">
            <span className="text-gray-500 text-xs">Message</span>
          </div>
          <button className="text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
