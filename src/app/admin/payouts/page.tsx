'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole, isBroadcaster } from '@/hooks/useUserRole';
import { BroadcastHeader } from '@/components/BroadcastHeader';

type PayoutStatus = 'all' | 'pending' | 'transferred' | 'reallocated_to_pool';

interface TipRecord {
  id: string;
  createdAt: number;
  djUserId: string;
  djUsername: string;
  djEmail?: string;
  tipAmountCents: number;
  payoutStatus: string;
  transferredAt?: number;
  reallocatedAt?: number;
}

interface PayoutStats {
  pending: { cents: number; count: number };
  transferred: { cents: number; count: number };
  reallocated: { cents: number; count: number };
}

export default function AdminPayoutsPage() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);

  const [stats, setStats] = useState<PayoutStats | null>(null);
  const [tips, setTips] = useState<TipRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PayoutStatus>('all');

  const hasAccess = isBroadcaster(role);

  const fetchPayouts = useCallback(async (status: PayoutStatus) => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const url = status === 'all'
        ? '/api/admin/payouts'
        : `/api/admin/payouts?status=${status}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch payouts');
      }

      const data = await response.json();
      setStats(data.stats);
      setTips(data.tips);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Initial load
  useEffect(() => {
    if (isAuthenticated && hasAccess) {
      fetchPayouts(statusFilter);
    } else if (!authLoading && !roleLoading) {
      setIsLoading(false);
    }
  }, [isAuthenticated, hasAccess, authLoading, roleLoading, fetchPayouts, statusFilter]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/radio-portal');
    }
  }, [authLoading, isAuthenticated, router]);

  const handleFilterChange = (status: PayoutStatus) => {
    setStatusFilter(status);
    fetchPayouts(status);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatCents = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
      case 'pending_dj_account':
        return (
          <span className="px-2 py-1 text-xs rounded-full bg-yellow-500/20 text-yellow-400">
            Pending
          </span>
        );
      case 'transferred':
        return (
          <span className="px-2 py-1 text-xs rounded-full bg-green-500/20 text-green-400">
            Transferred
          </span>
        );
      case 'reallocated_to_pool':
        return (
          <span className="px-2 py-1 text-xs rounded-full bg-blue-500/20 text-blue-400">
            Support Pool
          </span>
        );
      default:
        return (
          <span className="px-2 py-1 text-xs rounded-full bg-gray-500/20 text-gray-400">
            {status}
          </span>
        );
    }
  };

  // Loading states
  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen bg-black">
        <BroadcastHeader />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 60px)' }}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-black">
        <BroadcastHeader />
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 60px)' }}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
        </div>
      </div>
    );
  }

  // Not authorized
  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-black">
        <BroadcastHeader />
        <div className="flex items-center justify-center p-8" style={{ minHeight: 'calc(100vh - 60px)' }}>
          <div className="bg-[#1a1a1a] rounded-xl p-8 max-w-md text-center">
            <div className="w-16 h-16 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-white mb-2">Access Denied</h1>
            <p className="text-gray-400">
              You don&apos;t have permission to view this page.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <BroadcastHeader />
      <div className="p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold mb-6">Payouts Overview</h1>

          {/* Stats Cards */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {/* Pending */}
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-yellow-500/20">
                    <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <span className="text-yellow-400 font-medium">Pending</span>
                </div>
                <p className="text-2xl font-bold text-white">{formatCents(stats.pending.cents)}</p>
                <p className="text-sm text-gray-400">{stats.pending.count} tips</p>
              </div>

              {/* Transferred */}
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-500/20">
                    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-green-400 font-medium">Transferred</span>
                </div>
                <p className="text-2xl font-bold text-white">{formatCents(stats.transferred.cents)}</p>
                <p className="text-sm text-gray-400">{stats.transferred.count} tips</p>
              </div>

              {/* Support Pool */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-blue-500/20">
                    <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <span className="text-blue-400 font-medium">Support Pool</span>
                </div>
                <p className="text-2xl font-bold text-white">{formatCents(stats.reallocated.cents)}</p>
                <p className="text-sm text-gray-400">{stats.reallocated.count} reallocated</p>
              </div>
            </div>
          )}

          {/* Filter Tabs */}
          <div className="flex gap-2 mb-6 overflow-x-auto">
            <button
              onClick={() => handleFilterChange('all')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
                statusFilter === 'all'
                  ? 'bg-white text-black'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              All
            </button>
            <button
              onClick={() => handleFilterChange('pending')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
                statusFilter === 'pending'
                  ? 'bg-yellow-500 text-black'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Pending
            </button>
            <button
              onClick={() => handleFilterChange('transferred')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
                statusFilter === 'transferred'
                  ? 'bg-green-500 text-black'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Transferred
            </button>
            <button
              onClick={() => handleFilterChange('reallocated_to_pool')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
                statusFilter === 'reallocated_to_pool'
                  ? 'bg-blue-500 text-black'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Support Pool
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400">
              {error}
            </div>
          )}

          {/* Tips Table */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
          ) : tips.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-gray-500">No tips found</p>
            </div>
          ) : (
            <div className="bg-[#1a1a1a] rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left p-4 text-gray-400 font-medium">Date</th>
                      <th className="text-left p-4 text-gray-400 font-medium">DJ</th>
                      <th className="text-right p-4 text-gray-400 font-medium">Amount</th>
                      <th className="text-center p-4 text-gray-400 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tips.map((tip) => (
                      <tr key={tip.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="p-4 text-gray-300 text-sm">
                          {formatDate(tip.createdAt)}
                        </td>
                        <td className="p-4">
                          <div className="text-white">{tip.djUsername}</div>
                          {tip.djEmail && (
                            <div className="text-gray-500 text-xs">{tip.djEmail}</div>
                          )}
                        </td>
                        <td className="p-4 text-right text-white font-medium">
                          {formatCents(tip.tipAmountCents)}
                        </td>
                        <td className="p-4 text-center">
                          {getStatusBadge(tip.payoutStatus)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
