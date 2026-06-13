'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ArchiveSerialized } from '@/types/broadcast';
import { LOOP_COLLECTION } from '@/lib/archive-schedule';

// A single editable item in the loop. Mirrors ScheduleItem but only the fields
// the admin UI needs to show/save.
interface UIItem {
  recordingUrl: string;
  durationSec: number;
  startOffsetSec: number;
  title?: string;
  // username is the chat-room key (chatUsernameNormalized).
  djs?: { name: string; username?: string; photoUrl?: string }[];
  artworkUrl?: string;
  archiveId?: string;
}

interface LoopDoc {
  exists: boolean;
  loopNumber: number;
  startTimeMs?: number;
  totalDurationSec?: number;
  generatedAtMs?: number;
  generatedBy?: 'cron' | 'admin';
  locked?: boolean;
  catalogStats?: { highCount: number; mediumCount: number; placedHighDurationSec?: number; placedMediumDurationSec?: number; interstitialCount?: number; totalItems: number } | null;
  items?: Array<UIItem>;
}

// Loop summary used by the picker — derived from the live loops snapshot.
interface LoopSummary {
  loopNumber: number;
  startTimeMs: number;
  totalDurationSec: number;
  catalogStats?: { highCount: number; mediumCount: number; placedHighDurationSec?: number; placedMediumDurationSec?: number; interstitialCount?: number; totalItems: number } | null;
  locked: boolean;
}

