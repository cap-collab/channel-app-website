'use client';

import { useState, useEffect, useCallback } from 'react';
import { getAuth } from 'firebase/auth';
import { tempoLabel } from '@/lib/tempo';
import type {
  RecommendationSnapshot,
  RecommendationContext,
  ScoredCandidate,
  SnapshotSection,
  RecommendationConfig,
  TasteSummary,
} from '@/lib/recommendations/types';

// Read-only admin preview of the three recommendation sections for any user,
// with score breakdowns + reasons + an "excluded" panel — so you can trust the
// output before emails send. Preview is always LIVE (no persist, ignores the
// 48h floor). "Force regenerate" persists a fresh snapshot, bypassing the floor.

type UserRow = { uid: string; email: string; displayName: string };

async function getAuthToken(): Promise<string | null> {
  const user = getAuth().currentUser;
  if (!user) return null;
  return user.getIdToken();
}

function fmtScore(n: number): string {
  return n.toFixed(3);
}

export function RecommendationsTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [filter, setFilter] = useState('');
  const [context, setContext] = useState<RecommendationContext>('website');
  const [snapshot, setSnapshot] = useState<RecommendationSnapshot | null>(null);
  const [dropped, setDropped] = useState<ScoredCandidate[]>([]);
  const [config, setConfig] = useState<RecommendationConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showExcluded, setShowExcluded] = useState(false);

  // Load users + config once.
  useEffect(() => {
    (async () => {
      const token = await getAuthToken();
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };
      try {
        const [uRes, cRes] = await Promise.all([
          fetch('/api/admin/recommendations/users', { headers }),
          fetch('/api/admin/recommendations/config', { headers }),
        ]);
        if (uRes.ok) {
          const data = await uRes.json();
          setUsers(data.users || []);
          // Default-select cap@channel-app.com for a quick self-check.
          const cap = (data.users as UserRow[]).find((u) => u.email === 'cap@channel-app.com');
          if (cap) setSelectedUid(cap.uid);
        }
        if (cRes.ok) {
          const data = await cRes.json();
          setConfig(data.config);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
  }, []);

  const runPreview = useCallback(
    async (force: boolean) => {
      if (!selectedUid) return;
      setLoading(true);
      setError(null);
      try {
        const token = await getAuthToken();
        if (!token) throw new Error('Not authenticated');
        const res = await fetch('/api/admin/recommendations/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ uid: selectedUid, context, force }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Preview failed (${res.status})`);
        }
        const data = await res.json();
        setSnapshot(data.snapshot);
        setDropped(data.dropped || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Preview failed');
        setSnapshot(null);
        setDropped([]);
      } finally {
        setLoading(false);
      }
    },
    [selectedUid, context],
  );

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = filter
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(filter.toLowerCase()) ||
          u.displayName.toLowerCase().includes(filter.toLowerCase()),
      )
    : users;

  return (
    <div className="text-gray-200">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="flex flex-col">
          <label className="text-xs text-gray-400 mb-1">User</label>
          <input
            type="text"
            placeholder="filter by email…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-1 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-200 text-sm border border-gray-700 w-64"
          />
          <select
            value={selectedUid}
            onChange={(e) => setSelectedUid(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-800 text-gray-200 text-sm border border-gray-700 w-64"
          >
            <option value="">Select a user…</option>
            {filtered.slice(0, 200).map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.email}
                {u.displayName ? ` (${u.displayName})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="text-xs text-gray-400 mb-1">Context</label>
          <select
            value={context}
            onChange={(e) => setContext(e.target.value as RecommendationContext)}
            className="px-3 py-2 rounded-lg bg-gray-800 text-gray-200 text-sm border border-gray-700"
          >
            <option value="website">website</option>
            <option value="weekly-email">weekly-email</option>
          </select>
        </div>

        <button
          onClick={() => runPreview(false)}
          disabled={!selectedUid || loading}
          className="px-4 py-2 rounded-lg font-medium bg-white text-black disabled:opacity-40"
        >
          {loading ? 'Generating…' : 'Preview (live)'}
        </button>
        <button
          onClick={() => runPreview(true)}
          disabled={!selectedUid || loading}
          className="px-4 py-2 rounded-lg font-medium bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40"
          title="Persist a fresh snapshot, bypassing the 48h floor"
        >
          Force regenerate & save
        </button>
      </div>

      {error && <div className="mb-4 text-red-400 text-sm">{error}</div>}

      {/* Config readout (read-only) */}
      {config && (
        <div className="mb-6 text-xs text-gray-500">
          weights: priority {config.weights.priority} · recency {config.weights.recency} ·
          section {config.weights.sectionBonus} | recency half-life {config.recency.halfLifeDays}d /
          window {config.recency.windowDays}d | maxPerDj {config.diversity.maxPerDj} | 48h floor{' '}
          {Math.round(config.minRegenIntervalMs / 3_600_000)}h
        </div>
      )}

      {/* What we're basing recs on */}
      {snapshot && <TasteHeader summary={snapshot.tasteSummary} />}

      {/* Sections */}
      {snapshot && (
        <div className="space-y-8">
          {snapshot.sections.map((section) => (
            <SectionView key={section.id} section={section} expanded={expanded} toggle={toggle} />
          ))}

          {/* Excluded panel */}
          <div>
            <button
              onClick={() => setShowExcluded((v) => !v)}
              className="text-sm text-gray-400 hover:text-gray-200"
            >
              {showExcluded ? '▾' : '▸'} Excluded ({dropped.length})
            </button>
            {showExcluded && (
              <div className="mt-2 space-y-1">
                {dropped.map((d) => (
                  <div key={d.item.id} className="text-xs text-gray-500 flex justify-between border-b border-gray-800 py-1">
                    <span>{d.item.showName}</span>
                    <span className="text-amber-500/80">{d.excludedReason}</span>
                  </div>
                ))}
                {dropped.length === 0 && <div className="text-xs text-gray-600">Nothing excluded.</div>}
              </div>
            )}
          </div>

          <div className="text-xs text-gray-600">
            generated {new Date(snapshot.generatedAtMs).toLocaleString()} · by {snapshot.generatedBy} ·
            config v{snapshot.configVersion}
          </div>
        </div>
      )}
    </div>
  );
}

function TasteHeader({ summary }: { summary: TasteSummary }) {
  const hasAnything =
    summary.lovedDjs.length ||
    summary.streamedDjs.length ||
    summary.watchlistDjs.length ||
    summary.archivesStreamed;

  return (
    <div className="mb-6 rounded-lg bg-gray-900 border border-gray-800 p-4">
      <div className="text-sm font-semibold text-white mb-2">Based on what this user has done</div>
      {!hasAnything ? (
        <div className="text-sm text-gray-500">
          No engagement or watchlist yet — recommendations are cold-start (discovery + coming-up only).
        </div>
      ) : (
        <div className="space-y-2 text-xs text-gray-300">
          {summary.lovedDjs.length > 0 && (
            <Row label="Loved DJs" values={summary.lovedDjs} />
          )}
          {summary.streamedDjs.length > 0 && (
            <Row label="Streamed DJs" values={summary.streamedDjs} />
          )}
          {summary.watchlistDjs.length > 0 && (
            <Row label="Watchlist" values={summary.watchlistDjs} />
          )}
          <div className="text-gray-500">
            {summary.archivesStreamed} archive{summary.archivesStreamed === 1 ? '' : 's'} streamed
          </div>
          {summary.sceneCounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-gray-500 mr-1">Scenes engaged:</span>
              {summary.sceneCounts.map((s) => (
                <span key={s.scene} className="px-2 py-0.5 rounded-full bg-gray-800 text-gray-300">
                  {s.scene} ×{s.count}
                </span>
              ))}
            </div>
          )}
          {summary.tempoCounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-gray-500 mr-1">Tempos engaged:</span>
              {summary.tempoCounts.map((t) => (
                <span key={t.tempo} className="px-2 py-0.5 rounded-full bg-gray-800 text-gray-300">
                  {tempoLabel(t.tempo) ?? t.tempo} ×{t.count}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-500 shrink-0 w-24">{label}:</span>
      <span className="text-gray-300">{values.join(', ')}</span>
    </div>
  );
}

function SectionView({
  section,
  expanded,
  toggle,
}: {
  section: SnapshotSection;
  expanded: Set<string>;
  toggle: (id: string) => void;
}) {
  const isComingUp = section.id === 'coming-up';
  const count = isComingUp ? section.comingUp?.length ?? 0 : section.items.length;

  return (
    <div>
      <h3 className="text-lg font-semibold text-white mb-3">
        {section.title} <span className="text-gray-500 text-sm">({count})</span>
      </h3>

      {isComingUp ? (
        <div className="space-y-1">
          {(section.comingUp ?? []).map((c) => (
            <div key={c.showId} className="flex justify-between text-sm border-b border-gray-800 py-2">
              <span className="text-gray-200">{c.showName}</span>
              <span className="text-gray-500">
                {new Date(c.startTimeMs).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · {c.reason}
              </span>
            </div>
          ))}
          {count === 0 && <div className="text-sm text-gray-600">No upcoming shows matched.</div>}
        </div>
      ) : (
        <div className="space-y-2">
          {section.items.map((item) => {
            const id = `${section.id}-${item.archiveId}`;
            const open = expanded.has(id);
            const sum = item.scoreBreakdown.reduce((s, c) => s + c.contribution, 0);
            return (
              <div key={id} className="rounded-lg bg-gray-900 border border-gray-800 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-gray-500 text-sm w-6 text-right">{item.rank}</span>
                    {item.showImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.showImageUrl} alt="" className="w-10 h-10 rounded object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-gray-800" />
                    )}
                    <div className="min-w-0">
                      <div className="text-gray-100 text-sm truncate">
                        {item.showName}
                        {item.pinned && <span className="ml-2 text-emerald-400 text-xs">★ pinned</span>}
                        {item.isFallback && <span className="ml-2 text-blue-400 text-xs">fallback</span>}
                      </div>
                      <div className="text-gray-500 text-xs truncate">
                        {item.djDisplayNames.join(', ')}
                        {item.sceneSlugs.length > 0 && ` · ${item.sceneSlugs.join(', ')}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-gray-300 text-sm font-mono">{fmtScore(item.score)}</span>
                    <button onClick={() => toggle(id)} className="text-gray-500 hover:text-gray-300 text-xs">
                      {open ? 'hide' : 'breakdown'}
                    </button>
                  </div>
                </div>

                {/* Reasons */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.reasons.map((r, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 text-xs">
                      {r}
                    </span>
                  ))}
                </div>

                {/* Breakdown table */}
                {open && (
                  <table className="mt-3 w-full text-xs text-gray-400">
                    <thead>
                      <tr className="text-gray-500">
                        <th className="text-left font-normal">component</th>
                        <th className="text-right font-normal">raw</th>
                        <th className="text-right font-normal">weight</th>
                        <th className="text-right font-normal">contribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.scoreBreakdown.map((c) => (
                        <tr key={c.name}>
                          <td>{c.name}</td>
                          <td className="text-right font-mono">{c.rawValue.toFixed(3)}</td>
                          <td className="text-right font-mono">{c.weight}</td>
                          <td className="text-right font-mono">{c.contribution.toFixed(3)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-gray-700 text-gray-300">
                        <td colSpan={3} className="text-right pr-2">
                          sum
                        </td>
                        <td className="text-right font-mono">{sum.toFixed(3)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
          {count === 0 && <div className="text-sm text-gray-600">No items.</div>}
        </div>
      )}
    </div>
  );
}
