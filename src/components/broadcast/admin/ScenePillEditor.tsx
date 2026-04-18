'use client';

import type { SceneSerialized } from '@/types/scenes';
import { SceneGlyph } from '@/components/SceneGlyph';

// Shared inline scene-pill editor used across the admin surfaces
// (archives, events, collectives, DJs, pending DJs).
//
// Two modes:
//   1. Direct (no `inheritedSceneIds`): the selected set is authoritative — used
//      for entities whose scene data is stored directly (collectives, DJs).
//   2. Override (`inheritedSceneIds` provided, `selectedSceneIds` may be null):
//      when null we show the inherited set as active; toggling pins an explicit
//      override. A "reset" button clears it back to null.
export function ScenePillEditor({
  scenes,
  selectedSceneIds,
  inheritedSceneIds,
  onToggle,
  onReset,
  label,
  size = 'sm',
}: {
  scenes: SceneSerialized[];
  selectedSceneIds: string[] | null;
  inheritedSceneIds?: string[];
  onToggle: (sceneId: string) => void;
  onReset?: () => void;
  label?: string;
  size?: 'xs' | 'sm';
}) {
  if (scenes.length === 0) return null;

  const hasOverride = Array.isArray(selectedSceneIds);
  const effective = hasOverride ? (selectedSceneIds as string[]) : inheritedSceneIds ?? [];

  const padY = size === 'xs' ? 'py-0.5' : 'py-1';
  const padX = size === 'xs' ? 'px-2' : 'px-2.5';
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs';

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {label && (
        <span className="text-[10px] uppercase tracking-[0.3em] text-gray-500">{label}</span>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        {scenes.map((s) => {
          const active = effective.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onToggle(s.id)}
              title={s.name}
              className={`inline-flex items-center gap-1 ${padX} ${padY} ${textSize} rounded border transition-colors ${
                active
                  ? 'bg-white text-black border-white'
                  : 'bg-gray-800/50 text-gray-500 border-gray-700 hover:text-gray-300'
              }`}
            >
              <SceneGlyph slug={s.id} />
              {s.name}
            </button>
          );
        })}
        {onReset && hasOverride && inheritedSceneIds !== undefined && (
          <button
            type="button"
            onClick={onReset}
            title="Reset to inherited default"
            className={`${padX} ${padY} ${textSize} rounded border bg-transparent text-gray-500 border-gray-700 hover:text-gray-300`}
          >
            reset
          </button>
        )}
      </div>
    </div>
  );
}
