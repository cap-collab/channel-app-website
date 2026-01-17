'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { getTipHistoryFromLocalStorage, groupTipsByDJ, DJTipGroup } from '@/lib/tip-history-storage';

interface APITipGroup {
  djUserId: string;
  djUsername: string;
  djPhotoUrl: string | null;
  tips: Array<{
    id: string;
    djUsername: string;
    djThankYouMessage: string;
    tipAmountCents: number;
    showName: string;
    createdAt: string;
  }>;
  totalAmountCents: number;
  latestTipDate: string;
}

interface APIReceivedTipGroup {
  tipperUserId: string | null;
  tipperUsername: string;
  tips: Array<{
    id: string;
    tipperUsername: string;
    tipAmountCents: number;
    showName: string;
    createdAt: string;
  }>;
  totalAmountCents: number;
  latestTipDate: string;
}

interface ReceivedTipGroup {
  tipperUsername: string;
  tipperUserId: string | null;
  tips: Array<{
    id: string;
    tipperUsername: string;
    tipAmountCents: number;
    showName: string;
    createdAt: number;
  }>;
  totalAmountCents: number;
  latestTipDate: number;
}

type TabType = 'sent' | 'received';

export function InboxClient() {
  const { user, isAuthenticated } = useAuthContext();
  const { djProfile } = useUserProfile(user?.uid);
  const [activeTab, setActiveTab] = useState<TabType>('sent');
  const [djGroups, setDjGroups] = useState<DJTipGroup[]>([]);
  const [receivedGroups, setReceivedGroups] = useState<ReceivedTipGroup[]>([]);
  const [totalReceivedCents, setTotalReceivedCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedDjs, setExpandedDjs] = useState<Set<string>>(new Set());
  const [expandedTippers, setExpandedTippers] = useState<Set<string>>(new Set());

  // Check if user is a DJ (has djProfile)
  const isDJ = !!djProfile;

  useEffect(() => {
    async function loadTips() {
      setLoading(true);

      if (isAuthenticated && user?.uid) {
        // Fetch sent tips from API for logged-in users
        try {
          const response = await fetch(`/api/tips/history?userId=${user.uid}`);
          if (response.ok) {
            const data = await response.json();
            // Transform API response to match DJTipGroup format
            const groups: DJTipGroup[] = data.djGroups.map((group: APITipGroup) => ({
              djUsername: group.djUsername,
              djUserId: group.djUserId,
              djPhotoUrl: group.djPhotoUrl,
              tips: group.tips.map(tip => ({
                id: tip.id,
                stripeSessionId: '',
                djUsername: tip.djUsername,
                showName: tip.showName,
                tipAmountCents: tip.tipAmountCents,
                djThankYouMessage: tip.djThankYouMessage,
                createdAt: new Date(tip.createdAt).getTime(),
              })),
              totalAmountCents: group.totalAmountCents,
              latestTipDate: new Date(group.latestTipDate).getTime(),
            }));
            setDjGroups(groups);
          }
        } catch (error) {
          console.error('Failed to fetch tip history:', error);
        }

        // Fetch received tips if user is a DJ
        if (isDJ) {
          try {
            const receivedResponse = await fetch(`/api/tips/received?djUserId=${user.uid}`);
            if (receivedResponse.ok) {
              const receivedData = await receivedResponse.json();
              const groups: ReceivedTipGroup[] = receivedData.tipperGroups.map((group: APIReceivedTipGroup) => ({
                tipperUsername: group.tipperUsername,
                tipperUserId: group.tipperUserId,
                tips: group.tips.map(tip => ({
                  id: tip.id,
                  tipperUsername: tip.tipperUsername,
                  showName: tip.showName,
                  tipAmountCents: tip.tipAmountCents,
                  createdAt: new Date(tip.createdAt).getTime(),
                })),
                totalAmountCents: group.totalAmountCents,
                latestTipDate: new Date(group.latestTipDate).getTime(),
              }));
              setReceivedGroups(groups);
              setTotalReceivedCents(receivedData.totalReceivedCents || 0);
            }
          } catch (error) {
            console.error('Failed to fetch received tips:', error);
          }
        }
      } else {
        // Use localStorage for guest users
        const localTips = getTipHistoryFromLocalStorage();
        const groups = groupTipsByDJ(localTips);
        setDjGroups(groups);
      }

      setLoading(false);
    }

    loadTips();
  }, [isAuthenticated, user?.uid, isDJ]);

  const toggleDj = (djUsername: string) => {
    setExpandedDjs(prev => {
      const next = new Set(prev);
      if (next.has(djUsername)) {
        next.delete(djUsername);
      } else {
        next.add(djUsername);
      }
      return next;
    });
  };

  const toggleTipper = (tipperUsername: string) => {
    setExpandedTippers(prev => {
      const next = new Set(prev);
      if (next.has(tipperUsername)) {
        next.delete(tipperUsername);
      } else {
        next.add(tipperUsername);
      }
      return next;
    });
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      });
    }
  };

  const formatAmount = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="p-4 border-b border-gray-900">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <Link
            href="/channel"
            className="text-gray-600 hover:text-white text-sm transition-colors"
          >
            &larr; Back
          </Link>
          <h1 className="text-lg font-medium text-white">Inbox</h1>
          <div className="w-10" />
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4">
        {/* Tabs - only show if user is a DJ */}
        {isDJ && (
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab('sent')}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'sent'
                  ? 'bg-white text-black'
                  : 'bg-gray-900 text-gray-400 hover:text-white'
              }`}
            >
              Tips Sent
            </button>
            <button
              onClick={() => setActiveTab('received')}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                activeTab === 'received'
                  ? 'bg-white text-black'
                  : 'bg-gray-900 text-gray-400 hover:text-white'
              }`}
            >
              Tips Received
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
          </div>
        ) : activeTab === 'received' && isDJ ? (
          // Tips Received Tab
          receivedGroups.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-900 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-gray-500 mb-2">No tips received yet</p>
              <p className="text-gray-600 text-sm">
                When listeners tip you during broadcasts, they&apos;ll appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Total Received Summary */}
              <div className="bg-[#1a1a1a] rounded-lg p-4 mb-4">
                <p className="text-gray-500 text-sm">Total Received</p>
                <p className="text-2xl font-bold text-white">{formatAmount(totalReceivedCents)}</p>
              </div>

              {receivedGroups.map((group) => {
                const isExpanded = expandedTippers.has(group.tipperUsername);
                return (
                  <div key={group.tipperUsername} className="bg-[#1a1a1a] rounded-lg overflow-hidden">
                    {/* Tipper Header */}
                    <button
                      onClick={() => toggleTipper(group.tipperUsername)}
                      className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center">
                          <span className="text-green-400 font-medium">
                            {group.tipperUsername.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="text-left">
                          <p className="text-white font-medium">{group.tipperUsername}</p>
                          <p className="text-gray-500 text-sm">
                            {group.tips.length} tip{group.tips.length !== 1 ? 's' : ''} · Total: {formatAmount(group.totalAmountCents)}
                          </p>
                        </div>
                      </div>
                      <svg
                        className={`w-5 h-5 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* Expanded Tips List */}
                    {isExpanded && (
                      <div className="border-t border-gray-800">
                        {group.tips.map((tip, index) => (
                          <div
                            key={tip.id}
                            className={`p-4 ${index !== group.tips.length - 1 ? 'border-b border-gray-800/50' : ''}`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-green-400 font-medium">+{formatAmount(tip.tipAmountCents)}</span>
                              <span className="text-gray-500 text-sm">{formatDate(tip.createdAt)}</span>
                            </div>
                            {tip.showName && (
                              <p className="text-gray-500 text-sm">for {tip.showName}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : djGroups.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-900 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-gray-500 mb-2">No tips yet</p>
            <p className="text-gray-600 text-sm">
              When you tip a DJ, it will appear here along with their thank you message.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {djGroups.map((group) => {
              const isExpanded = expandedDjs.has(group.djUsername);
              return (
                <div key={group.djUsername} className="bg-[#1a1a1a] rounded-lg overflow-hidden">
                  {/* DJ Header - Clickable to expand/collapse */}
                  <button
                    onClick={() => toggleDj(group.djUsername)}
                    className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {group.djPhotoUrl ? (
                        <img
                          src={group.djPhotoUrl}
                          alt={group.djUsername}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-accent/20 rounded-full flex items-center justify-center">
                          <span className="text-accent font-medium">
                            {group.djUsername.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className="text-left">
                        <p className="text-white font-medium">{group.djUsername}</p>
                        <p className="text-gray-500 text-sm">
                          {group.tips.length} tip{group.tips.length !== 1 ? 's' : ''} · Total: {formatAmount(group.totalAmountCents)}
                        </p>
                      </div>
                    </div>
                    <svg
                      className={`w-5 h-5 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Expanded Tips List */}
                  {isExpanded && (
                    <div className="border-t border-gray-800">
                      {group.tips.map((tip, index) => (
                        <div
                          key={tip.id}
                          className={`p-4 ${index !== group.tips.length - 1 ? 'border-b border-gray-800/50' : ''}`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-white font-medium">{formatAmount(tip.tipAmountCents)}</span>
                            <span className="text-gray-500 text-sm">{formatDate(tip.createdAt)}</span>
                          </div>
                          {tip.showName && (
                            <p className="text-gray-500 text-sm mb-2">{tip.showName}</p>
                          )}
                          <div className="bg-black/30 rounded-lg p-3">
                            <p className="text-gray-400 text-xs mb-1">Message from {group.djUsername}:</p>
                            <p className="text-white text-sm italic">&ldquo;{tip.djThankYouMessage}&rdquo;</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isAuthenticated && djGroups.length > 0 && (
          <p className="text-gray-600 text-xs text-center mt-6">
            Tip history is stored locally on this device.
            Sign in to sync your tips across devices.
          </p>
        )}
      </main>
    </div>
  );
}
