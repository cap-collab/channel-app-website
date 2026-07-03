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
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-700 text-white text-sm px-3 py-1">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="text-gray-300 hover:text-white leading-none"
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
  const [venueQuery, setVenueQuery] = useState('');
  const [collectiveQuery, setCollectiveQuery] = useState('');

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

  const filteredVenues = useMemo(() => {
    const q = venueQuery.trim().toLowerCase();
    if (!q) return [];
    return venueOptions.filter((o) => o.label.toLowerCase().includes(q) && !selectedVenueKeys.has(venueKeyOf(o))).slice(0, 8);
  }, [venueQuery, venueOptions, selectedVenueKeys]);

  const filteredCollectives = useMemo(() => {
    const q = collectiveQuery.trim().toLowerCase();
    if (!q) return [];
    return collectiveOptions.filter((o) => o.label.toLowerCase().includes(q) && !selectedCollectiveKeys.has(collectiveKeyOf(o))).slice(0, 8);
  }, [collectiveQuery, collectiveOptions, selectedCollectiveKeys]);

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
    setVenueQuery('');
  };
  const addFreeTextVenue = () => {
    const name = venueQuery.trim();
    if (!name || selectedVenueKeys.has(normalizeUsername(name))) return;
    onChange({ djs, venues: [...venues, { venueId: '', venueName: name }], collectives });
    setVenueQuery('');
  };
  const removeVenue = (key: string) => {
    onChange({ djs, venues: venues.filter((v) => venueKeyOf(v) !== key), collectives });
  };

  const addCollective = (c: CollectiveRef) => {
    if (selectedCollectiveKeys.has(collectiveKeyOf(c))) return;
    onChange({ djs, venues, collectives: [...collectives, c] });
    setCollectiveQuery('');
  };
  const addFreeTextCollective = () => {
    const name = collectiveQuery.trim();
    if (!name || selectedCollectiveKeys.has(normalizeUsername(name))) return;
    onChange({ djs, venues, collectives: [...collectives, { collectiveId: '', collectiveName: name }] });
    setCollectiveQuery('');
  };
  const removeCollective = (key: string) => {
    onChange({ djs, venues, collectives: collectives.filter((c) => collectiveKeyOf(c) !== key) });
  };

  return (
    <div className="space-y-4">
      {/* DJs */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">DJ(s)</label>
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
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filteredDjs.length > 0) addDj(filteredDjs[0]);
              else addFreeTextDj();
            }
          }}
          placeholder={loading ? 'Loading DJs…' : 'Search a DJ, or type a new name'}
          className="w-full rounded-lg bg-gray-800 text-white px-3 py-2 text-sm"
        />
        {(filteredDjs.length > 0 || djQuery.trim()) && (
          <div className="mt-1 rounded-lg bg-gray-800 divide-y divide-gray-700 overflow-hidden">
            {filteredDjs.map((o) => (
              <button
                key={o.djUserId || o.djUsername || o.label}
                type="button"
                onClick={() => addDj(o)}
                className="block w-full text-left px-3 py-2 text-sm text-white hover:bg-gray-700"
              >
                {o.label}
              </button>
            ))}
            {djQuery.trim() && (
              <button
                type="button"
                onClick={addFreeTextDj}
                className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Add “{djQuery.trim()}” as a new name
              </button>
            )}
          </div>
        )}
      </div>

      {/* Venues */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Venue(s)</label>
        {venues.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {venues.map((v) => (
              <Chip key={venueKeyOf(v)} label={v.venueName} onRemove={() => removeVenue(venueKeyOf(v))} />
            ))}
          </div>
        )}
        <input
          type="text"
          value={venueQuery}
          onChange={(e) => setVenueQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filteredVenues.length > 0) addVenue(filteredVenues[0]);
              else addFreeTextVenue();
            }
          }}
          placeholder={loading ? 'Loading venues…' : 'Search a venue, or type a new name'}
          className="w-full rounded-lg bg-gray-800 text-white px-3 py-2 text-sm"
        />
        {(filteredVenues.length > 0 || venueQuery.trim()) && (
          <div className="mt-1 rounded-lg bg-gray-800 divide-y divide-gray-700 overflow-hidden">
            {filteredVenues.map((o) => (
              <button
                key={o.venueId}
                type="button"
                onClick={() => addVenue(o)}
                className="block w-full text-left px-3 py-2 text-sm text-white hover:bg-gray-700"
              >
                {o.label}
              </button>
            ))}
            {venueQuery.trim() && (
              <button
                type="button"
                onClick={addFreeTextVenue}
                className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Add “{venueQuery.trim()}” as a new venue
              </button>
            )}
          </div>
        )}
      </div>

      {/* Collectives */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Collective(s)</label>
        {collectives.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {collectives.map((c) => (
              <Chip key={collectiveKeyOf(c)} label={c.collectiveName} onRemove={() => removeCollective(collectiveKeyOf(c))} />
            ))}
          </div>
        )}
        <input
          type="text"
          value={collectiveQuery}
          onChange={(e) => setCollectiveQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filteredCollectives.length > 0) addCollective(filteredCollectives[0]);
              else addFreeTextCollective();
            }
          }}
          placeholder={loading ? 'Loading collectives…' : 'Search a collective, or type a new name'}
          className="w-full rounded-lg bg-gray-800 text-white px-3 py-2 text-sm"
        />
        {(filteredCollectives.length > 0 || collectiveQuery.trim()) && (
          <div className="mt-1 rounded-lg bg-gray-800 divide-y divide-gray-700 overflow-hidden">
            {filteredCollectives.map((o) => (
              <button
                key={o.collectiveId}
                type="button"
                onClick={() => addCollective(o)}
                className="block w-full text-left px-3 py-2 text-sm text-white hover:bg-gray-700"
              >
                {o.label}
              </button>
            ))}
            {collectiveQuery.trim() && (
              <button
                type="button"
                onClick={addFreeTextCollective}
                className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Add “{collectiveQuery.trim()}” as a new collective
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
