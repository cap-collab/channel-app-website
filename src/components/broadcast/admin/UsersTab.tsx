'use client';

import { useState, useEffect, useCallback } from 'react';
import { getAuth } from 'firebase/auth';

// Admin "Users" tab. Lists every user, grouped DJs / listeners, with the
// engagement stats the weekly-recs backfill already computes (loves given,
// archives streamed) plus last-seen and an owns-a-collective chip.

interface UserRow {
  uid: string;
  label: string;
  email: string;
  role: string;
  isDJ: boolean;
  ownsCollective: boolean;
  lastSeenAtMs: number | null;
  lovesGiven: number;
  archivesStreamed: number;
  hasStats: boolean;
}

interface UsersResponse {
  djs: UserRow[];
  nonDjs: UserRow[];
  statsComputed: boolean;
  // Email-less waitlist/phantom docs excluded from the list (no real account).
  skippedNoEmail: number;
}

async function authToken(): Promise<string | null> {
  const user = getAuth().currentUser;
  return user ? user.getIdToken() : null;
}

function fmtLastSeen(ms: number | null): string {
  if (!ms) return '—';
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function UsersTab() {
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await authToken();
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const applyFilter = useCallback(
    (rows: UserRow[]) => {
      const q = filter.trim().toLowerCase();
      if (!q) return rows;
      return rows.filter(
        (r) => r.label.toLowerCase().includes(q) || r.email.toLowerCase().includes(q),
      );
    },
    [filter],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    );
  }
  if (error) {
    return <div className="text-red-400 py-8">Failed to load users: {error}</div>;
  }
  if (!data) return null;

  const djs = applyFilter(data.djs);
  const nonDjs = applyFilter(data.nonDjs);

  const renderRow = (r: UserRow) => (
    <div key={r.uid} className="border-b border-gray-800 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white truncate">{r.label}</span>
            {r.ownsCollective && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-purple-900 text-purple-200">
                collective
              </span>
            )}
          </div>
          {r.email && r.email !== r.label && (
            <div className="text-xs text-gray-500 truncate">{r.email}</div>
          )}
        </div>
        <div className="text-sm text-gray-400 flex items-center gap-4 shrink-0">
          <span title="DJ loves given">❤ {r.hasStats ? r.lovesGiven : '—'}</span>
          <span title="Archives streamed">▶ {r.hasStats ? r.archivesStreamed : '—'}</span>
          <span title="Last seen" className="w-20 text-right">{fmtLastSeen(r.lastSeenAtMs)}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl">
      {!data.statsComputed && (
        <div className="mb-4 text-xs text-yellow-500/80 bg-yellow-900/20 rounded px-3 py-2">
          Engagement counts haven&apos;t been computed yet — they populate on the next weekly-recommendations
          backfill run.
        </div>
      )}
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by username / email…"
        className="w-full px-3 py-2 mb-4 rounded-lg bg-gray-800 text-white placeholder-gray-500"
      />

      <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-1 mt-2">
        DJs <span className="text-gray-600">({djs.length})</span>
      </h3>
      <div className="mb-8">{djs.map(renderRow)}</div>

      <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-1">
        Listeners <span className="text-gray-600">({nonDjs.length})</span>
      </h3>
      <div>{nonDjs.map(renderRow)}</div>

      {data.skippedNoEmail > 0 && (
        <div className="mt-6 text-xs text-gray-600">
          {data.skippedNoEmail} email-less doc{data.skippedNoEmail === 1 ? '' : 's'} hidden (waitlist / phantom
          records with no real account).
        </div>
      )}
    </div>
  );
}
