'use client';

import { useMemo } from 'react';
import { useFieldNotePlaylist } from '@/hooks/useFieldNotePlaylist';
import { normalizeUsername } from '@/lib/dj-matching';
import { FieldNoteSerialized } from '@/types/field-notes';

interface Props {
  notes: FieldNoteSerialized[];
}

interface EntityGroup {
  key: string;
  label: string;
  notes: FieldNoteSerialized[];
  latest: number;
}

// The primary entity of a note: event → else first DJ → else first collective.
function primaryEntity(note: FieldNoteSerialized): { key: string; label: string } | null {
  if (note.linkedEventId) return { key: `event:${note.linkedEventId}`, label: note.eventName || 'Event' };
  if (note.eventName) return { key: `eventname:${note.eventName.toLowerCase()}`, label: note.eventName };
  if (note.djs[0]) {
    const d = note.djs[0];
    return { key: `dj:${d.djUserId || normalizeUsername(d.djName)}`, label: d.djName };
  }
  if (note.collectives[0]) {
    const c = note.collectives[0];
    return { key: `collective:${c.collectiveId}`, label: c.collectiveName };
  }
  if (note.venues[0]) {
    const v = note.venues[0];
    return { key: `venue:${v.venueId}`, label: v.venueName };
  }
  return null;
}

export function FieldNoteEntityPlaylists({ notes }: Props) {
  const { playPlaylist, isPlaying, activePlaylistKey } = useFieldNotePlaylist();

  const groups = useMemo(() => {
    const map = new Map<string, EntityGroup>();
    for (const note of notes) {
      const entity = primaryEntity(note);
      if (!entity) continue;
      const existing = map.get(entity.key);
      const noteTime = note.publishedAt || note.createdAt;
      if (existing) {
        existing.notes.push(note);
        existing.latest = Math.max(existing.latest, noteTime);
      } else {
        map.set(entity.key, { key: entity.key, label: entity.label, notes: [note], latest: noteTime });
      }
    }
    // Only entities with >=1 note (all here); order by most-recent note.
    return Array.from(map.values()).sort((a, b) => b.latest - a.latest);
  }, [notes]);

  if (groups.length === 0) return null;

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Listen to notes about…
      </h2>
      <div className="space-y-2">
        {groups.map((g) => {
          const active = activePlaylistKey === g.key && isPlaying;
          return (
            <div
              key={g.key}
              className="flex items-center justify-between rounded-lg bg-gray-800/60 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-white font-medium truncate">{g.label}</p>
                <p className="text-xs text-gray-500">
                  {g.notes.length} note{g.notes.length === 1 ? '' : 's'}
                </p>
              </div>
              <button
                onClick={() => playPlaylist(g.key, g.notes)}
                className="shrink-0 rounded-full bg-white text-black w-10 h-10 flex items-center justify-center font-medium"
                aria-label={active ? `Pause notes about ${g.label}` : `Play all notes about ${g.label}`}
              >
                {active ? '❚❚' : '▶'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
