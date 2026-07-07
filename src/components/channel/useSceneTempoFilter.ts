'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useScenesData, resolveArchiveScenes } from '@/hooks/useScenesData';
import { useFilterContext } from '@/contexts/FilterContext';
import { TEMPOS } from '@/lib/tempo';
import { type Tempo, type ArchiveSerialized } from '@/types/broadcast';

// Known scene chips for the filter row, used as an instant fallback before
// useScenesData()'s async fetch resolves — spiral + star are a fixed set, so
// the glyphs paint on page load instead of popping in. Grid is intentionally
// excluded (hidden from the filter row). Kept in sync with seed-scenes.ts.
export const STATIC_SCENE_CHIPS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'spiral', name: 'Spiral' },
  { id: 'star', name: 'Star' },
];

/**
 * Shared scene-glyph + tempo filter state used by the homepage (`ArchiveHero`)
 * and `/foryou` (`SceneRecommendations`). Both use purely LOCAL, non-persisted
 * state (every load starts with all chips selected). The homepage additionally
 * seeds from a shared `/?spiral&uptempo` link via FilterContext; `/foryou` opts
 * out (mode: 'local').
 *
 *  - 'homepage': seed scene from `urlSceneOverride`, tempo from `urlTempoOverride`;
 *    a manual toggle strips the URL params via `clearUrlFilters`. Scene state is
 *    still local (NOT the persisted FilterContext selection — that's the /scene
 *    page's model, which this hook does not cover).
 *  - 'local': no URL seeding, no FilterContext — pure local state.
 */
export function useSceneTempoFilter(mode: 'homepage' | 'local' = 'local') {
  const { scenes, djSceneMap } = useScenesData();
  const { urlSceneOverride, urlTempoOverride, clearUrlFilters } = useFilterContext();
  const isHomepage = mode === 'homepage';

  // Local-only scene selection. null = "all scenes" (every chip active) until
  // the user makes a choice.
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[] | null>(null);
  // Seed the scene filter from a shared `/?spiral` (or `?star`) link (homepage
  // only). Session-only.
  useEffect(() => {
    if (isHomepage && urlSceneOverride) setSelectedSceneIds([urlSceneOverride]);
  }, [isHomepage, urlSceneOverride]);

  const sceneFilter = useMemo(() => {
    if (selectedSceneIds === null) return new Set(scenes.map((s) => s.id));
    return new Set(selectedSceneIds);
  }, [selectedSceneIds, scenes]);

  const toggleSceneFilter = useCallback(
    (sceneId: string) => {
      // null (never touched) and [] (all toggled off) both mean "show everything" —
      // treat them identically so the first click deselects one chip from the full set
      // rather than selecting only that chip.
      setSelectedSceneIds((baseline) => {
        const current =
          baseline === null || baseline.length === 0 ? scenes.map((s) => s.id) : baseline;
        const next = current.includes(sceneId)
          ? current.filter((id) => id !== sceneId)
          : [...current, sceneId];
        return next;
      });
      // A manual toggle exits the shared-link session: strip the scene/tempo
      // params from the URL so /?spiral cleans back to /.
      if (isHomepage && urlSceneOverride) clearUrlFilters();
    },
    [scenes, isHomepage, urlSceneOverride, clearUrlFilters]
  );

  // Tempo filter. Same local-only, non-persisted model: null = "all tempos".
  const [selectedTempos, setSelectedTempos] = useState<Tempo[] | null>(null);
  const urlTempoKey = isHomepage && urlTempoOverride ? urlTempoOverride.join(',') : '';
  useEffect(() => {
    if (urlTempoKey) setSelectedTempos(urlTempoKey.split(',') as Tempo[]);
  }, [urlTempoKey]);

  const tempoFilter = useMemo(() => {
    if (selectedTempos === null) return new Set<Tempo>(TEMPOS.map((t) => t.id));
    return new Set<Tempo>(selectedTempos);
  }, [selectedTempos]);

  const toggleTempoFilter = useCallback(
    (tempo: Tempo) => {
      setSelectedTempos((current0) => {
        const current =
          current0 === null || current0.length === 0 ? TEMPOS.map((t) => t.id) : current0;
        return current.includes(tempo)
          ? current.filter((id) => id !== tempo)
          : [...current, tempo];
      });
      if (isHomepage && urlTempoOverride) clearUrlFilters();
    },
    [isHomepage, urlTempoOverride, clearUrlFilters]
  );

  // Available chips: spiral + star are a fixed, known set, so render them from
  // a static fallback that paints instantly, then use the live list once loaded.
  const loadedScenes = scenes.filter((s) => s.id !== 'grid');
  const availableScenes = loadedScenes.length > 0 ? loadedScenes : STATIC_SCENE_CHIPS;
  const availableTempos = TEMPOS;

  // "all selected == no filter" convention (matches the pre-extraction inline
  // logic). Empty selection also means "show everything".
  const allScenesSelected =
    availableScenes.length > 0 && availableScenes.every((s) => sceneFilter.has(s.id));
  const noneSelected =
    availableScenes.length > 0 && availableScenes.every((s) => !sceneFilter.has(s.id));
  const filteringActive = !allScenesSelected && !noneSelected;

  const allTemposSelected =
    availableTempos.length > 0 && availableTempos.every((t) => tempoFilter.has(t.id));
  const noTempoSelected =
    availableTempos.length > 0 && availableTempos.every((t) => !tempoFilter.has(t.id));
  const tempoFilteringActive = !allTemposSelected && !noTempoSelected;

  // Does an archive pass the active scene + tempo filter? (Both inactive ⇒ true.)
  const matchesArchive = useCallback(
    (archive: ArchiveSerialized): boolean => {
      if (filteringActive) {
        const sceneIds = resolveArchiveScenes(archive, djSceneMap);
        if (!sceneIds.some((id) => sceneFilter.has(id))) return false;
      }
      if (tempoFilteringActive) {
        if (!archive.tempo || !tempoFilter.has(archive.tempo as Tempo)) return false;
      }
      return true;
    },
    [filteringActive, tempoFilteringActive, sceneFilter, tempoFilter, djSceneMap]
  );

  return {
    sceneFilter,
    tempoFilter,
    toggleSceneFilter,
    toggleTempoFilter,
    availableScenes,
    availableTempos,
    noneSelected,
    noTempoSelected,
    filteringActive,
    tempoFilteringActive,
    matchesArchive,
  };
}

export type SceneTempoFilter = ReturnType<typeof useSceneTempoFilter>;
