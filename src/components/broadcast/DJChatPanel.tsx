'use client';

import { useState, useRef, useEffect } from 'react';
import { useDJChat } from '@/hooks/useDJChat';
import { ChatMessageSerialized } from '@/types/broadcast';
import { normalizeUrl } from '@/lib/url';

interface DJChatPanelProps {
  broadcastToken: string;
  slotId: string;
  djUsername: string;
  userId?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  initialPromoSubmitted?: boolean;
  isVenue?: boolean;
  onChangeUsername?: (newUsername: string) => void;
  // Pre-configured promo from current DJ slot (for venue broadcasts)
  activePromoText?: string;
  activePromoHyperlink?: string;
}

function ChatMessage({ message, isOwnMessage, currentLiveDjUsername }: {
  message: ChatMessageSerialized;
  isOwnMessage: boolean;
  currentLiveDjUsername?: string;
}) {
  const timeAgo = formatTimeAgo(message.timestamp);
  // Show red dot for any message from the live DJ's username (case-insensitive, regardless of which chat panel they used)
  const isCurrentlyLiveDJ = !!(currentLiveDjUsername && message.username.toLowerCase() === currentLiveDjUsername.toLowerCase());

  if (message.messageType === 'promo') {
    return null; // Promos shown in pinned bar
  }

  // Love reaction message - show multiple hearts based on heartCount
  if (message.messageType === 'love' || message.message?.includes(' is ❤️')) {
    const heartCount = Math.min(message.heartCount || 1, 10);
    const hearts = '❤️'.repeat(heartCount);
    const displayMessage = message.message.replace(' is ❤️', ` is ${hearts}`);

    return (
      <div className="py-2 flex items-center justify-between">
        <span className="text-white text-sm">{displayMessage}</span>
        <span className="text-gray-600 text-xs ml-2">{timeAgo}</span>
      </div>
    );
  }

  // Tip message
  if (message.messageType === 'tip') {
    return (
      <div className="py-2 flex items-center justify-between">
        <span className="text-green-400 text-sm font-medium">{message.message}</span>
        <span className="text-gray-600 text-xs ml-2">{timeAgo}</span>
      </div>
    );
  }

  return (
    <div className={`py-2 ${isOwnMessage ? 'opacity-90' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-medium ${isCurrentlyLiveDJ ? 'text-white' : 'text-gray-400'}`}>
              {message.username}
            </span>
            {isCurrentlyLiveDJ && (
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" title="Live DJ"></span>
            )}
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

export function DJChatPanel({
  broadcastToken,
  slotId,
  djUsername,
  userId,
  isCollapsed = false,
  initialPromoSubmitted = false,
  isVenue = false,
  onChangeUsername,
  activePromoText,
  activePromoHyperlink,
}: DJChatPanelProps) {
  const { messages, error, sendMessage, sendPromo, promoUsed } = useDJChat({
    broadcastToken,
    slotId,
    djUsername,
    userId,
  });

  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [promoText, setPromoText] = useState('');
  const [promoHyperlink, setPromoHyperlink] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [newUsername, setNewUsername] = useState(djUsername);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check if promo has been posted (either during onboarding or in chat)
  const hasPostedPromo = promoUsed || initialPromoSubmitted;

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
    if (!promoText.trim()) return;

    setIsSending(true);
    setLocalError(null);

    try {
      const normalizedHyperlink = promoHyperlink.trim() ? normalizeUrl(promoHyperlink.trim()) : undefined;
      await sendPromo(promoText.trim(), normalizedHyperlink);
      setShowPromoModal(false);
      setPromoText('');
      setPromoHyperlink('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to post promo');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="bg-[#252525] rounded-xl overflow-hidden flex flex-col lg:h-full lg:min-h-0">
      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0">
          {/* Error display */}
          {(error || localError) && (
            <div className="bg-red-900/50 text-red-200 px-4 py-2 text-sm flex-shrink-0">
              {error || localError}
            </div>
          )}

          {/* Pinned Promo Bar (like iOS) - shows current DJ's promo */}
          {(() => {
            // For venue broadcasts, use the pre-configured promo from current DJ slot ONLY
            // If venue DJ has no promo, show nothing (don't inherit from previous DJ's chat messages)
            // For remote broadcasts, use the latest promo from chat messages
            let promoTextToShow: string | undefined;
            let promoHyperlinkToShow: string | undefined;

            if (isVenue) {
              // Venue: only use pre-configured promo from current DJ slot
              // If no promo configured, show nothing
              if (activePromoText) {
                promoTextToShow = activePromoText;
                promoHyperlinkToShow = activePromoHyperlink;
              }
            } else {
              // Remote: use latest promo from chat messages
              const latestPromo = [...messages].reverse().find(m => m.messageType === 'promo' && m.djSlotId === slotId);
              if (latestPromo?.promoText) {
                promoTextToShow = latestPromo.promoText;
                promoHyperlinkToShow = latestPromo.promoHyperlink;
              }
            }

            if (!promoTextToShow) return null;

            const hasHyperlink = !!promoHyperlinkToShow;

            const content = (
              <div className={`px-3 pt-3 pb-2.5 bg-accent/10 border-b border-gray-800 flex-shrink-0 ${hasHyperlink ? 'hover:bg-accent/20 cursor-pointer' : ''}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white font-semibold text-sm">{djUsername}</span>
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" title="Live DJ"></span>
                  {hasHyperlink && (
                    <svg className="w-4 h-4 text-accent flex-shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  )}
                </div>
                <p className={`text-sm ${hasHyperlink ? 'text-accent' : 'text-white'}`}>
                  {promoTextToShow}
                </p>
              </div>
            );

            if (hasHyperlink) {
              return (
                <a
                  href={normalizeUrl(promoHyperlinkToShow!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block transition-colors"
                >
                  {content}
                </a>
              );
            }
            return content;
          })()}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-1 min-h-[16rem]">
            {messages.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No messages yet. Start the conversation!
              </p>
            ) : (
              messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  isOwnMessage={msg.username === djUsername}
                  currentLiveDjUsername={djUsername}
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
                className="flex-1 bg-black text-white border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-gray-500"
                maxLength={280}
                disabled={isSending}
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || isSending}
                className="bg-accent hover:bg-accent-hover disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
              >
                Send
              </button>
            </form>

            {/* Chatting as section - show for all DJs, Edit button only for venue DJs */}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-gray-400 text-sm">
                Chatting as <span className="text-white font-medium">{djUsername}</span>
              </span>
              {isVenue && onChangeUsername && (
                <button
                  onClick={() => {
                    setNewUsername(djUsername);
                    setShowUsernameModal(true);
                  }}
                  className="text-accent hover:text-accent-hover text-sm"
                >
                  Edit
                </button>
              )}
            </div>

          </div>
        </div>

      {/* Promo Modal */}
      {showPromoModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#252525] rounded-xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">Share a promo</h3>
            <p className="text-gray-400 text-sm mb-4">
              This will be pinned at the top of the chat for all listeners.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-1">Promo Text</label>
                <input
                  type="text"
                  value={promoText}
                  onChange={(e) => setPromoText(e.target.value)}
                  placeholder="New album out now!"
                  className="w-full bg-black text-white border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-gray-500"
                  maxLength={200}
                />
                <p className="text-gray-600 text-xs mt-1">{promoText.length}/200</p>
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-1">Hyperlink (optional)</label>
                <input
                  type="text"
                  value={promoHyperlink}
                  onChange={(e) => setPromoHyperlink(e.target.value)}
                  placeholder="bandcamp.com/your-album"
                  className="w-full bg-black text-white border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-gray-500"
                />
                <p className="text-gray-600 text-xs mt-1">Clicking the promo text will open this link</p>
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
                  disabled={!promoText.trim() || isSending}
                  className="flex-1 bg-accent hover:bg-accent-hover disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg transition-colors"
                >
                  {isSending ? 'Posting...' : hasPostedPromo ? 'Update' : 'Post'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Username Edit Modal - for venue DJs */}
      {showUsernameModal && onChangeUsername && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#252525] rounded-xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">Change DJ Name</h3>
            <p className="text-gray-400 text-sm mb-4">
              This will update your name in the chat.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 text-sm mb-1">DJ Name</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="YourDJName"
                  className="w-full bg-black text-white border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-gray-500"
                  maxLength={20}
                />
                <p className="text-gray-500 text-xs mt-1">
                  2-20 characters, letters and numbers only
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowUsernameModal(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const trimmed = newUsername.trim();
                    const handle = trimmed.replace(/\s+/g, '');
                    if (trimmed.length >= 2 && trimmed.length <= 20 && handle.length >= 2 && /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(trimmed)) {
                      onChangeUsername(trimmed);
                      setShowUsernameModal(false);
                    }
                  }}
                  disabled={!newUsername.trim() || newUsername.trim().length < 2 || newUsername.trim().replace(/\s+/g, '').length < 2 || !/^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(newUsername.trim())}
                  className="flex-1 bg-accent hover:bg-accent-hover disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
