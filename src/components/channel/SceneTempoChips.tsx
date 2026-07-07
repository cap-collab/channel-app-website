'use client';

import { useState, useRef, useEffect } from 'react';
import { SceneGlyph } from '@/components/SceneGlyph';
import { tempoLabel } from '@/lib/tempo';
import { resolveArchiveScenes, type DjSceneMap } from '@/hooks/useScenesData';
import { type Tempo, type ArchiveSerialized } from '@/types/broadcast';
import type { SceneTempoFilter } from './useSceneTempoFilter';

// Scene-glyph + tempo filter chips, shared by the homepage (`ArchiveHero`) and
// `/foryou` (`SceneRecommendations`). Fed by the `useSceneTempoFilter` hook.
export function SceneTempoChips({ filter }: { filter: SceneTempoFilter }) {
  const {
    sceneFilter,
    tempoFilter,
    toggleSceneFilter,
    toggleTempoFilter,
    availableScenes,
    availableTempos,
    noneSelected,
    noTempoSelected,
  } = filter;

  if (availableScenes.length === 0 && availableTempos.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1 md:gap-2 shrink-0">
      {availableScenes.map((s) => {
        // Empty selection means "show everything" (same behavior as all
        // selected), so render all chips active in both cases.
        const active = noneSelected || sceneFilter.has(s.id);
        return (
          <button
            key={s.id}
            onClick={() => toggleSceneFilter(s.id)}
            title={s.name}
            aria-label={`Filter by ${s.name}`}
            className={`w-[27px] h-[27px] flex items-center justify-center transition-colors ${
              active ? 'bg-white text-black' : 'bg-transparent text-white/30 hover:text-white/60'
            }`}
          >
            <SceneGlyph slug={s.id} className="!w-5 !h-5" />
          </button>
        );
      })}
      {availableTempos.length > 0 && (
        <TempoFilterDropdown
          tempos={availableTempos}
          tempoFilter={tempoFilter}
          noneSelected={noTempoSelected}
          onToggle={toggleTempoFilter}
        />
      )}
    </div>
  );
}

// The black band above a featured/no-preference card: [scene glyph] TEMPO FAVORITE.
// Space-separated, no separators. Reuses the shared band styling.
export function FeaturedBand({ archive, djSceneMap }: { archive: ArchiveSerialized; djSceneMap: DjSceneMap }) {
  const glyphSlug = resolveArchiveScenes(archive, djSceneMap).find((s) => s !== 'grid');
  const tempoText = archive.tempo ? tempoLabel(archive.tempo) : null;
  return (
    <div className="bg-black text-white text-[10px] font-mono uppercase tracking-[0.2em] py-1 px-2 flex items-center justify-center gap-1.5">
      {glyphSlug && <SceneGlyph slug={glyphSlug} className="!w-3 !h-3" />}
      {tempoText && <span>{tempoText}</span>}
      <span>Favorite</span>
    </div>
  );
}

export function TempoFilterDropdown({
  tempos,
  tempoFilter,
  noneSelected,
  onToggle,
}: {
  tempos: ReadonlyArray<{ id: Tempo; label: string }>;
  tempoFilter: Set<Tempo>;
  noneSelected: boolean;
  onToggle: (tempo: Tempo) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !e.composedPath().includes(ref.current)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // A tempo counts as "on" when its chip is checked (or nothing is selected,
  // which we treat as "all on"). The button reads TEMPO when everything's on,
  // the single tempo's name when exactly one is selected, otherwise the count.
  const isOn = (id: Tempo) => noneSelected || tempoFilter.has(id);
  const selectedTempos = tempos.filter((t) => isOn(t.id));
  const selectedCount = selectedTempos.length;
  const allOn = selectedCount === tempos.length;
  const buttonLabel = allOn
    ? 'TEMPO'
    : selectedCount === 1
      ? selectedTempos[0].label
      : `${selectedCount} TEMPOS`;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="h-[27px] px-2.5 flex items-center gap-1.5 text-[14.3px] font-mono uppercase tracking-tighter whitespace-nowrap bg-white text-black transition-colors"
      >
        {buttonLabel}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 mt-1 z-50 min-w-[160px] bg-black border border-white/15 shadow-xl"
        >
          {tempos.map((t) => {
            const checked = isOn(t.id);
            return (
              <button
                key={t.id}
                onClick={() => onToggle(t.id)}
                role="option"
                aria-selected={checked}
                className={`w-full text-left px-3 py-2 text-[14.3px] font-mono uppercase tracking-tighter flex items-center justify-between transition-colors ${
                  checked ? 'text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {t.label}
                {checked && (
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
