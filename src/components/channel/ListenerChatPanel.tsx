'use client';

import { useState, useRef, useEffect } from 'react';
import { useListenerChat } from '@/hooks/useListenerChat';
import { useAuthContext } from '@/contexts/AuthContext';
import { ChatMessageSerialized } from '@/types/broadcast';

interface ListenerChatPanelProps {
  isAuthenticated: boolean;
  username?: string;
  currentDJ?: string | null;
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
  if (RESERVED_USERNAMES.includes(trimmed.toLowerCase())) return false;
  return /^[A-Za-z0-9]+$/.test(trimmed);
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
  const isCurrentlyLiveDJ = message.isDJ && currentLiveDjUsername && message.username === currentLiveDjUsername;

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

  return (
    <div className={`py-2 px-4 ${isOwnMessage ? 'bg-gray-800/30' : ''}`}>
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
  const {
    signInWithGoogle,
    signInWithApple,
    sendEmailLink,
    emailSent,
    resetEmailSent,
    loading,
  } = useAuthContext();

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleGoogleLogin = async () => {
    setIsSigningIn(true);
    try {
      await signInWithGoogle(false);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleAppleLogin = async () => {
    setIsSigningIn(true);
    try {
      await signInWithApple(false);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsSigningIn(true);
    try {
      await sendEmailLink(email.trim(), false);
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <svg className="w-12 h-12 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>

        <h3 className="text-white font-semibold text-lg mb-2">Join the Chat</h3>
        <p className="text-gray-400 text-sm mb-6">
          Sign in to read and send messages in the chat.
        </p>

        {emailSent ? (
          <div className="text-center">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-gray-200 text-sm font-medium mb-1">Check your email</p>
            <p className="text-gray-400 text-xs mb-3">
              We sent a sign-in link to <span className="text-white">{email}</span>
            </p>
            <button
              onClick={() => {
                resetEmailSent();
                setShowEmailForm(false);
                setEmail('');
              }}
              className="text-gray-400 text-xs underline hover:text-gray-300"
            >
              Use a different method
            </button>
          </div>
        ) : showEmailForm ? (
          <form onSubmit={handleEmailSubmit} className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
              autoFocus
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
            />
            <button
              type="submit"
              disabled={isSigningIn || loading || !email.trim()}
              className="w-full bg-white hover:bg-gray-100 disabled:bg-gray-300 text-gray-900 font-medium py-3 rounded-lg transition-colors"
            >
              {isSigningIn ? 'Sending...' : 'Send sign-in link'}
            </button>
            <button
              type="button"
              onClick={() => setShowEmailForm(false)}
              className="text-gray-400 text-sm hover:text-gray-300"
            >
              Back
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <button
              onClick={handleGoogleLogin}
              disabled={isSigningIn || loading}
              className="w-full flex items-center justify-center gap-2 bg-white hover:bg-gray-100 disabled:bg-gray-300 text-gray-900 font-medium py-3 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {isSigningIn ? 'Signing in...' : 'Continue with Google'}
            </button>

            <button
              onClick={handleAppleLogin}
              disabled={isSigningIn || loading}
              className="w-full flex items-center justify-center gap-2 bg-black hover:bg-gray-800 disabled:bg-gray-700 text-white font-medium py-3 rounded-lg border border-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
              {isSigningIn ? 'Signing in...' : 'Continue with Apple'}
            </button>

            <button
              onClick={() => setShowEmailForm(true)}
              disabled={isSigningIn || loading}
              className="w-full flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white font-medium py-3 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Continue with Email
            </button>
          </div>
        )}
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
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
            maxLength={20}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            disabled={isChecking}
          />
          <p className="text-gray-500 text-xs mt-2">
            2-20 characters, letters and numbers only
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
  currentDJ,
  isLive = false,
  profileLoading = false,
  onSetUsername,
}: ListenerChatPanelProps) {
  const { messages, isConnected, error, currentPromo, sendMessage, sendLove } = useListenerChat({
    username,
  });

  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
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
    try {
      await sendLove();
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
      <div className="flex flex-col h-full bg-gray-900">
        <ChatHeader />
        <LoginPrompt />
      </div>
    );
  }

  // Show loading state while fetching profile
  if (profileLoading) {
    return (
      <div className="flex flex-col h-full bg-gray-900">
        <ChatHeader />
        <ProfileLoading />
      </div>
    );
  }

  // Show username setup if authenticated but no chatUsername
  if (!username && onSetUsername) {
    return (
      <div className="flex flex-col h-full bg-gray-900">
        <ChatHeader />
        <UsernameSetup onSetUsername={onSetUsername} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
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
          {/* Heart button */}
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

          {/* Text input */}
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={isLive ? "Type a message..." : "Chat available when live"}
            className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-gray-500 disabled:text-gray-500 disabled:cursor-not-allowed"
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
