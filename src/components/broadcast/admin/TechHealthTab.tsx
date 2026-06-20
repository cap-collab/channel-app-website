'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import type { TechHealthResponse } from '@/app/api/admin/tech-health/route';

function diskClass(pct: number): string {
  if (pct >= 85) return 'text-red-400';
  if (pct >= 70) return 'text-yellow-400';
  return 'text-green-400';
}

function fmtAgo(ms: number | null | undefined): string {
  if (!ms) return '—';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtUntil(ms: number): string {
  const s = Math.floor((ms - Date.now()) / 1000);
  if (s < 0) return `${Math.abs(Math.floor(s / 60))}m ago`;
  if (s < 60) return `in ${s}s`;
  if (s < 3600) return `in ${Math.floor(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86400)}d`;
}

export function TechHealthTab() {
  const { user } = useAuthContext();
  const [data, setData] = useState<TechHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/tech-health', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as TechHealthResponse;
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Tech Health</h2>
          <p className="text-sm text-gray-400 mt-1">
            {data?.generatedAt ? `Last refreshed ${fmtAgo(data.generatedAt)}` : 'Loading…'}
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="px-4 py-2 bg-white text-black font-bold hover:bg-zinc-200 disabled:opacity-50 text-sm"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-200 p-3 text-sm">
          Failed to load: {error}
        </div>
      )}

      {!data && !error && (
        <div className="text-gray-400 text-sm">Probing systems…</div>
      )}

      {data && (
        <>
          {/* LiveKit room */}
          <section>
            <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-2">LiveKit room</h3>
            <div className="bg-[#1e1e1e] border border-white/10 p-4 space-y-2 text-sm">
              {!data.livekit.reachable && (
                <div className="text-red-400">Unreachable: {data.livekit.error}</div>
              )}
              {/* Real listener count (web + mobile) from Firebase presence — shown
                  even if the LiveKit probe failed, since it's read independently. */}
              <Row label="Listeners (now)" value={
                <span className="font-bold">
                  {data.livekit.listenerCount === null ? 'n/a' : String(data.livekit.listenerCount)}
                </span>
              } />
              {data.livekit.reachable && (
                <>
                  <Row label="Live now" value={
                    <span className={data.livekit.isLive ? 'text-green-400 font-bold' : 'text-gray-400'}>
                      {data.livekit.isLive ? `Yes (${data.livekit.currentDJ})` : 'No'}
                    </span>
                  } />
                  <Row label="Audio posting" value={<OnOff on={data.livekit.postingOn} />} />
                  <Row label="Audible on website" value={<OnOff on={data.livekit.audibleOn} />} />
                  <Row label="Recording" value={<OnOff on={data.livekit.recordingOn} />} />
                  <Row label="Connections" value={
                    <span className="text-gray-300">
                      web: {data.livekit.webCount} · machinery: {data.livekit.machineryCount}
                      <span className="text-gray-500"> (raw {data.livekit.participantCount}, WebRTC only)</span>
                    </span>
                  } />
                  <Row label="Active egresses" value={
                    <span className={data.livekit.staleEgressCount > 0 ? 'text-yellow-400' : ''}>
                      {data.livekit.egressCount}
                      {data.livekit.staleEgressCount > 0 && ` (${data.livekit.staleEgressCount} stale >12h)`}
                    </span>
                  } />
                  <Row label="Active ingresses" value={String(data.livekit.ingressCount)} />
                </>
              )}
            </div>
          </section>

          {/* Workers */}
          <section>
            <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-2">Workers</h3>
            <div className="space-y-3">
              {data.workers.map((w) => (
                <div key={w.name} className="bg-[#1e1e1e] border border-white/10 p-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-white">{w.name}</div>
                    <div className={w.reachable ? 'text-green-400 text-xs' : 'text-red-400 text-xs'}>
                      {w.reachable ? '● healthy' : `● unreachable${w.error ? ` (${w.error})` : ''}`}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 font-mono">{w.url}</div>
                  {w.reachable && (
                    <>
                      {w.disk && (
                        <Row label="Disk" value={
                          <span className={diskClass(w.disk.pct)}>
                            {w.disk.usedGb.toFixed(1)} / {w.disk.totalGb.toFixed(1)} GB ({w.disk.pct}%)
                          </span>
                        } />
                      )}
                      {w.lastJob && (
                        <Row label="Last job" value={
                          w.lastJob.at === null ? (
                            <span className="text-gray-500">never</span>
                          ) : (
                            <span className={w.lastJob.ok ? 'text-green-400' : 'text-red-400'}>
                              {w.lastJob.ok ? '✓' : '✗'} {w.lastJob.kind ? `${w.lastJob.kind} · ` : ''}{fmtAgo(w.lastJob.at)}
                              {!w.lastJob.ok && w.lastJob.error && (
                                <span className="block text-xs text-red-300 mt-0.5">{w.lastJob.error}</span>
                              )}
                            </span>
                          )
                        } />
                      )}
                      {w.lastCleanup && (
                        <Row label="Last cleanup" value={
                          w.lastCleanup.at === null ? (
                            <span className="text-gray-500">never</span>
                          ) : (
                            <span className={w.lastCleanup.ok ? 'text-green-400' : 'text-red-400'}>
                              {w.lastCleanup.ok ? '✓' : '✗'} {fmtAgo(w.lastCleanup.at)}
                              {!w.lastCleanup.ok && w.lastCleanup.error && (
                                <span className="block text-xs text-red-300 mt-0.5">{w.lastCleanup.error}</span>
                              )}
                            </span>
                          )
                        } />
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Normalize queue */}
          <section>
            <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-2">Normalize queue</h3>
            <div className="bg-[#1e1e1e] border border-white/10 p-4 space-y-2 text-sm">
              <Row label="Pending" value={
                <span className={data.normalizeQueue.pending > 5 ? 'text-yellow-400' : ''}>
                  {data.normalizeQueue.pending}
                </span>
              } />
              {data.normalizeQueue.pendingItems && data.normalizeQueue.pendingItems.length > 0 && (
                <ul className="pl-3 border-l border-white/10 space-y-1">
                  {data.normalizeQueue.pendingItems.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2">
                      <span className="text-white truncate">{item.showName}</span>
                      <span className="text-gray-500 text-xs flex-shrink-0">
                        {item.ageMin >= 60
                          ? `${Math.floor(item.ageMin / 60)}h ${item.ageMin % 60}m`
                          : `${item.ageMin}m`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Row label="In progress" value={String(data.normalizeQueue.inProgress)} />
              {data.normalizeQueue.oldestPendingAgeMin !== null && (
                <Row label="Oldest pending" value={
                  <span className={data.normalizeQueue.oldestPendingAgeMin > 60 ? 'text-yellow-400' : ''}>
                    {data.normalizeQueue.oldestPendingAgeMin >= 60
                      ? `${Math.floor(data.normalizeQueue.oldestPendingAgeMin / 60)}h ${data.normalizeQueue.oldestPendingAgeMin % 60}m`
                      : `${data.normalizeQueue.oldestPendingAgeMin}m`}
                  </span>
                } />
              )}
              <Row label="Done last 24h" value={String(data.normalizeQueue.doneLast24h)} />
              <Row label="Failed last 24h" value={
                <span className={data.normalizeQueue.failedLast24h > 0 ? 'text-red-400' : ''}>
                  {data.normalizeQueue.failedLast24h}
                </span>
              } />
            </div>
          </section>

          {/* Upcoming */}
          {data.upcomingSlots.length > 0 && (
            <section>
              <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-2">Upcoming (next 12h)</h3>
              <div className="bg-[#1e1e1e] border border-white/10 divide-y divide-white/5 text-sm">
                {data.upcomingSlots.map((s) => (
                  <div key={s.slotId} className="p-3 flex items-center justify-between">
                    <div>
                      <div className="text-white">{s.djName}</div>
                      <div className="text-xs text-gray-500">{s.type}</div>
                    </div>
                    <div className="text-gray-400 text-xs">{fmtUntil(s.startMs)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* R2 storage. Unlike disk, R2 has no hard ceiling — pay-as-you-go.
              So we show usage in GB and surface "% orphan" as the reclaimable
              chunk, since that's the only thing actionable from here. */}
          {data.r2Stats && (() => {
            const totalBytes = data.r2Stats.referenced.bytes + data.r2Stats.orphan.bytes + data.r2Stats.hls.bytes + data.r2Stats.test.bytes;
            const totalGb = totalBytes / 1024 / 1024 / 1024;
            const refGb = data.r2Stats.referenced.bytes / 1024 / 1024 / 1024;
            const orphanGb = data.r2Stats.orphan.bytes / 1024 / 1024 / 1024;
            const orphanPct = totalBytes > 0 ? Math.round((data.r2Stats.orphan.bytes / totalBytes) * 100) : 0;
            const monthlyCostUsd = (totalGb * 0.015).toFixed(2);
            return (
              <section>
                <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-2">R2 storage</h3>
                <div className="bg-[#1e1e1e] border border-white/10 p-4 space-y-2 text-sm">
                  <Row label="Total used" value={
                    <span>{totalGb.toFixed(1)} GB · {data.r2Stats.totalObjects.toLocaleString()} objects</span>
                  } />
                  <Row label="Active recordings" value={
                    <span>{refGb.toFixed(1)} GB · {data.r2Stats.referenced.count} files</span>
                  } />
                  <Row label="Orphans (reclaimable)" value={
                    <span className={orphanPct >= 50 ? 'text-yellow-400' : 'text-gray-300'}>
                      {orphanGb.toFixed(1)} GB · {data.r2Stats.orphan.count} files ({orphanPct}%)
                    </span>
                  } />
                  <Row label="Est. monthly cost" value={<span className="text-gray-300">~${monthlyCostUsd}</span>} />
                  <div className="text-xs text-gray-500 pt-1">
                    Snapshot from daily audit · {fmtAgo(data.r2Stats.generatedAt)} · R2 has no hard quota
                  </div>
                </div>
              </section>
            );
          })()}

          {/* R2 backup. Daily copy-only mirror of original recordings (DJ
              uploads + live-egress originals, pre-processing) to the
              channel-broadcast-backup bucket. Healthy = ran recently with no
              errors and nothing missing from source. */}
          <section>
            <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-2">R2 backup (originals)</h3>
            <div className="bg-[#1e1e1e] border border-white/10 p-4 space-y-2 text-sm">
              {!data.r2Backup ? (
                <div className="text-gray-500">Has not run yet — first backup at 11:00 UTC.</div>
              ) : (() => {
                const b = data.r2Backup;
                const ageMs = Date.now() - b.ranAt;
                const stale = ageMs > 2 * 24 * 60 * 60 * 1000; // daily cron; >2d = something's wrong
                const unhealthy = b.errorCount > 0 || b.missingFromSourceCount > 0;
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-white">channel-broadcast-backup</div>
                      <div className={unhealthy ? 'text-red-400 text-xs' : stale ? 'text-yellow-400 text-xs' : 'text-green-400 text-xs'}>
                        {unhealthy ? '● needs attention' : stale ? '● stale' : '● healthy'}
                      </div>
                    </div>
                    <Row label="Last run" value={
                      <span className={stale ? 'text-yellow-400' : ''}>{fmtAgo(b.ranAt)}</span>
                    } />
                    <Row label="Originals backed up" value={
                      <span>{b.totalOriginals - b.missingFromSourceCount} / {b.totalOriginals}</span>
                    } />
                    <Row label="Copied last run" value={String(b.copiedCount)} />
                    <Row label="Missing from source" value={
                      <span className={b.missingFromSourceCount > 0 ? 'text-red-400' : 'text-gray-300'}>
                        {b.missingFromSourceCount}
                      </span>
                    } />
                    <Row label="Errors last run" value={
                      <span className={b.errorCount > 0 ? 'text-red-400' : 'text-gray-300'}>{b.errorCount}</span>
                    } />
                    {b.missingFromSourceCount > 0 && (
                      <div className="text-xs text-red-300 pt-1 space-y-0.5">
                        {b.missingFromSource.slice(0, 5).map((k) => (
                          <div key={k} className="font-mono truncate">missing: {k}</div>
                        ))}
                        {b.missingFromSourceCount > 5 && <div>+{b.missingFromSourceCount - 5} more</div>}
                      </div>
                    )}
                    {b.errorCount > 0 && (
                      <div className="text-xs text-red-300 pt-1 space-y-0.5">
                        {b.errors.slice(0, 5).map((e) => (
                          <div key={e.key} className="font-mono truncate">{e.key}: {e.error}</div>
                        ))}
                      </div>
                    )}
                    <div className="text-xs text-gray-500 pt-1">
                      Copy-only mirror · daily 11:00 UTC · never deletes
                    </div>
                  </>
                );
              })()}
            </div>
          </section>

          <div className="text-xs text-gray-500 pt-2">
            Read-only snapshot. Use the Refresh button for an up-to-date view.
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}

function OnOff({ on }: { on: boolean }) {
  return (
    <span className={on ? 'text-green-400 font-bold' : 'text-gray-500'}>
      {on ? 'ON' : 'OFF'}
    </span>
  );
}
