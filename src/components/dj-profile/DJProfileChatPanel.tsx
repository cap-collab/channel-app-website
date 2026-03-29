'use client';

import { useState, useRef, useEffect } from 'react';
import { useDJProfileChat } from '@/hooks/useDJProfileChat';
import { ChatMessageSerialized } from '@/types/broadcast';
import { AuthModal } from '@/components/AuthModal';
import { FloatingHearts } from '@/components/channel/FloatingHearts';
import { TipButton } from '@/components/channel/TipButton';
import { normalizeUrl } from '@/lib/url';

interface DJProfileChatPanelProps {
  chatUsernameNormalized: string;
  djUserId: string;
  djUsername: string;
  djEmail: string;
  isAuthenticated: boolean;
  username?: string;
  userId?: string;
  profileLoading?: boolean;
  onSetUsername?: (username: string) => Promise<{ success: boolean; error?: string }>;
  isOwner?: boolean;
  // Broadcast-specific props (when DJ is broadcasting):
  broadcastToken?: string;
  broadcastSlotId?: string;
  isVenue?: boolean;
  initialPromoSubmitted?: boolean;
  onChangeUsername?: (newUsername: string) => void;
  activePromoText?: string;
  activePromoHyperlink?: string;
  currentShowStartTime?: number;
  isChannelUser?: boolean;
}

// Reserved usernames that cannot be registered (case-insensitive)
const RESERVED_USERNAMES = ['channel', 'admin', 'system', 'moderator', 'mod'];

// Validate username format (same rules as iOS app)
function isValidUsername(username: string): boolean {
  const trimmed = username.trim();
  if (trimmed.length < 2 || trimmed.length > 20) return false;

  // Must contain at least 2 alphanumeric characters (when spaces removed)
  const handle = trimmed.replace(/\s+/g, '');
  if (handle.length < 2) return false;

  // Check reserved usernames against normalized handle
  if (RESERVED_USERNAMES.includes(handle.toLowerCase())) return false;

  // Alphanumeric and single spaces only
  return /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(trimmed);
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

function ChatMessage({
  message,
  isOwnMessage,
  djUsername,
}: {
  message: ChatMessageSerialized;
  isOwnMessage: boolean;
  djUsername: string;
}) {
  const timeAgo = formatTimeAgo(message.timestamp);
  // Show red dot for DJ messages
  const isDJMessage = message.isDJ || message.username.toLowerCase() === djUsername.toLowerCase();

  // Love reaction message - show multiple hearts based on heartCount
  if (message.messageType === 'love' || message.message?.includes(' is ❤️')) {
    const heartCount = Math.min(message.heartCount || 1, 10);
    const hearts = '❤️'.repeat(heartCount);
    const displayMessage = message.message.replace(' is ❤️', ` is ${hearts}`);

    return (
      <div className="py-2 px-4 flex items-center justify-between">
        <span className="text-white">{displayMessage}</span>
        <span className="text-gray-600 text-xs">{timeAgo}</span>
      </div>
    );
  }

  // Tip message
  if (message.messageType === 'tip') {
    return (
      <div className="py-2 px-4 text-green-400 font-medium">
        {message.message}
      </div>
    );
  }

  return (
    <div className={`py-2 px-4 ${isOwnMessage ? 'bg-white/5' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-medium ${isDJMessage ? 'text-white' : 'text-gray-400'}`}>
              {message.username}
            </span>
            {isDJMessage && (
              <span className="w-2 h-2 bg-red-500 rounded-full" title="DJ" />
            )}
            <span className="text-gray-600 text-xs">{timeAgo}</span>
          </div>
          <p className="text-white mt-1">{message.message}</p>
        </div>
      </div>
    </div>
  );
}

function LoginPrompt() {
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <svg className="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="text-gray-400 mb-4">Sign in to join the conversation</p>
          <button
            onClick={() => setShowAuthModal(true)}
            className="px-6 py-2 bg-white text-black rounded-lg font-medium text-sm hover:bg-white/90 transition-colors"
          >
            Sign In
          </button>
        </div>
      </div>
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message="Sign in to join the chat"
      />
    </>
  );
}

