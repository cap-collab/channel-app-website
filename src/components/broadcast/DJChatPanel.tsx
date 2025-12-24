'use client';

import { useState, useRef, useEffect } from 'react';
import { useDJChat } from '@/hooks/useDJChat';
import { ChatMessageSerialized } from '@/types/broadcast';

interface DJChatPanelProps {
  broadcastToken: string;
  slotId: string;
  djUsername: string;
  userId?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  initialPromoSubmitted?: boolean;
}

// Vinyl record icon component
function VinylIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.9"/>
      <circle cx="12" cy="12" r="4" fill="currentColor"/>
      <circle cx="12" cy="12" r="1.5" fill="white"/>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.5"/>
      <circle cx="12" cy="12" r="7" fill="none" stroke="white" strokeWidth="0.3" opacity="0.3"/>
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="white" strokeWidth="0.3" opacity="0.3"/>
    </svg>
  );
}

function ChatMessage({ message, isOwnMessage }: { message: ChatMessageSerialized; isOwnMessage: boolean }) {
  const timeAgo = formatTimeAgo(message.timestamp);

  if (message.messageType === 'promo') {
    return (
      <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-4 my-2">
        <div className="flex items-center gap-2 mb-2">
          <span className="flex items-center gap-1 bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            <VinylIcon className="w-3 h-3" />
            DJ
          </span>
          <span className="text-blue-400 font-medium">{message.username}</span>
          <span className="text-gray-500 text-xs ml-auto">{timeAgo}</span>
        </div>
        {message.promoTitle && (
          <p className="text-white font-medium mb-2">{message.promoTitle}</p>
        )}
        <a
          href={message.promoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          {message.promoUrl}
        </a>
      </div>
    );
  }

  return (
    <div className={`py-2 ${isOwnMessage ? 'opacity-90' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {message.isDJ && (
              <span className="flex items-center gap-1 bg-purple-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                <VinylIcon className="w-3 h-3" />
                DJ
              </span>
            )}
            <span className={`font-medium ${message.isDJ ? 'text-purple-400' : 'text-gray-400'}`}>
              {message.username}
            </span>
            <span className="text-gray-600 text-xs">{timeAgo}</span>
          </div>
          <p className="text-white mt-1">{message.message}</p>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

// Shorten URL to just the domain (matching iOS behavior)
function shortenUrl(urlString: string): string {
  try {
    const url = new URL(urlString);
    let display = url.host;
    if (display.startsWith('www.')) {
      display = display.slice(4);
    }
    return display;
  } catch {
    return urlString;
  }
}

export function DJChatPanel({
  broadcastToken,
  slotId,
  djUsername,
  userId,
  isCollapsed = false,
  onToggleCollapse,
  initialPromoSubmitted = false,
}: DJChatPanelProps) {
  const { messages, isConnected, error, sendMessage, sendPromo, promoUsed } = useDJChat({
    broadcastToken,
    slotId,
    djUsername,
    userId,
  });

  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [promoUrl, setPromoUrl] = useState('');
  const [promoTitle, setPromoTitle] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (!isCollapsed) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isCollapsed]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isSending) return;

    setIsSending(true);
    setLocalError(null);

    try {
      await sendMessage(inputValue.trim());
      setInputValue('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setIsSending(false);
    }
  };

  const handleSendPromo = async () => {
    if (!promoUrl.trim()) return;

    setIsSending(true);
    setLocalError(null);

    try {
      await sendPromo(promoUrl.trim(), promoTitle.trim() || undefined);
      setShowPromoModal(false);
      setPromoUrl('');
      setPromoTitle('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to post promo');
    } finally {
      setIsSending(false);
    }
  };

  const unreadCount = isCollapsed ? messages.filter(m => Date.now() - m.timestamp < 60000).length : 0;

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden flex flex-col lg:h-full">
      {/* Header */}
      <button
        onClick={onToggleCollapse}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="text-white font-medium">Chat</span>
          {isConnected ? (
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
          ) : (
            <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></span>
          )}
          {unreadCount > 0 && (
            <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div className="border-t border-gray-800 flex-1 flex flex-col min-h-0">
          {/* Error display */}
          {(error || localError) && (
            <div className="bg-red-900/50 text-red-200 px-4 py-2 text-sm flex-shrink-0">
              {error || localError}
            </div>
          )}

          {/* Pinned Promo Bar (like iOS) - shows most recent promo */}
          {(() => {
            const latestPromo = [...messages].reverse().find(m => m.messageType === 'promo');
            if (!latestPromo) return null;
            return (
              <a
                href={latestPromo.promoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2.5 bg-blue-500/10 hover:bg-blue-500/20 border-b border-gray-800 transition-colors flex-shrink-0"
              >
                <span className="flex items-center gap-1 bg-purple-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                  <VinylIcon className="w-2.5 h-2.5" />
                  DJ
                </span>
                <span className="text-purple-400 font-semibold text-sm">{latestPromo.username}</span>
                {latestPromo.promoTitle && (
                  <>
                    <span className="text-gray-500">·</span>
                    <span className="text-white text-sm truncate flex-1">{latestPromo.promoTitle}</span>
                  </>
                )}
                <span className="flex items-center gap-1 text-blue-400 text-xs ml-auto flex-shrink-0">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  {shortenUrl(latestPromo.promoUrl || '')}
                </span>
              </a>
            );
          })()}

          {/* Messages (filter out promo messages - they're shown in pinned bar) */}
          <div className="flex-1 overflow-y-auto p-4 space-y-1 min-h-[16rem]">
            {messages.filter(m => m.messageType !== 'promo').length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No messages yet. Start the conversation!
              </p>
            ) : (
              messages
                .filter(m => m.messageType !== 'promo')
                .map((msg) => (
                  <ChatMessage
                    key={msg.id}
                    message={msg}
                    isOwnMessage={msg.username === djUsername}
                  />
                ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-gray-800 p-4 flex-shrink-0">
            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                maxLength={280}
                disabled={isSending}
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isSending}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
              >
                Send
              </button>
            </form>

            {/* Promo button - hide if already submitted during onboarding or via chat */}
            {!promoUsed && !initialPromoSubmitted && (
              <button
                onClick={() => setShowPromoModal(true)}
                className="mt-3 w-full flex items-center justify-center gap-2 text-blue-400 hover:text-blue-300 text-sm py-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Share a promo link
              </button>
            )}
          </div>
        </div>
      )}

      {/* Promo Modal */}
      {showPromoModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">Share a promo link</h3>
            <p className="text-gray-400 text-sm mb-4">
              This will be pinned at the top of the chat for all listeners.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-1">URL</label>
                <input
                  type="url"
                  value={promoUrl}
                  onChange={(e) => setPromoUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-1">Title (optional)</label>
                <input
                  type="text"
                  value={promoTitle}
                  onChange={(e) => setPromoTitle(e.target.value)}
                  placeholder="New album out now!"
                  className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  maxLength={100}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowPromoModal(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendPromo}
                  disabled={!promoUrl.trim() || isSending}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg transition-colors"
                >
                  {isSending ? 'Posting...' : 'Post'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
