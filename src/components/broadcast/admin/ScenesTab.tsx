'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { useAuthContext } from '@/contexts/AuthContext';
import type { SceneSerialized } from '@/types/scenes';
import type { DjForScenesAdmin, ResidencyCadence } from '@/app/api/admin/scenes/djs/route';

const UNASSIGNED_FILTER = '__unassigned__';
const ALL_FILTER = '__all__';

export function ScenesTab() {
  const { user } = useAuthContext();
  const [scenes, setScenes] = useState<SceneSerialized[]>([]);
  const [djs, setDjs] = useState<DjForScenesAdmin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sceneFilter, setSceneFilter] = useState<string>(ALL_FILTER);

  const authedFetch = useCallback(
    async (url: string, init?: RequestInit): Promise<Response> => {
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();
      return fetch(url, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
    },
    [user]
  );

  const fetchScenes = useCallback(async () => {
    const res = await fetch('/api/admin/scenes');
    if (!res.ok) throw new Error('Failed to load scenes');
    const data = await res.json();
    setScenes(data.scenes || []);
  }, []);

  const fetchDjs = useCallback(async () => {
    const res = await authedFetch('/api/admin/scenes/djs');
    if (!res.ok) throw new Error('Failed to load DJs');
    const data = await res.json();
    setDjs(data.djs || []);
  }, [authedFetch]);

  useEffect(() => {
    if (!user) return;
    setIsLoading(true);
    Promise.all([fetchScenes(), fetchDjs()])
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setIsLoading(false));
  }, [user, fetchScenes, fetchDjs]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { [UNASSIGNED_FILTER]: 0 };
    for (const scene of scenes) map[scene.id] = 0;
    for (const dj of djs) {
      if (!dj.sceneIds || dj.sceneIds.length === 0) {
        map[UNASSIGNED_FILTER] = (map[UNASSIGNED_FILTER] ?? 0) + 1;
        continue;
      }
      for (const id of dj.sceneIds) {
        if (map[id] !== undefined) map[id] = map[id] + 1;
      }
    }
    return map;
  }, [djs, scenes]);

  const filteredDjs = useMemo(() => {
    if (sceneFilter === ALL_FILTER) return djs;
    if (sceneFilter === UNASSIGNED_FILTER) return djs.filter((d) => !d.sceneIds || d.sceneIds.length === 0);
    return djs.filter((d) => d.sceneIds?.includes(sceneFilter));
  }, [djs, sceneFilter]);

  const handleToggleDjScene = useCallback(
    async (dj: DjForScenesAdmin, sceneId: string) => {
      const current = dj.sceneIds ?? [];
      const next = current.includes(sceneId)
        ? current.filter((s) => s !== sceneId)
        : [...current, sceneId];

      setDjs((prev) => prev.map((d) => (d.userId === dj.userId ? { ...d, sceneIds: next } : d)));

      try {
        const res = await authedFetch('/api/admin/scenes/dj-assignment', {
          method: 'PATCH',
          body: JSON.stringify({ userId: dj.userId, sceneIds: next }),
        });
        if (!res.ok) throw new Error('Failed to update');
      } catch {
        await fetchDjs();
      }
    },
    [authedFetch, fetchDjs]
  );

  const handleSetResidency = useCallback(
    async (dj: DjForScenesAdmin, cadence: ResidencyCadence | null) => {
      setDjs((prev) =>
        prev.map((d) =>
          d.userId === dj.userId ? { ...d, residencyCadence: cadence ?? undefined } : d
        )
      );

      try {
        const res = await authedFetch('/api/admin/scenes/dj-residency', {
          method: 'PATCH',
          body: JSON.stringify({ userId: dj.userId, cadence }),
        });
        if (!res.ok) throw new Error('Failed to update');
      } catch {
        await fetchDjs();
      }
    },
    [authedFetch, fetchDjs]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    );
  }

  if (error) {
    return <div className="text-red-400 py-8">{error}</div>;
  }

  const totalAssigned = filteredDjs.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <SceneSwitcherPill
          active={sceneFilter === ALL_FILTER}
          label="All"
          count={totalAssigned}
          onClick={() => setSceneFilter(ALL_FILTER)}
        />
        {scenes.map((scene) => (
          <SceneSwitcherPill
            key={scene.id}
            active={sceneFilter === scene.id}
            label={<><span className="text-base leading-none">{scene.emoji}</span> {scene.name}</>}
            count={counts[scene.id] ?? 0}
            color={scene.color}
            onClick={() => setSceneFilter(scene.id)}
          />
        ))}
        <SceneSwitcherPill
          active={sceneFilter === UNASSIGNED_FILTER}
          label="Unassigned"
          count={counts[UNASSIGNED_FILTER] ?? 0}
          color="bg-yellow-900/40 text-yellow-300 border-yellow-800"
          onClick={() => setSceneFilter(UNASSIGNED_FILTER)}
        />
      </div>

      {filteredDjs.length === 0 ? (
        <div className="text-gray-500 text-sm py-12 text-center">No DJs in this view.</div>
      ) : (
        <div className="space-y-2">
          {filteredDjs.map((dj) => (
            <DjRow
              key={dj.userId}
              dj={dj}
              scenes={scenes}
              onToggle={handleToggleDjScene}
              onSetResidency={handleSetResidency}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SceneSwitcherPill({
  active,
  label,
  count,
  color,
  onClick,
}: {
  active: boolean;
  label: ReactNode;
  count: number;
  color?: string;
  onClick: () => void;
}) {
  const activeClass = color || 'bg-white text-black border-white';
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
        active ? activeClass : 'bg-gray-800/50 text-gray-400 border-gray-700 hover:text-gray-200'
      }`}
    >
      {label}
      <span className="ml-2 opacity-70">{count}</span>
    </button>
  );
}

function DjRow({
  dj,
  scenes,
  onToggle,
  onSetResidency,
}: {
  dj: DjForScenesAdmin;
  scenes: SceneSerialized[];
  onToggle: (dj: DjForScenesAdmin, sceneId: string) => void;
  onSetResidency: (dj: DjForScenesAdmin, cadence: ResidencyCadence | null) => void;
}) {
  const cadence = dj.residencyCadence;
  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-[#1f1f1f] rounded-lg border border-gray-800">
      <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-800 flex-shrink-0">
        {dj.photoUrl ? (
          <Image
            src={dj.photoUrl}
            alt={dj.displayName}
            width={40}
            height={40}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
            {dj.displayName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{dj.displayName}</div>
        {dj.chatUsername && (
          <div className="text-xs text-gray-500 truncate">@{dj.chatUsername}</div>
        )}
      </div>
      <div className="flex items-center gap-1 mr-2 flex-shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-gray-600 mr-1">Resident</span>
        <ResidencyPill active={!cadence} label="No" onClick={() => onSetResidency(dj, null)} />
        <ResidencyPill
          active={cadence === 'monthly'}
          label="Monthly"
          onClick={() => onSetResidency(dj, 'monthly')}
        />
        <ResidencyPill
          active={cadence === 'quarterly'}
          label="Quarterly"
          onClick={() => onSetResidency(dj, 'quarterly')}
        />
      </div>
      <div className="flex flex-wrap gap-1.5 justify-end">
        {scenes.map((scene) => {
          const active = dj.sceneIds?.includes(scene.id);
          return (
            <button
              key={scene.id}
              onClick={() => onToggle(dj, scene.id)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                active
                  ? scene.color
                  : 'bg-gray-800/50 text-gray-500 border-gray-700 hover:text-gray-300'
              }`}
            >
              <span className="mr-1 text-base leading-none">{scene.emoji}</span>
              {scene.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ResidencyPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
        active
          ? 'bg-white text-black border-white'
          : 'bg-gray-800/50 text-gray-500 border-gray-700 hover:text-gray-300'
      }`}
    >
      {label}
    </button>
  );
}
