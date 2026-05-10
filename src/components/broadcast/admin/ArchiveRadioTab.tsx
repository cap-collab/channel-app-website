'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { ArchiveSerialized } from '@/types/broadcast';
import { offsetUtcId, todayUtcId } from '@/lib/archive-schedule';

// A single editable item in the schedule. Mirrors ScheduleItem but only the
// fields the admin UI needs to show/save.
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

interface DayDoc {
  exists: boolean;
  date: string;
  startTimeMs?: number;
  generatedAtMs?: number;
  generatedBy?: 'cron' | 'admin';
  locked?: boolean;
  items?: Array<UIItem>;
  eligibleArchiveCount?: number | null;
}

// Convert a UTC schedule day + offset-in-seconds into a Pacific-Time clock
// label (e.g. "5:42 PM"). The schedule is keyed by UTC date because storage
// spans timezones, but the admin UI shows PT to match what the admin sees.
function formatClockOffset(offsetSec: number, dayId: string): string {
  const utcMoment = new Date(`${dayId}T00:00:00.000Z`);
  utcMoment.setUTCSeconds(utcMoment.getUTCSeconds() + offsetSec);
  return utcMoment.toLocaleTimeString('en-US', {
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

function buildDayOptions(): { id: string; label: string }[] {
  const today = todayUtcId();
  return [0, 1, 2, 3, 4, 5, 6].map((delta) => {
    const id = offsetUtcId(today, delta);
    // Day labels are keyed by UTC date (storage truth), but show the PT
    // calendar date alongside so the admin doesn't have to mentally convert.
    const ptDate = new Date(`${id}T12:00:00.000Z`).toLocaleDateString('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const prefix = delta === 0 ? 'Today (PT)' : delta === 1 ? 'Tomorrow (PT)' : ptDate;
    return { id, label: `${prefix} · ${id} UTC` };
  });
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
  const dayOptions = useMemo(buildDayOptions, []);
  const [selectedDate, setSelectedDate] = useState(dayOptions[1]?.id ?? dayOptions[0].id); // default tomorrow
  const [day, setDay] = useState<DayDoc | null>(null);
  const [items, setItems] = useState<UIItem[]>([]);
  const [archives, setArchives] = useState<ArchiveSerialized[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);

  // Fetch archives once; the picker reuses the list.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/archives?includePrivate=true&includeHidden=false')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const all: ArchiveSerialized[] = data.archives ?? [];
        // Match the cron's eligibility: high + medium only, has a recording.
        const eligible = all.filter((a) => {
          if (!a.recordingUrl || !(a.duration && a.duration >= 30)) return false;
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

  const loadDay = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    setDirty(false);
    try {
      const res = await fetch(`/api/admin/archive-schedule/${date}`);
      const data: DayDoc = await res.json();
      setDay(data);
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
      console.error('[ArchiveRadioTab] load day', err);
      setError(err instanceof Error ? err.message : 'Failed to load day');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDay(selectedDate);
  }, [selectedDate, loadDay]);

  // Recompute startOffsetSec from current item order whenever the items list
  // mutates. Back-to-back packing: each item starts when the previous one
  // ends. No hourly alignment — matches what the cron writes.
  const reflow = useCallback((arr: UIItem[]): UIItem[] => {
    let cursor = 0;
    return arr.map((it) => {
      const next: UIItem = { ...it, startOffsetSec: cursor };
      cursor += it.durationSec;
      return next;
    });
  }, []);

  const handleAutoFill = async () => {
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/archive-schedule/${selectedDate}/regenerate`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Regenerate failed');
      await loadDay(selectedDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate');
    } finally {
      setRegenerating(false);
    }
  };

  const handleSave = async () => {
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
        locked: day?.locked ?? false,
      };
      const res = await fetch(`/api/admin/archive-schedule/${selectedDate}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      await loadDay(selectedDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleLock = async () => {
    const next = !(day?.locked ?? false);
    try {
      await fetch(`/api/admin/archive-schedule/${selectedDate}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map((it) => ({ ...it, kind: 'archive' })), locked: next }),
      });
      setDay((prev) => (prev ? { ...prev, locked: next } : prev));
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
        startOffsetSec: 0, // reflow will recompute
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
    // Insert at the given item index (end of list when called from the
    // "+ add archive" footer). reflow() then recomputes startOffsetSec
    // back-to-back.
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

  return (
    <div className="text-white">
      {/* Day picker */}
      <div className="flex flex-wrap gap-2 mb-4">
        {dayOptions.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setSelectedDate(opt.id)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              selectedDate === opt.id
                ? 'bg-white text-black'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-zinc-900 border border-white/10">
        <button
          onClick={handleAutoFill}
          disabled={regenerating || loading}
          className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-white rounded disabled:opacity-50"
        >
          {regenerating ? 'Auto-filling…' : 'Auto-fill day'}
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
            checked={day?.locked ?? false}
            onChange={handleToggleLock}
          />
          Lock day (cron will skip)
        </label>
        <div className="ml-auto text-xs text-zinc-500">
          {day?.exists
            ? `Generated by ${day.generatedBy ?? 'cron'} · ${day.eligibleArchiveCount ?? '?'} eligible archives`
            : 'No schedule yet — click "Auto-fill day" to generate one.'}
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
                const startClock = formatClockOffset(item.startOffsetSec, selectedDate);
                const endClock = formatClockOffset(item.startOffsetSec + item.durationSec, selectedDate);
                return (
                  <tr key={`${item.archiveId}-${itemIndex}`} className="border-b border-white/5 align-top">
                    <td className="w-28 px-3 py-3 text-xs font-mono text-zinc-400 border-r border-white/10 align-top">
                      {startClock}
                      <span className="block text-[10px] text-zinc-600 mt-0.5">→ {endClock}</span>
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
              {/* Append-at-end action */}
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
            // pickerSlot is now an itemIndex. If it points at an existing
            // item, swap; if it's past the end, append (insert at end).
            if (pickerSlot < items.length) handleSwap(pickerSlot, a);
            else handleInsert(items.length, a);
          }}
          onClose={() => setPickerSlot(null)}
        />
      )}
    </div>
  );
}
