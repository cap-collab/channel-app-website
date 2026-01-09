'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthContext } from '@/contexts/AuthContext';
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

export function InboxClient() {
  const { user, isAuthenticated } = useAuthContext();
  const [djGroups, setDjGroups] = useState<DJTipGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDjs, setExpandedDjs] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function loadTips() {
      setLoading(true);

      if (isAuthenticated && user?.uid) {
        // Fetch from API for logged-in users
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
      } else {
        // Use localStorage for guest users
        const localTips = getTipHistoryFromLocalStorage();
        const groups = groupTipsByDJ(localTips);
        setDjGroups(groups);
      }

      setLoading(false);
    }

    loadTips();
  }, [isAuthenticated, user?.uid]);

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
          <h1 className="text-lg font-medium text-white">Your Support</h1>
          <div className="w-10" />
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
          </div>
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
