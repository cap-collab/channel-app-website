'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useAuthContext } from '@/contexts/AuthContext';
import type { SceneSerialized } from '@/types/scenes';
import type { DjForScenesAdmin } from '@/app/api/admin/scenes/djs/route';

type SubView = 'djs' | 'manage';

const COLOR_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Amber / earthy', value: 'bg-amber-900/40 text-amber-300 border-amber-800' },
  { label: 'Fuchsia / disco', value: 'bg-fuchsia-900/40 text-fuchsia-300 border-fuchsia-800' },
  { label: 'Black / grid', value: 'bg-black text-gray-200 border-gray-700' },
  { label: 'Cyan', value: 'bg-cyan-900/40 text-cyan-300 border-cyan-800' },
  { label: 'Violet', value: 'bg-violet-900/40 text-violet-300 border-violet-800' },
  { label: 'Green', value: 'bg-green-900/40 text-green-300 border-green-800' },
  { label: 'Red', value: 'bg-red-900/40 text-red-300 border-red-800' },
];

const UNASSIGNED_FILTER = '__unassigned__';
const ALL_FILTER = '__all__';

export function ScenesTab() {
  const { user } = useAuthContext();
  const [subView, setSubView] = useState<SubView>('djs');
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

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <button
          onClick={() => setSubView('djs')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            subView === 'djs' ? 'bg-white text-black' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          DJs
        </button>
        <button
          onClick={() => setSubView('manage')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            subView === 'manage' ? 'bg-white text-black' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Manage scenes
        </button>
      </div>

      {subView === 'djs' ? (
        <DjsView
          scenes={scenes}
          djs={filteredDjs}
          sceneFilter={sceneFilter}
          setSceneFilter={setSceneFilter}
          counts={counts}
          onToggle={handleToggleDjScene}
        />
      ) : (
        <ManageView
          scenes={scenes}
          authedFetch={authedFetch}
          onChanged={fetchScenes}
        />
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
  label: string;
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

function DjsView({
  scenes,
  djs,
  sceneFilter,
  setSceneFilter,
  counts,
  onToggle,
}: {
  scenes: SceneSerialized[];
  djs: DjForScenesAdmin[];
  sceneFilter: string;
  setSceneFilter: (v: string) => void;
  counts: Record<string, number>;
  onToggle: (dj: DjForScenesAdmin, sceneId: string) => void;
}) {
  const totalAssigned = djs.length;

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
            label={`${scene.emoji} ${scene.name}`}
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

      {djs.length === 0 ? (
        <div className="text-gray-500 text-sm py-12 text-center">No DJs in this view.</div>
      ) : (
        <div className="space-y-2">
          {djs.map((dj) => (
            <DjRow key={dj.userId} dj={dj} scenes={scenes} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

function DjRow({
  dj,
  scenes,
  onToggle,
}: {
  dj: DjForScenesAdmin;
  scenes: SceneSerialized[];
  onToggle: (dj: DjForScenesAdmin, sceneId: string) => void;
}) {
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
              <span className="mr-1">{scene.emoji}</span>
              {scene.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ManageView({
  scenes,
  authedFetch,
  onChanged,
}: {
  scenes: SceneSerialized[];
  authedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<{ id?: string; name: string; emoji: string; color: string; order: string; description: string }>({
    name: '',
    emoji: '',
    color: COLOR_PRESETS[0].value,
    order: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const resetDraft = () => {
    setDraft({ name: '', emoji: '', color: COLOR_PRESETS[0].value, order: '', description: '' });
    setEditingId(null);
  };

  const beginEdit = (scene: SceneSerialized) => {
    setEditingId(scene.id);
    setDraft({
      id: scene.id,
      name: scene.name,
      emoji: scene.emoji,
      color: scene.color,
      order: String(scene.order),
      description: scene.description ?? '',
    });
  };

  const handleSave = async () => {
    if (!draft.name || !draft.emoji) {
      setLocalError('Name and emoji are required.');
      return;
    }
    setLocalError(null);
    setSaving(true);
    try {
      const body = {
        name: draft.name,
        emoji: draft.emoji,
        color: draft.color,
        order: draft.order ? Number(draft.order) : 0,
        description: draft.description,
      };
      const res = editingId
        ? await authedFetch(`/api/admin/scenes/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await authedFetch('/api/admin/scenes', { method: 'POST', body: JSON.stringify({ ...body, id: draft.id }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save');
      }
      await onChanged();
      resetDraft();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete scene "${id}"? This will also remove it from every DJ tagged with it.`)) return;
    try {
      const res = await authedFetch(`/api/admin/scenes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      await onChanged();
      if (editingId === id) resetDraft();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Existing scenes</div>
        {scenes.length === 0 && (
          <div className="text-gray-500 text-sm py-6">No scenes yet — create one on the right.</div>
        )}
        {scenes.map((scene) => (
          <div
            key={scene.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
              editingId === scene.id ? 'border-white bg-[#1f1f1f]' : 'border-gray-800 bg-[#1a1a1a]'
            }`}
          >
            <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full border text-lg ${scene.color}`}>
              {scene.emoji}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white">{scene.name}</div>
              <div className="text-xs text-gray-500 truncate">
                /{scene.id} · order {scene.order}
                {scene.description ? ` · ${scene.description}` : ''}
              </div>
            </div>
            <button
              onClick={() => beginEdit(scene)}
              className="px-2 py-1 text-xs rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
            >
              Edit
            </button>
            <button
              onClick={() => handleDelete(scene.id)}
              className="px-2 py-1 text-xs rounded bg-red-900/40 text-red-300 hover:bg-red-900/60"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-3 bg-[#1a1a1a] border border-gray-800 rounded-lg p-4">
        <div className="text-xs uppercase tracking-wider text-gray-500">
          {editingId ? `Editing "${editingId}"` : 'New scene'}
        </div>
        {!editingId && (
          <label className="block text-xs text-gray-400">
            Slug (optional — derived from name)
            <input
              value={draft.id ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
              placeholder="spiral"
              className="mt-1 w-full px-2 py-1 bg-black border border-gray-700 rounded text-sm text-white"
            />
          </label>
        )}
        <label className="block text-xs text-gray-400">
          Name
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Spiral"
            className="mt-1 w-full px-2 py-1 bg-black border border-gray-700 rounded text-sm text-white"
          />
        </label>
        <label className="block text-xs text-gray-400">
          Emoji
          <input
            value={draft.emoji}
            onChange={(e) => setDraft((d) => ({ ...d, emoji: e.target.value }))}
            placeholder="🌀"
            className="mt-1 w-full px-2 py-1 bg-black border border-gray-700 rounded text-sm text-white"
          />
        </label>
        <div>
          <div className="text-xs text-gray-400 mb-1">Color</div>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, color: preset.value }))}
                className={`px-2 py-1 text-[11px] rounded-full border ${preset.value} ${
                  draft.color === preset.value ? 'ring-2 ring-white' : 'opacity-80 hover:opacity-100'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <input
            value={draft.color}
            onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
            placeholder="Tailwind classes"
            className="mt-2 w-full px-2 py-1 bg-black border border-gray-700 rounded text-xs text-gray-300 font-mono"
          />
        </div>
        <label className="block text-xs text-gray-400">
          Order
          <input
            type="number"
            value={draft.order}
            onChange={(e) => setDraft((d) => ({ ...d, order: e.target.value }))}
            placeholder="0"
            className="mt-1 w-full px-2 py-1 bg-black border border-gray-700 rounded text-sm text-white"
          />
        </label>
        <label className="block text-xs text-gray-400">
          Description
          <textarea
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            rows={3}
            className="mt-1 w-full px-2 py-1 bg-black border border-gray-700 rounded text-sm text-white"
          />
        </label>
        {localError && <div className="text-xs text-red-400">{localError}</div>}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded bg-white text-black hover:bg-gray-200 disabled:opacity-50"
          >
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create scene'}
          </button>
          {editingId && (
            <button
              onClick={resetDraft}
              className="px-3 py-1.5 text-sm rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