function formatPtClock(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatPtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

interface ArchivePickerProps {
  archives: ArchiveSerialized[];
  onPick: (archive: ArchiveSerialized) => void;
  onClose: () => void;
}

function ArchivePicker({ archives, onPick, onClose }: ArchivePickerProps) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return archives;
    return archives.filter((a) => {
      if (a.showName?.toLowerCase().includes(q)) return true;
      if (a.slug?.toLowerCase().includes(q)) return true;
      return a.djs?.some((d) => d.name?.toLowerCase().includes(q));
    });
  }, [archives, search]);

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-white/10 w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-white/10">
          <input
            autoFocus
            placeholder="Search by show name or DJ"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-black/60 border border-white/15 px-3 py-2 text-white placeholder-zinc-500"
          />
          <p className="text-xs text-zinc-500 mt-2">
            {filtered.length} of {archives.length} archives · high + medium priority only
          </p>
        </div>
        <div className="overflow-y-auto flex-1">
          {filtered.map((a) => {
            const photo = a.showImageUrl || a.djs?.[0]?.photoUrl;
            const djs = a.djs?.map((d) => d.name).join(', ') || '';
            return (
              <button
                key={a.id}
                onClick={() => onPick(a)}
                className="w-full flex items-center gap-3 p-3 hover:bg-white/5 text-left border-b border-white/5"
              >
                <div className="w-12 h-12 bg-zinc-800 flex-shrink-0 overflow-hidden relative">
                  {photo && (
                    <Image src={photo} alt="" fill className="object-cover" sizes="48px" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-white text-sm font-semibold truncate">{a.showName || a.slug}</div>
                  <div className="text-zinc-400 text-xs truncate">{djs}</div>
                </div>
                <div className="text-zinc-500 text-xs flex-shrink-0">
                  {formatDuration(a.duration || 0)} · {a.priority || 'medium'}
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="p-6 text-center text-zinc-500 text-sm">No matches.</p>
          )}
        </div>
        <div className="p-3 border-t border-white/10 flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-zinc-300 hover:text-white">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function ArchiveRadioTab() {
  const [loops, setLoops] = useState<LoopSummary[]>([]);
  const [selectedLoopNumber, setSelectedLoopNumber] = useState<number | null>(null);
  const [loopDoc, setLoopDoc] = useState<LoopDoc | null>(null);
  const [items, setItems] = useState<UIItem[]>([]);
  const [archives, setArchives] = useState<ArchiveSerialized[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [ensuring, setEnsuring] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  // Tick once a minute so the "currently playing" highlight advances when a
  // loop boundary crosses without a new doc landing.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Live subscription to the latest 5 loops by loopNumber.
  useEffect(() => {
    if (!db) return;
    const q = query(
      collection(db, LOOP_COLLECTION),
      orderBy('loopNumber', 'desc'),
      limit(5),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: LoopSummary[] = [];
      for (const d of snap.docs) {
        const data = d.data();
        next.push({
          loopNumber: Number(data.loopNumber ?? 0),
          startTimeMs: Number(data.startTimeMs ?? 0),
          totalDurationSec: Number(data.totalDurationSec ?? 0),
          catalogStats: (data.catalogStats as LoopSummary['catalogStats']) ?? null,
          locked: Boolean(data.locked),
        });
      }
      setLoops(next);
      // Default selection: the loop currently playing. If no loops exist,
      // clear loading so the empty-state UI can render (otherwise the spinner
      // would stay forever — loadLoop is what flips loading false, and it
      // only runs once selectedLoopNumber is set).
      setSelectedLoopNumber((prev) => {
        if (prev != null && next.some((l) => l.loopNumber === prev)) return prev;
        const playing = next.find((l) => l.startTimeMs <= Date.now()) ?? next[0];
        return playing ? playing.loopNumber : null;
      });
      if (next.length === 0) setLoading(false);
    }, (err) => {
      console.error('[ArchiveRadioTab] loops subscribe error', err);
      setLoading(false);
      setError(err instanceof Error ? err.message : 'Failed to subscribe to loops');
    });
    return unsub;
  }, []);

  // Fetch archives once; the picker reuses the list.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/archives?includePrivate=true&includeHidden=false')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const all: ArchiveSerialized[] = data.archives ?? [];
        const eligible = all.filter((a) => {
          if (!a.recordingUrl || !(a.duration && a.duration >= 30 * 60)) return false;
          const p = a.priority || 'medium';
          return p === 'high' || p === 'medium';
        });
        setArchives(eligible);
      })
      .catch((err) => {
        console.error('[ArchiveRadioTab] fetch archives', err);
      });
    return () => { cancelled = true; };
  }, []);

  const loadLoop = useCallback(async (loopNumber: number) => {
    setLoading(true);
    setError(null);
    setDirty(false);
    try {
      const res = await fetch(`/api/admin/archive-radio-loop/${loopNumber}`);
      const data: LoopDoc = await res.json();
      setLoopDoc(data);
      const itemsRaw = data.items ?? [];
      setItems(itemsRaw.map((it) => ({
        recordingUrl: it.recordingUrl,
        durationSec: it.durationSec,
        startOffsetSec: it.startOffsetSec,
        title: it.title,
        djs: it.djs,
        artworkUrl: it.artworkUrl,
        archiveId: it.archiveId,
      })));
    } catch (err) {
      console.error('[ArchiveRadioTab] load loop', err);
      setError(err instanceof Error ? err.message : 'Failed to load loop');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedLoopNumber != null) void loadLoop(selectedLoopNumber);
  }, [selectedLoopNumber, loadLoop]);

  // Recompute startOffsetSec from current item order whenever the items list
  // mutates. Back-to-back packing.
  const reflow = useCallback((arr: UIItem[]): UIItem[] => {
    let cursor = 0;
    return arr.map((it) => {
      const next: UIItem = { ...it, startOffsetSec: cursor };
      cursor += it.durationSec;
      return next;
    });
  }, []);

  const handleRegenerate = async () => {
    if (selectedLoopNumber == null) return;
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/archive-radio-loop/${selectedLoopNumber}/regenerate`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Regenerate failed');
      await loadLoop(selectedLoopNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate');
    } finally {
      setRegenerating(false);
    }
  };

  const handleEnsureNext = async () => {
    setEnsuring(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/archive-radio-loop/ensure-next', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error || 'Ensure-next failed');
      // The latest-loops subscription will pick up the new loop automatically.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to ensure next loop');
    } finally {
      setEnsuring(false);
    }
  };

  const handleSave = async () => {
    if (selectedLoopNumber == null) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        items: items.map((it) => ({
          kind: 'archive',
          recordingUrl: it.recordingUrl,
          durationSec: it.durationSec,
          startOffsetSec: it.startOffsetSec,
          title: it.title,
          djs: it.djs,
          artworkUrl: it.artworkUrl,
          archiveId: it.archiveId,
        })),
        locked: loopDoc?.locked ?? false,
      };
      const res = await fetch(`/api/admin/archive-radio-loop/${selectedLoopNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      await loadLoop(selectedLoopNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleLock = async () => {
    if (selectedLoopNumber == null) return;
    const next = !(loopDoc?.locked ?? false);
    try {
      await fetch(`/api/admin/archive-radio-loop/${selectedLoopNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map((it) => ({ ...it, kind: 'archive' })), locked: next }),
      });
      setLoopDoc((prev) => (prev ? { ...prev, locked: next } : prev));
    } catch (err) {
      console.error('[ArchiveRadioTab] toggle lock', err);
    }
  };

  const handleRemove = (index: number) => {
    setItems((prev) => reflow(prev.filter((_, i) => i !== index)));
    setDirty(true);
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return reflow(next);
    });
    setDirty(true);
  };

  const handleSwap = (index: number, archive: ArchiveSerialized) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = {
        recordingUrl: archive.recordingUrl,
        durationSec: archive.duration || 0,
        startOffsetSec: 0,
        title: archive.showName || archive.slug,
        djs: archive.djs?.map((d) => ({ name: d.name, username: d.username, photoUrl: d.photoUrl })),
        artworkUrl: archive.showImageUrl,
        archiveId: archive.id,
      };
      return reflow(next);
    });
    setPickerSlot(null);
    setDirty(true);
  };

  const handleInsert = (insertIndex: number, archive: ArchiveSerialized) => {
    setItems((prev) => {
      const next = [...prev];
      const newItem: UIItem = {
        recordingUrl: archive.recordingUrl,
        durationSec: archive.duration || 0,
        startOffsetSec: 0,
        title: archive.showName || archive.slug,
        djs: archive.djs?.map((d) => ({ name: d.name, username: d.username, photoUrl: d.photoUrl })),
        artworkUrl: archive.showImageUrl,
        archiveId: archive.id,
      };
      const at = Math.min(Math.max(0, insertIndex), next.length);
      next.splice(at, 0, newItem);
      return reflow(next);
    });
    setPickerSlot(null);
    setDirty(true);
  };

  // Loops sorted ascending by loopNumber for display.
  const loopList = useMemo(() => loops.slice().sort((a, b) => a.loopNumber - b.loopNumber), [loops]);
  const selectedLoop = useMemo(
    () => loopList.find((l) => l.loopNumber === selectedLoopNumber),
    [loopList, selectedLoopNumber],
  );
  const selectedStartMs = selectedLoop?.startTimeMs ?? 0;

  return (
    <div className="text-white">
      {/* Loop picker */}
      <div className="flex flex-wrap gap-2 mb-4">
        {loopList.length === 0 && (
          <div className="text-sm text-zinc-500">No loops yet. Generate one with “Ensure next loop”.</div>
        )}
        {loopList.map((l) => {
          const isPlaying = l.startTimeMs <= now && now < l.startTimeMs + l.totalDurationSec * 1000;
          const isSelected = selectedLoopNumber === l.loopNumber;
          const stats = l.catalogStats;
          // Show placed high:medium by TIME so the ~2:1 target is verifiable.
          const ratioByTime = stats && stats.placedMediumDurationSec
            ? ` · ${(stats.placedHighDurationSec! / stats.placedMediumDurationSec).toFixed(1)}:1`
            : '';
          const summary = stats
            ? `${stats.highCount}H · ${stats.mediumCount}M${stats.interstitialCount ? ` · ${stats.interstitialCount}I` : ''}${ratioByTime}`
            : '—';
          return (
            <button
              key={l.loopNumber}
              onClick={() => setSelectedLoopNumber(l.loopNumber)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors text-left ${
                isSelected
                  ? 'bg-white text-black'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="font-semibold">
                Loop #{l.loopNumber}
                {isPlaying && (
                  <span className={`ml-2 text-[10px] uppercase tracking-wide ${isSelected ? 'text-red-700' : 'text-red-400'}`}>● playing</span>
                )}
              </div>
              <div className={`text-[11px] ${isSelected ? 'text-zinc-700' : 'text-zinc-400'}`}>
                {formatPtClock(l.startTimeMs)} · {formatDuration(l.totalDurationSec)} · {summary}
              </div>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-zinc-900 border border-white/10">
        <button
          onClick={handleEnsureNext}
          disabled={ensuring}
          className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-white rounded disabled:opacity-50"
          title="Generate the next loop if none is queued"
        >
          {ensuring ? 'Ensuring…' : 'Ensure next loop'}
        </button>
        <button
          onClick={handleRegenerate}
          disabled={regenerating || loading || selectedLoopNumber == null}
          className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-white rounded disabled:opacity-50"
        >
          {regenerating ? 'Regenerating…' : 'Regenerate this loop'}
        </button>
        <button
          onClick={handleSave}
          disabled={!dirty || saving || loading}
          className="px-3 py-1.5 text-sm bg-white text-black rounded disabled:opacity-50 disabled:bg-zinc-500"
        >
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
        <label className="flex items-center gap-2 text-sm text-zinc-300 ml-2">
          <input
            type="checkbox"
            checked={loopDoc?.locked ?? false}
            onChange={handleToggleLock}
            disabled={selectedLoopNumber == null}
          />
          Lock loop (cron will skip)
        </label>
        <div className="ml-auto text-xs text-zinc-500">
          {loopDoc?.exists
            ? `Generated by ${loopDoc.generatedBy ?? 'cron'} · ${loopDoc.catalogStats?.totalItems ?? items.length} items · ${formatDuration(loopDoc.totalDurationSec ?? 0)}`
            : selectedLoopNumber != null
              ? 'Loop not found. Use “Regenerate this loop” to create it.'
              : ''}
        </div>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-950/40 border border-red-700 text-red-200 text-sm rounded">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white" />
        </div>
      ) : (
        <div className="border border-white/10">
          <table className="w-full text-sm">
            <tbody>
              {items.map((item, itemIndex) => {
                const photo = item.artworkUrl || item.djs?.[0]?.photoUrl;
                const djs = item.djs?.map((d) => d.name).join(', ') || '';
                const startMs = selectedStartMs + item.startOffsetSec * 1000;
                const endMs = startMs + item.durationSec * 1000;
                return (
                  <tr key={`${item.archiveId}-${itemIndex}`} className="border-b border-white/5 align-top">
                    <td className="w-28 px-3 py-3 text-xs font-mono text-zinc-400 border-r border-white/10 align-top">
                      {formatPtTime(startMs)}
                      <span className="block text-[10px] text-zinc-600 mt-0.5">→ {formatPtTime(endMs)}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-zinc-800 flex-shrink-0 overflow-hidden relative">
                          {photo && (
                            <Image src={photo} alt="" fill className="object-cover" sizes="48px" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-white text-sm font-semibold truncate">{item.title || '(untitled)'}</div>
                          <div className="text-zinc-400 text-xs truncate">{djs}</div>
                          <div className="text-zinc-500 text-[11px]">{formatDuration(item.durationSec)}</div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => handleMove(itemIndex, -1)}
                            disabled={itemIndex <= 0}
                            className="px-2 py-1 text-xs text-zinc-400 hover:text-white disabled:opacity-30"
                            title="Move up"
                          >↑</button>
                          <button
                            onClick={() => handleMove(itemIndex, 1)}
                            disabled={itemIndex >= items.length - 1}
                            className="px-2 py-1 text-xs text-zinc-400 hover:text-white disabled:opacity-30"
                            title="Move down"
                          >↓</button>
                          <button
                            onClick={() => setPickerSlot(itemIndex)}
                            className="px-2 py-1 text-xs text-zinc-400 hover:text-white"
                            title="Swap archive"
                          >swap</button>
                          <button
                            onClick={() => handleRemove(itemIndex)}
                            className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                            title="Remove"
                          >×</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={2} className="px-3 py-3 text-center">
                  <button
                    onClick={() => setPickerSlot(items.length)}
                    className="text-xs text-zinc-500 hover:text-white"
                  >
                    + add archive
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {pickerSlot !== null && (
        <ArchivePicker
          archives={archives}
          onPick={(a) => {
            if (pickerSlot < items.length) handleSwap(pickerSlot, a);
            else handleInsert(items.length, a);
          }}
          onClose={() => setPickerSlot(null)}
        />
      )}
    </div>
  );
}