function UsernameSetup({
  onSetUsername,
}: {
  onSetUsername: (username: string) => Promise<{ success: boolean; error?: string }>;
}) {
  const [inputUsername, setInputUsername] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isChecking, setIsChecking] = useState(false);

  const hasInput = inputUsername.trim().length > 0;

  const handleJoin = async () => {
    const trimmed = inputUsername.trim();

    if (!isValidUsername(trimmed)) {
      setErrorMessage('Invalid username. Use 2-20 characters, letters and numbers only.');
      return;
    }

    setIsChecking(true);
    setErrorMessage('');

    const result = await onSetUsername(trimmed);

    setIsChecking(false);

    if (!result.success) {
      setErrorMessage(result.error || 'Username already taken. Try another one.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && hasInput && !isChecking) {
      e.preventDefault();
      handleJoin();
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-sm w-full">
        <svg className="w-16 h-16 text-white mx-auto mb-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
        </svg>

        <h3 className="text-white font-bold text-xl mb-2">Choose a Username</h3>
        <p className="text-gray-400 text-sm mb-6">
          This will be displayed in the chat
        </p>

        <div className="text-left mb-4">
          <input
            type="text"
            value={inputUsername}
            onChange={(e) => {
              setInputUsername(e.target.value);
              if (errorMessage) setErrorMessage('');
            }}
            onKeyDown={handleKeyDown}
            placeholder="Username"
            className="w-full px-4 py-3 bg-black border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
            maxLength={20}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            disabled={isChecking}
          />
          <p className="text-gray-500 text-xs mt-2">
            2-20 characters, letters, numbers, and spaces
          </p>
          {errorMessage && (
            <p className="text-red-400 text-xs mt-2">
              {errorMessage}
            </p>
          )}
        </div>

        <button
          onClick={handleJoin}
          disabled={!hasInput || isChecking}
          className="w-full bg-white hover:bg-gray-100 disabled:bg-gray-600 disabled:cursor-not-allowed text-gray-900 disabled:text-gray-400 font-medium py-3 rounded-lg transition-colors"
        >
          {isChecking ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Checking...
            </span>
          ) : (
            'Join Chat'
          )}
        </button>

        <div className="mt-6 text-left text-xs text-gray-500 space-y-2">
          <p className="text-gray-400 font-medium">
            Channel exists to bring people together, and we want to keep this space safe for everyone.
          </p>
          <p>
            We have zero tolerance for harassment, hate speech, discrimination, or illegal content.
          </p>
          <p>
            Messages or access may be removed to protect the community.
          </p>
          <p className="pt-2">
            <a
              href="https://channel-app.com/guidelines"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 underline hover:text-gray-300"
            >
              Read our Community Guidelines
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

function ProfileLoading() {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center">
        <svg className="animate-spin h-8 w-8 text-gray-400 mx-auto mb-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <p className="text-gray-400">Loading your profile...</p>
      </div>
    </div>
  );
}

export function DJProfileChatPanel({
  chatUsernameNormalized,
  djUserId,
  djUsername,
  djEmail,
  isAuthenticated,
  username,
  userId,
  profileLoading = false,
  onSetUsername,
  isOwner = false,
  broadcastToken,
  broadcastSlotId,
  isVenue = false,
  initialPromoSubmitted = false,
  onChangeUsername,
  activePromoText,
  activePromoHyperlink,
  currentShowStartTime,
  isChannelUser = true,
}: DJProfileChatPanelProps) {
  const isBroadcasting = !!broadcastToken;

  const { messages, error, sendMessage, sendLove, sendPromo, currentPromo, promoUsed } = useDJProfileChat({
    chatUsernameNormalized,
    djUsername,
    username,
    enabled: isAuthenticated,
    isOwner,
    broadcastToken,
    broadcastSlotId,
    currentShowStartTime,
  });

  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [heartTrigger, setHeartTrigger] = useState(0);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [promoTextInput, setPromoTextInput] = useState('');
  const [promoHyperlinkInput, setPromoHyperlinkInput] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [newUsernameInput, setNewUsernameInput] = useState(djUsername);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const hasPostedPromo = promoUsed || initialPromoSubmitted;

  // Auto-scroll to bottom within chat container only
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isSending || !username) return;

    setIsSending(true);
    try {
      await sendMessage(inputValue.trim());
      setInputValue('');
    } catch (err) {
      console.error('Failed to send:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleSendLove = async () => {
    // Trigger floating hearts animation
    setHeartTrigger((prev) => prev + 1);

    try {
      await sendLove();
    } catch (err) {
      console.error('Failed to send love:', err);
    }
  };

  const handleSendPromo = async () => {
    if (!promoTextInput.trim()) return;

    setIsSending(true);
    setLocalError(null);

    try {
      const normalizedHyperlink = promoHyperlinkInput.trim() ? normalizeUrl(promoHyperlinkInput.trim()) : undefined;
      await sendPromo(promoTextInput.trim(), normalizedHyperlink);
      setShowPromoModal(false);
      setPromoTextInput('');
      setPromoHyperlinkInput('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to post promo');
    } finally {
      setIsSending(false);
    }
  };

  // Determine promo to display in pinned bar
  const promoToDisplay = (() => {
    if (!isBroadcasting) return null;
    if (isVenue) {
      // Venue: use pre-configured promo from current DJ slot only
      if (activePromoText) return { text: activePromoText, hyperlink: activePromoHyperlink };
      return null;
    }
    // Remote: use latest promo from chat messages, fall back to slot DJ profile promo
    if (currentPromo?.promoText) return { text: currentPromo.promoText, hyperlink: currentPromo.promoHyperlink };
    if (activePromoText) return { text: activePromoText, hyperlink: activePromoHyperlink };
    return null;
  })();

  // Show login prompt if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col h-full min-h-[400px]">
        <LoginPrompt />
      </div>
    );
  }

  // Show loading state while fetching profile
  if (profileLoading) {
    return (
      <div className="flex flex-col h-full min-h-[400px]">
        <ProfileLoading />
      </div>
    );
  }

  // Show username setup if authenticated but no chatUsername
  if (!username && onSetUsername) {
    return (
      <div className="flex flex-col h-full min-h-[400px]">
        <UsernameSetup onSetUsername={onSetUsername} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-[60vh]">
      {/* Error display */}
      {(error || localError) && (
        <div className="bg-red-900/50 text-red-200 px-4 py-2 text-sm flex-shrink-0">
          {error || localError}
        </div>
      )}

      {/* Pinned Promo Bar — show latest promo for everyone (not just broadcaster) */}
      {(() => {
        // Use promoToDisplay for broadcasters, or currentPromo for listeners
        const promo = promoToDisplay || (currentPromo?.promoText ? { text: currentPromo.promoText, hyperlink: currentPromo.promoHyperlink } : null);
        if (!promo) return null;
        const hasHyperlink = !!promo.hyperlink;
        const content = (
          <div className={`px-4 py-3 bg-white/5 border-b border-white/10 flex-shrink-0 ${hasHyperlink ? 'hover:bg-white/10 cursor-pointer' : ''}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-white font-semibold text-sm">{djUsername}</span>
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" title="Live DJ" />
              {hasHyperlink && (
                <svg className="w-4 h-4 text-zinc-400 flex-shrink-0 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              )}
            </div>
            <p className={`text-sm ${hasHyperlink ? 'text-white underline' : 'text-white'}`}>
              {promo.text}
            </p>
          </div>
        );
        if (hasHyperlink) {
          return (
            <a href={normalizeUrl(promo.hyperlink!)} target="_blank" rel="noopener noreferrer" className="block transition-colors">
              {content}
            </a>
          );
        }
        return content;
      })()}

      {/* Messages — filter out promo messages (they're shown in the pinned bar) */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto">
        {(() => {
          const chatMessages = messages.filter((msg) => msg.messageType !== 'promo');
          if (chatMessages.length === 0) {
            return (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center p-6">
                  <svg className="w-12 h-12 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p>No messages yet. Start the conversation!</p>
                </div>
              </div>
            );
          }
          return (
            <div className="divide-y divide-white/5">
              {chatMessages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  isOwnMessage={msg.username === username}
                  djUsername={djUsername}
                />
              ))}
            </div>
          );
        })()}
      </div>

      {/* Input bar */}
      <div className="border-t border-white/10 p-3 flex-shrink-0">
        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          {/* Heart button with floating hearts */}
          <div className="relative flex-shrink-0 flex items-center">
            <button
              type="button"
              onClick={handleSendLove}
              className="w-5 h-5 flex items-center justify-center text-white hover:text-white/80 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </button>
            <FloatingHearts trigger={heartTrigger} />
          </div>

          {/* Tip button — only shown for channel users (claimed accounts) */}
          {isChannelUser && (
            <div className="flex-shrink-0 flex items-center">
              <TipButton
                isAuthenticated={isAuthenticated}
                tipperUserId={userId}
                tipperUsername={username}
                djUserId={djUserId}
                djEmail={djEmail}
                djUsername={djUsername}
                broadcastSlotId=""
                showName={`Support ${djUsername}`}
                size="small"
              />
            </div>
          )}

          {/* Text input */}
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Message..."
            className="flex-1 min-w-0 bg-black text-white text-sm border border-white/20 px-3 py-2 focus:outline-none focus:border-white/40 disabled:text-zinc-500 disabled:cursor-not-allowed"
            maxLength={280}
            disabled={isSending}
          />

          {/* Send button */}
          <button
            type="submit"
            disabled={!inputValue.trim() || isSending}
            className="flex-shrink-0 bg-white hover:bg-gray-200 disabled:bg-zinc-700 disabled:cursor-not-allowed text-black disabled:text-zinc-400 p-2 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>

        {/* Chatting as + venue edit */}
        <div className="mt-2 flex items-center justify-between">
          <p className="text-zinc-500 text-xs">
            Chatting as <span className="text-white">{username}</span>
            {isOwner && <span className="text-accent ml-1">(DJ)</span>}
          </p>
          {isBroadcasting && isVenue && onChangeUsername && (
            <button
              onClick={() => {
                setNewUsernameInput(djUsername);
                setShowUsernameModal(true);
              }}
              className="text-accent hover:text-accent-hover text-xs"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Promo Modal (broadcast only) */}
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
                  value={promoTextInput}
                  onChange={(e) => setPromoTextInput(e.target.value)}
                  placeholder="New album out now!"
                  className="w-full bg-black text-white border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-gray-500"
                  maxLength={200}
                />
                <p className="text-gray-600 text-xs mt-1">{promoTextInput.length}/200</p>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Hyperlink (optional)</label>
                <input
                  type="text"
                  value={promoHyperlinkInput}
                  onChange={(e) => setPromoHyperlinkInput(e.target.value)}
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
                  disabled={!promoTextInput.trim() || isSending}
                  className="flex-1 bg-accent hover:bg-accent-hover disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg transition-colors"
                >
                  {isSending ? 'Posting...' : hasPostedPromo ? 'Update' : 'Post'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Username Edit Modal (venue broadcasts only) */}
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
                  value={newUsernameInput}
                  onChange={(e) => setNewUsernameInput(e.target.value)}
                  placeholder="YourDJName"
                  className="w-full bg-black text-white border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-gray-500"
                  maxLength={20}
                />
                <p className="text-gray-500 text-xs mt-1">2-20 characters, letters and numbers only</p>
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
                    const trimmed = newUsernameInput.trim();
                    const handle = trimmed.replace(/\s+/g, '');
                    if (trimmed.length >= 2 && trimmed.length <= 20 && handle.length >= 2 && /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(trimmed)) {
                      onChangeUsername(trimmed);
                      setShowUsernameModal(false);
                    }
                  }}
                  disabled={!newUsernameInput.trim() || newUsernameInput.trim().length < 2 || newUsernameInput.trim().replace(/\s+/g, '').length < 2 || !/^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(newUsernameInput.trim())}
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
