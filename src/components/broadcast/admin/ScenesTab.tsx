'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { useAuthContext } from '@/contexts/AuthContext';
import type { SceneSerialized } from '@/types/scenes';
import type { DjForScenesAdmin, ResidencyCadence } from '@/app/api/admin/scenes/djs/route';
import type { CollectiveForScenesAdmin } from '@/app/api/admin/scenes/collectives/route';

const UNASSIGNED_FILTER = '__unassigned__';
const ALL_FILTER = '__all__';

export function ScenesTab() {
  const { user } = useAuthContext();
  const [scenes, setScenes] = useState<SceneSerialized[]>([]);
  const [djs, setDjs] = useState<DjForScenesAdmin[]>([]);
  const [collectives, setCollectives] = useState<CollectiveForScenesAdmin[]>([]);
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

  const fetchCollectives = useCallback(async () => {
    const res = await authedFetch('/api/admin/scenes/collectives');
    if (!res.ok) throw new Error('Failed to load collectives');
    const data = await res.json();
    setCollectives(data.collectives || []);
  }, [authedFetch]);

  useEffect(() => {
    if (!user) return;
    setIsLoading(true);
    Promise.all([fetchScenes(), fetchDjs(), fetchCollectives()])
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setIsLoading(false));
  }, [user, fetchScenes, fetchDjs, fetchCollectives]);

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
    for (const c of collectives) {
      if (!c.sceneIds || c.sceneIds.length === 0) {
        map[UNASSIGNED_FILTER] = (map[UNASSIGNED_FILTER] ?? 0) + 1;
        continue;
      }
      for (const id of c.sceneIds) {
        if (map[id] !== undefined) map[id] = map[id] + 1;
      }
    }
    return map;
  }, [djs, collectives, scenes]);

  const filteredDjs = useMemo(() => {
    if (sceneFilter === ALL_FILTER) return djs;
    if (sceneFilter === UNASSIGNED_FILTER) return djs.filter((d) => !d.sceneIds || d.sceneIds.length === 0);
    return djs.filter((d) => d.sceneIds?.includes(sceneFilter));
  }, [djs, sceneFilter]);

  const filteredCollectives = useMemo(() => {
    if (sceneFilter === ALL_FILTER) return collectives;
    if (sceneFilter === UNASSIGNED_FILTER) return collectives.filter((c) => !c.sceneIds || c.sceneIds.length === 0);
    return collectives.filter((c) => c.sceneIds?.includes(sceneFilter));
  }, [collectives, sceneFilter]);

  // Split into residents (any cadence set) vs non-residents. Within each group:
  // residents sort by soonest next-slot then name; non-residents sort by name.
  const { residents, nonResidents } = useMemo(() => {
    const r: DjForScenesAdmin[] = [];
    const nr: DjForScenesAdmin[] = [];
    for (const dj of filteredDjs) {
      if (dj.residencyCadence) r.push(dj);
      else nr.push(dj);
    }
    r.sort((a, b) => {
      const an = a.nextSlotStart ?? Number.POSITIVE_INFINITY;
      const bn = b.nextSlotStart ?? Number.POSITIVE_INFINITY;
      if (an !== bn) return an - bn;
      return a.displayName.localeCompare(b.displayName);
    });
    return { residents: r, nonResidents: nr };
  }, [filteredDjs]);

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

  const handleToggleCollectiveScene = useCallback(
    async (collective: CollectiveForScenesAdmin, sceneId: string) => {
      const current = collective.sceneIds ?? [];
      const next = current.includes(sceneId)
        ? current.filter((s) => s !== sceneId)
        : [...current, sceneId];

      setCollectives((prev) =>
        prev.map((c) => (c.collectiveId === collective.collectiveId ? { ...c, sceneIds: next } : c))
      );

      try {
        const res = await authedFetch('/api/admin/scenes/collective-assignment', {
          method: 'PATCH',
          body: JSON.stringify({ collectiveId: collective.collectiveId, sceneIds: next }),
        });
        if (!res.ok) throw new Error('Failed to update');
      } catch {
        await fetchCollectives();
      }
    },
    [authedFetch, fetchCollectives]
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

  const totalAssigned = filteredDjs.length + filteredCollectives.length;

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

      {filteredDjs.length === 0 && filteredCollectives.length === 0 ? (
        <div className="text-gray-500 text-sm py-12 text-center">Nothing in this view.</div>
      ) : (
        <div className="space-y-6">
          <DjGroup
            title="Residents"
            djs={residents}
            emptyLabel="No residents in this view."
            scenes={scenes}
            onToggle={handleToggleDjScene}
            onSetResidency={handleSetResidency}
          />
          <DjGroup
            title="Not residents"
            djs={nonResidents}
            emptyLabel="No non-resident DJs in this view."
            scenes={scenes}
            onToggle={handleToggleDjScene}
            onSetResidency={handleSetResidency}
          />
          <CollectiveGroup
            title="Collectives"
            collectives={filteredCollectives}
            emptyLabel="No collectives in this view."
            scenes={scenes}
            onToggle={handleToggleCollectiveScene}
          />
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
        <div className="text-sm text-white truncate">
          {dj.chatUsername || dj.name || dj.displayName}
        </div>
        {dj.name && dj.name !== dj.chatUsername && (
          <div className="text-xs text-gray-500 truncate">{dj.name}</div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 mr-2 flex-shrink-0">
        <div className="flex items-center gap-1">
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
        <div className="text-[10px] text-gray-500 whitespace-nowrap">
          Next show: {formatNextSlot(dj.nextSlotStart)}
        </div>
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

function DjGroup({
  title,
  djs,
  emptyLabel,
  scenes,
  onToggle,
  onSetResidency,
}: {
  title: string;
  djs: DjForScenesAdmin[];
  emptyLabel: string;
  scenes: SceneSerialized[];
  onToggle: (dj: DjForScenesAdmin, sceneId: string) => void;
  onSetResidency: (dj: DjForScenesAdmin, cadence: ResidencyCadence | null) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-xs uppercase tracking-[0.2em] text-gray-400">{title}</h3>
        <span className="text-xs text-gray-600">{djs.length}</span>
      </div>
      {djs.length === 0 ? (
        <div className="text-gray-600 text-xs py-4">{emptyLabel}</div>
      ) : (
        <div className="space-y-2">
          {djs.map((dj) => (
            <DjRow
              key={dj.userId}
              dj={dj}
              scenes={scenes}
              onToggle={onToggle}
              onSetResidency={onSetResidency}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function formatNextSlot(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function CollectiveRow({
  collective,
  scenes,
  onToggle,
}: {
  collective: CollectiveForScenesAdmin;
  scenes: SceneSerialized[];
  onToggle: (collective: CollectiveForScenesAdmin, sceneId: string) => void;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-[#1f1f1f] rounded-lg border border-gray-800">
      <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-800 flex-shrink-0">
        {collective.photoUrl ? (
          <Image
            src={collective.photoUrl}
            alt={collective.name}
            width={40}
            height={40}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
            {collective.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{collective.name}</div>
        {collective.slug && (
          <div className="text-xs text-gray-500 truncate">/{collective.slug}</div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 justify-end">
        {scenes.map((scene) => {
          const active = collective.sceneIds?.includes(scene.id);
          return (
            <button
              key={scene.id}
              onClick={() => onToggle(collective, scene.id)}
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

function CollectiveGroup({
  title,
  collectives,
  emptyLabel,
  scenes,
  onToggle,
}: {
  title: string;
  collectives: CollectiveForScenesAdmin[];
  emptyLabel: string;
  scenes: SceneSerialized[];
  onToggle: (collective: CollectiveForScenesAdmin, sceneId: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-xs uppercase tracking-[0.2em] text-gray-400">{title}</h3>
        <span className="text-xs text-gray-600">{collectives.length}</span>
      </div>
      {collectives.length === 0 ? (
        <div className="text-gray-600 text-xs py-4">{emptyLabel}</div>
      ) : (
        <div className="space-y-2">
          {collectives.map((c) => (
            <CollectiveRow
              key={c.collectiveId}
              collective={c}
              scenes={scenes}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
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
