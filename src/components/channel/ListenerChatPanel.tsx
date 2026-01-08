'use client';

import { useState, useRef, useEffect } from 'react';
import { useListenerChat } from '@/hooks/useListenerChat';
import { ChatMessageSerialized } from '@/types/broadcast';
import { AuthModal } from '@/components/AuthModal';
import { FloatingHearts } from './FloatingHearts';
import { TipButton } from './TipButton';

interface ListenerChatPanelProps {
  isAuthenticated: boolean;
  username?: string;
  userId?: string;
  currentDJ?: string | null;
  currentDJUserId?: string | null;  // DJ's Firebase UID - set at go-live (preferred for tips)
  currentDJEmail?: string | null;   // DJ's email - fallback only
  showName?: string;
  broadcastSlotId?: string;
  isLive?: boolean;
  profileLoading?: boolean;
  onSetUsername?: (username: string) => Promise<{ success: boolean; error?: string }>;
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

function ChatMessage({
  message,
  isOwnMessage,
  currentLiveDjUsername,
}: {
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

  // Love reaction message
  if (message.messageType === 'love' || message.message?.includes(' is ❤️')) {
    return (
      <div className="py-2 px-4 text-gray-400 text-sm italic">
        {message.message}
      </div>
    );
  }

  // Tip message
  if (message.messageType === 'tip') {
    return (
      <div className="py-2 px-4 text-green-400 text-sm font-medium">
        {message.message}
      </div>
    );
  }

  return (
    <div className={`py-2 px-4 ${isOwnMessage ? 'bg-black/30' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`font-medium ${isCurrentlyLiveDJ ? 'text-white' : 'text-gray-400'}`}>
              {message.username}
            </span>
            {isCurrentlyLiveDJ && (
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" title="Live DJ" />
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
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <AuthModal
          isOpen={true}
          onClose={() => {}}
          message="Sign in to join the chat"
          inline={true}
        />
      </div>
    </div>
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
        {/* Header */}
        <svg className="w-16 h-16 text-white mx-auto mb-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
        </svg>

        <h3 className="text-white font-bold text-xl mb-2">Choose a Username</h3>
        <p className="text-gray-400 text-sm mb-6">
          This will be displayed in the chat
        </p>

        {/* Input field */}
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

        {/* Join button */}
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

        {/* Community guidelines */}
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

export function ListenerChatPanel({
  isAuthenticated,
  username,
  userId,
  currentDJ,
  currentDJUserId,
  currentDJEmail,
  showName,
  broadcastSlotId,
  isLive = false,
  profileLoading = false,
  onSetUsername,
}: ListenerChatPanelProps) {
  const { messages, isConnected, error, currentPromo, sendMessage, sendLove } = useListenerChat({
    username,
  });

  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [heartTrigger, setHeartTrigger] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    if (!username) return;

    // Trigger floating hearts animation
    setHeartTrigger((prev) => prev + 1);

    try {
      await sendLove(showName);
    } catch (err) {
      console.error('Failed to send love:', err);
    }
  };

  // Chat header component to reduce duplication
  const ChatHeader = () => (
    <div className="p-4 border-b border-gray-800">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span className="text-white font-medium">Chat</span>
      </div>
    </div>
  );

  // Show login prompt if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col h-full bg-[#252525] rounded-xl overflow-hidden">
        <ChatHeader />
        <LoginPrompt />
      </div>
    );
  }

  // Show loading state while fetching profile
  if (profileLoading) {
    return (
      <div className="flex flex-col h-full bg-[#252525] rounded-xl overflow-hidden">
        <ChatHeader />
        <ProfileLoading />
      </div>
    );
  }

  // Show username setup if authenticated but no chatUsername
  if (!username && onSetUsername) {
    return (
      <div className="flex flex-col h-full bg-[#252525] rounded-xl overflow-hidden">
        <ChatHeader />
        <UsernameSetup onSetUsername={onSetUsername} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#252525] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="text-white font-medium">Chat</span>
          {isConnected ? (
            <span className="w-2 h-2 bg-green-500 rounded-full" />
          ) : (
            <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-900/50 text-red-200 px-4 py-2 text-sm flex-shrink-0">
          {error}
        </div>
      )}

      {/* Pinned promo bar - only show when live */}
      {isLive && currentPromo && currentPromo.promoUrl && (
        <a
          href={currentPromo.promoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-3 bg-accent/10 hover:bg-accent/20 border-b border-gray-800 transition-colors flex-shrink-0"
        >
          <span className="text-white font-semibold text-sm">{currentPromo.username}</span>
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" title="Live DJ" />
          {currentPromo.promoTitle && (
            <>
              <span className="text-gray-500">·</span>
              <span className="text-white text-sm truncate flex-1">{currentPromo.promoTitle}</span>
            </>
          )}
          <span className="flex items-center gap-1 text-accent text-xs ml-auto flex-shrink-0">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            {shortenUrl(currentPromo.promoUrl)}
          </span>
        </a>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                isOwnMessage={msg.username === username}
                currentLiveDjUsername={currentDJ || undefined}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-800 p-4 flex-shrink-0">
        <form onSubmit={handleSendMessage} className="flex items-center gap-3">
          {/* Heart button with floating hearts */}
          <div className="relative">
            <button
              type="button"
              onClick={handleSendLove}
              disabled={!isLive}
              className={`transition-colors ${isLive ? 'text-accent hover:text-accent-hover' : 'text-gray-600 cursor-not-allowed'}`}
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </button>
            <FloatingHearts trigger={heartTrigger} />
          </div>

          {/* Tip button - only when live and DJ info available */}
          {isLive && currentDJ && (currentDJUserId || currentDJEmail) && broadcastSlotId && showName && (
            <TipButton
              isAuthenticated={isAuthenticated}
              tipperUserId={userId}
              tipperUsername={username}
              djUserId={currentDJUserId || undefined}
              djEmail={currentDJEmail || undefined}
              djUsername={currentDJ}
              broadcastSlotId={broadcastSlotId}
              showName={showName}
              compact
            />
          )}

          {/* Text input */}
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={isLive ? "Type a message..." : "Chat available when live"}
            className="flex-1 bg-black text-white border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-gray-500 disabled:text-gray-500 disabled:cursor-not-allowed"
            maxLength={280}
            disabled={isSending || !isLive}
          />

          {/* Send button */}
          <button
            type="submit"
            disabled={!inputValue.trim() || isSending || !isLive}
            className="bg-accent hover:bg-accent-hover disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>

        {/* Chatting as */}
        <p className="text-gray-500 text-xs mt-2">
          Chatting as <span className="text-white">{username}</span>
        </p>
      </div>
    </div>
  );
}
