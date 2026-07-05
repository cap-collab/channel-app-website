'use client';

import { useMemo, useState } from 'react';
import { useTagOptions } from '@/hooks/useTagOptions';
import { normalizeUsername } from '@/lib/dj-matching';
import { EventDJRef, EventVenueRef, CollectiveRef } from '@/types/events';

interface Props {
  djs: EventDJRef[];
  venues: EventVenueRef[];
  collectives: CollectiveRef[];
  onChange: (next: { djs: EventDJRef[]; venues: EventVenueRef[]; collectives: CollectiveRef[] }) => void;
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-700 text-white text-sm px-3 py-1">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="text-zinc-300 hover:text-white leading-none"
        aria-label={`Remove ${label}`}
      >
        ×
      </button>
    </span>
  );
}

export function FieldNoteTagPicker({ djs, venues, collectives, onChange }: Props) {
  const { djs: djOptions, venues: venueOptions, collectives: collectiveOptions, loading } = useTagOptions();

  const [djQuery, setDjQuery] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');   // one field for venues + collectives

  // Keys prefer the DB id, falling back to the normalized name so free-text
  // (not-in-DB) tags still dedupe and remove correctly.
  const djKeyOf = (d: EventDJRef) => d.djUserId || normalizeUsername(d.djName || '');
  const venueKeyOf = (v: EventVenueRef) => v.venueId || normalizeUsername(v.venueName || '');
  const collectiveKeyOf = (c: CollectiveRef) => c.collectiveId || normalizeUsername(c.collectiveName || '');

  const selectedDjKeys = useMemo(() => new Set(djs.map(djKeyOf)), [djs]);
  const selectedVenueKeys = useMemo(() => new Set(venues.map(venueKeyOf)), [venues]);
  const selectedCollectiveKeys = useMemo(() => new Set(collectives.map(collectiveKeyOf)), [collectives]);

  const filteredDjs = useMemo(() => {
    const q = djQuery.trim().toLowerCase();
    if (!q) return [];
    return djOptions.filter((o) => o.label.toLowerCase().includes(q) && !selectedDjKeys.has(djKeyOf(o))).slice(0, 8);
  }, [djQuery, djOptions, selectedDjKeys]);

  // Merged venue + collective matches for the single "place" field.
  const filteredPlaces = useMemo(() => {
    const q = placeQuery.trim().toLowerCase();
    if (!q) return [] as Array<{ kind: 'venue'; opt: typeof venueOptions[number] } | { kind: 'collective'; opt: typeof collectiveOptions[number] }>;
    const v = venueOptions
      .filter((o) => o.label.toLowerCase().includes(q) && !selectedVenueKeys.has(venueKeyOf(o)))
      .map((opt) => ({ kind: 'venue' as const, opt }));
    const c = collectiveOptions
      .filter((o) => o.label.toLowerCase().includes(q) && !selectedCollectiveKeys.has(collectiveKeyOf(o)))
      .map((opt) => ({ kind: 'collective' as const, opt }));
    return [...v, ...c].slice(0, 8);
  }, [placeQuery, venueOptions, collectiveOptions, selectedVenueKeys, selectedCollectiveKeys]);

  const addDj = (d: EventDJRef) => {
    if (selectedDjKeys.has(djKeyOf(d))) return;
    onChange({ djs: [...djs, d], venues, collectives });
    setDjQuery('');
  };
  const addFreeTextDj = () => {
    const name = djQuery.trim();
    if (!name || selectedDjKeys.has(normalizeUsername(name))) return;
    onChange({ djs: [...djs, { djName: name }], venues, collectives });
    setDjQuery('');
  };
  const removeDj = (key: string) => {
    onChange({ djs: djs.filter((d) => djKeyOf(d) !== key), venues, collectives });
  };

  const addVenue = (v: EventVenueRef) => {
    if (selectedVenueKeys.has(venueKeyOf(v))) return;
    onChange({ djs, venues: [...venues, v], collectives });
    setPlaceQuery('');
  };
  const removeVenue = (key: string) => {
    onChange({ djs, venues: venues.filter((v) => venueKeyOf(v) !== key), collectives });
  };

  const addCollective = (c: CollectiveRef) => {
    if (selectedCollectiveKeys.has(collectiveKeyOf(c))) return;
    onChange({ djs, venues, collectives: [...collectives, c] });
    setPlaceQuery('');
  };
  const removeCollective = (key: string) => {
    onChange({ djs, venues, collectives: collectives.filter((c) => collectiveKeyOf(c) !== key) });
  };

  // Free text with no match → save as a venue (the concrete "place").
  const addFreeTextPlace = () => {
    const name = placeQuery.trim();
    if (!name || selectedVenueKeys.has(normalizeUsername(name))) return;
    onChange({ djs, venues: [...venues, { venueId: '', venueName: name }], collectives });
    setPlaceQuery('');
  };

  return (
    <div className="space-y-4">
      {/* DJs */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">DJ(s)</label>
        {djs.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {djs.map((d) => (
              <Chip key={djKeyOf(d)} label={d.djName} onRemove={() => removeDj(djKeyOf(d))} />
            ))}
          </div>
        )}
        <input
          type="text"
          value={djQuery}
          onChange={(e) => setDjQuery(e.target.value)}
          onBlur={addFreeTextDj}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filteredDjs.length > 0) addDj(filteredDjs[0]);
              else addFreeTextDj();
            }
          }}
          placeholder={loading ? 'Loading DJs…' : 'Search a DJ, or type a new name'}
          className="w-full rounded-lg bg-zinc-800 text-white px-3 py-2 text-base"
        />
        {filteredDjs.length > 0 && (
          <div className="mt-1 rounded-lg bg-zinc-800 divide-y divide-white/10 overflow-hidden">
            {filteredDjs.map((o) => (
              <button
                key={o.djUserId || o.djUsername || o.label}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addDj(o)}
                className="block w-full text-left px-3 py-2 text-sm text-white hover:bg-zinc-700"
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Venue / Collective — one field for both */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">Venue / Collective</label>
        {(venues.length > 0 || collectives.length > 0) && (
          <div className="flex flex-wrap gap-2 mb-2">
            {venues.map((v) => (
              <Chip key={venueKeyOf(v)} label={v.venueName} onRemove={() => removeVenue(venueKeyOf(v))} />
            ))}
            {collectives.map((c) => (
              <Chip key={collectiveKeyOf(c)} label={c.collectiveName} onRemove={() => removeCollective(collectiveKeyOf(c))} />
            ))}
          </div>
        )}
        <input
          type="text"
          value={placeQuery}
          onChange={(e) => setPlaceQuery(e.target.value)}
          onBlur={addFreeTextPlace}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const first = filteredPlaces[0];
              if (first) {
                if (first.kind === 'venue') addVenue(first.opt);
                else addCollective(first.opt);
              } else {
                addFreeTextPlace();
              }
            }
          }}
          placeholder={loading ? 'Loading…' : 'Search a venue or collective, or type a new name'}
          className="w-full rounded-lg bg-zinc-800 text-white px-3 py-2 text-base"
        />
        {filteredPlaces.length > 0 && (
          <div className="mt-1 rounded-lg bg-zinc-800 divide-y divide-white/10 overflow-hidden">
            {filteredPlaces.map((p) => (
              <button
                key={`${p.kind}:${p.kind === 'venue' ? p.opt.venueId : p.opt.collectiveId}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (p.kind === 'venue' ? addVenue(p.opt) : addCollective(p.opt))}
                className="flex items-center justify-between w-full text-left px-3 py-2 text-sm text-white hover:bg-zinc-700"
              >
                <span>{p.opt.label}</span>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">{p.kind}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
