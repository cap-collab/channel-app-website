'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { useAuthContext } from '@/contexts/AuthContext';
import type { SceneSerialized } from '@/types/scenes';
import type { DjForScenesAdmin, ResidencyCadence } from '@/app/api/admin/scenes/djs/route';
import type { CollectiveForScenesAdmin } from '@/app/api/admin/scenes/collectives/route';
import type { DjEngagementResponse, DjEngagementCounts } from '@/app/api/admin/scenes/dj-engagement/route';

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
  const [engagement, setEngagement] = useState<DjEngagementResponse | null>(null);
  const [engagementRefreshing, setEngagementRefreshing] = useState(false);

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

  const fetchEngagement = useCallback(
    async (force = false) => {
      const url = `/api/admin/scenes/dj-engagement${force ? '?force=1' : ''}`;
      const res = await authedFetch(url);
      if (!res.ok) throw new Error('Failed to load engagement counts');
      const data = (await res.json()) as DjEngagementResponse;
      setEngagement(data);
    },
    [authedFetch]
  );

  const handleRefreshEngagement = useCallback(async () => {
    setEngagementRefreshing(true);
    try {
      await fetchEngagement(true);
    } catch (err) {
      console.error(err);
    } finally {
      setEngagementRefreshing(false);
    }
  }, [fetchEngagement]);

  useEffect(() => {
    if (!user) return;
    setIsLoading(true);
    Promise.all([fetchScenes(), fetchDjs(), fetchCollectives()])
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setIsLoading(false));
    // Engagement is heavy; fetch lazily and don't block the page.
    fetchEngagement().catch((err) => console.error(err));
  }, [user, fetchScenes, fetchDjs, fetchCollectives, fetchEngagement]);

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

  // Inverse maps derived from the full DJ list. Re-derive whenever djs changes
  // (which happens on every optimistic update), so both sides of a relationship
  // re-render in sync.
  const inverseMaps = useMemo(() => {
    const crewMembersByLeadUid = new Map<string, DjForScenesAdmin[]>();
    const listedInAudienceOfByUid = new Map<string, DjForScenesAdmin[]>();
    for (const d of djs) {
      if (d.affiliatedWithUid) {
        const bucket = crewMembersByLeadUid.get(d.affiliatedWithUid) ?? [];
        bucket.push(d);
        crewMembersByLeadUid.set(d.affiliatedWithUid, bucket);
      }
      for (const audUid of d.audienceDjUids ?? []) {
        const bucket = listedInAudienceOfByUid.get(audUid) ?? [];
        bucket.push(d);
        listedInAudienceOfByUid.set(audUid, bucket);
      }
    }
    return { crewMembersByLeadUid, listedInAudienceOfByUid };
  }, [djs]);

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

  const handleSetAffiliation = useCallback(
    async (dj: DjForScenesAdmin, affiliatedWithUid: string | null) => {
      setDjs((prev) =>
        prev.map((d) =>
          d.userId === dj.userId ? { ...d, affiliatedWithUid: affiliatedWithUid ?? undefined } : d
        )
      );

      try {
        const res = await authedFetch('/api/admin/scenes/dj-affiliation', {
          method: 'PATCH',
          body: JSON.stringify({ userId: dj.userId, affiliatedWithUid }),
        });
        if (!res.ok) throw new Error('Failed to update');
      } catch {
        await fetchDjs();
      }
    },
    [authedFetch, fetchDjs]
  );

  const handleSetAudience = useCallback(
    async (dj: DjForScenesAdmin, audienceDjUids: string[]) => {
      setDjs((prev) =>
        prev.map((d) => (d.userId === dj.userId ? { ...d, audienceDjUids } : d))
      );

      try {
        const res = await authedFetch('/api/admin/scenes/dj-audience', {
          method: 'PATCH',
          body: JSON.stringify({ userId: dj.userId, audienceDjUids }),
        });
        if (!res.ok) throw new Error('Failed to update');
      } catch {
        await fetchDjs();
      }
    },
    [authedFetch, fetchDjs]
  );

  // Inverse-edit: write to the child's affiliatedWithUid from the parent's row.
  // value=true → child joins parent's crew; value=false → child leaves it.
  const handleSetChildAffiliation = useCallback(
    async (parent: DjForScenesAdmin, child: DjForScenesAdmin, value: boolean) => {
      if (value && child.affiliatedWithUid && child.affiliatedWithUid !== parent.userId) {
        const currentLead = djs.find((d) => d.userId === child.affiliatedWithUid);
        const currentLeadName = currentLead?.chatUsername || currentLead?.name || currentLead?.displayName || 'another DJ';
        const childName = child.chatUsername || child.name || child.displayName;
        const ok = window.confirm(
          `${childName} is currently affiliated with ${currentLeadName}. Replace?`
        );
        if (!ok) return;
      }
      const nextLead = value ? parent.userId : null;
      setDjs((prev) =>
        prev.map((d) =>
          d.userId === child.userId ? { ...d, affiliatedWithUid: nextLead ?? undefined } : d
        )
      );
      try {
        const res = await authedFetch('/api/admin/scenes/dj-affiliation', {
          method: 'PATCH',
          body: JSON.stringify({ userId: child.userId, affiliatedWithUid: nextLead }),
        });
        if (!res.ok) throw new Error('Failed to update');
      } catch {
        await fetchDjs();
      }
    },
    [authedFetch, djs, fetchDjs]
  );

  // Inverse-edit: from DJ Y's "Listed in audience of" row, add/remove Y to/from
  // the audienceDjUids array on the other DJ X's doc.
  const handleSetMembershipInAudience = useCallback(
    async (
      memberDj: DjForScenesAdmin,        // the DJ being listed (Y)
      ownerDj: DjForScenesAdmin,         // the DJ whose audience list we're writing to (X)
      value: boolean,
    ) => {
      const currentOwnerAudience = ownerDj.audienceDjUids ?? [];
      const next = value
        ? currentOwnerAudience.includes(memberDj.userId)
          ? currentOwnerAudience
          : [...currentOwnerAudience, memberDj.userId]
        : currentOwnerAudience.filter((u) => u !== memberDj.userId);
      setDjs((prev) =>
        prev.map((d) => (d.userId === ownerDj.userId ? { ...d, audienceDjUids: next } : d))
      );
      try {
        const res = await authedFetch('/api/admin/scenes/dj-audience', {
          method: 'PATCH',
          body: JSON.stringify({ userId: ownerDj.userId, audienceDjUids: next }),
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
      <div className="flex items-center justify-between text-[10px] text-gray-500">
        <div>
          Engagement counts {engagement ? `as of ${new Date(engagement.computedAt).toLocaleString()}` : 'loading…'}
        </div>
        <button
          onClick={handleRefreshEngagement}
          disabled={engagementRefreshing}
          className="px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-50"
        >
          {engagementRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
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
            allDjs={djs}
            crewMembersByLeadUid={inverseMaps.crewMembersByLeadUid}
            listedInAudienceOfByUid={inverseMaps.listedInAudienceOfByUid}
            engagementCounts={engagement?.counts}
            onToggle={handleToggleDjScene}
            onSetResidency={handleSetResidency}
            onSetAffiliation={handleSetAffiliation}
            onSetAudience={handleSetAudience}
            onSetChildAffiliation={handleSetChildAffiliation}
            onSetMembershipInAudience={handleSetMembershipInAudience}
          />
          <DjGroup
            title="Not residents"
            djs={nonResidents}
            emptyLabel="No non-resident DJs in this view."
            scenes={scenes}
            allDjs={djs}
            crewMembersByLeadUid={inverseMaps.crewMembersByLeadUid}
            listedInAudienceOfByUid={inverseMaps.listedInAudienceOfByUid}
            engagementCounts={engagement?.counts}
            onToggle={handleToggleDjScene}
            onSetResidency={handleSetResidency}
            onSetAffiliation={handleSetAffiliation}
            onSetAudience={handleSetAudience}
            onSetChildAffiliation={handleSetChildAffiliation}
            onSetMembershipInAudience={handleSetMembershipInAudience}
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
  allDjs,
  crewMembers,
  listedInAudienceOf,
  engagement,
  onToggle,
  onSetResidency,
  onSetAffiliation,
  onSetAudience,
  onSetChildAffiliation,
  onSetMembershipInAudience,
}: {
  dj: DjForScenesAdmin;
  scenes: SceneSerialized[];
  allDjs: DjForScenesAdmin[];
  crewMembers: DjForScenesAdmin[];        // DJs whose affiliatedWithUid === dj.userId
  listedInAudienceOf: DjForScenesAdmin[]; // DJs whose audienceDjUids includes dj.userId
  engagement?: DjEngagementCounts;
  onToggle: (dj: DjForScenesAdmin, sceneId: string) => void;
  onSetResidency: (dj: DjForScenesAdmin, cadence: ResidencyCadence | null) => void;
  onSetAffiliation: (dj: DjForScenesAdmin, affiliatedWithUid: string | null) => void;
  onSetAudience: (dj: DjForScenesAdmin, audienceDjUids: string[]) => void;
  onSetChildAffiliation: (parent: DjForScenesAdmin, child: DjForScenesAdmin, value: boolean) => void;
  onSetMembershipInAudience: (member: DjForScenesAdmin, owner: DjForScenesAdmin, value: boolean) => void;
}) {
  const cadence = dj.residencyCadence;
  const affiliationOptions = useMemo(
    () => allDjs.filter((d) => d.userId !== dj.userId),
    [allDjs, dj.userId]
  );
  // Crew-members picker excludes the current DJ AND any DJ whose lead is
  // already this DJ (those render as removable chips).
  const crewMemberAddOptions = useMemo(() => {
    const inCrew = new Set(crewMembers.map((c) => c.userId));
    return affiliationOptions.filter((d) => !inCrew.has(d.userId));
  }, [affiliationOptions, crewMembers]);
  // Owner-side picker for "Listed in audience of": exclude DJs who already
  // include this DJ in their audienceDjUids.
  const listedInAudienceAddOptions = useMemo(() => {
    const owners = new Set(listedInAudienceOf.map((o) => o.userId));
    return affiliationOptions.filter((d) => !owners.has(d.userId));
  }, [affiliationOptions, listedInAudienceOf]);

  return (
    <div className="flex items-start gap-6 px-4 py-3 bg-[#1f1f1f] rounded-lg border border-gray-800">
      {/* Identity column */}
      <div className="flex items-start gap-3 w-[200px] flex-shrink-0">
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
        <div className="min-w-0">
          <div className="text-sm text-white truncate">
            {dj.chatUsername || dj.name || dj.displayName}
          </div>
          {dj.name && dj.name !== dj.chatUsername && (
            <div className="text-xs text-gray-500 truncate">{dj.name}</div>
          )}
          <div className="text-[10px] text-gray-500 mt-0.5 flex gap-2">
            <span title="On watchlists">👁 {engagement ? engagement.watchlist : '–'}</span>
            <span title="Distinct listeners (hearts ∪ streams)">🎧 {engagement ? engagement.listeners : '–'}</span>
          </div>
        </div>
      </div>

      {/* Residency column */}
      <div className="flex flex-col gap-1 w-[180px] flex-shrink-0">
        <ColumnHeading>Residency</ColumnHeading>
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

      {/* Crew column */}
      <div className="flex flex-col gap-2 w-[260px] flex-shrink-0">
        <ColumnHeading>Crew</ColumnHeading>
        <FieldRow label="Affiliated with">
          <AffiliationPicker
            value={dj.affiliatedWithUid ?? null}
            options={affiliationOptions}
            onChange={(uid) => onSetAffiliation(dj, uid)}
          />
        </FieldRow>
        <FieldRow label="Crew members">
          <ChipPicker
            selected={crewMembers}
            addOptions={crewMemberAddOptions}
            onAdd={(child) => onSetChildAffiliation(dj, child, true)}
            onRemove={(child) => onSetChildAffiliation(dj, child, false)}
          />
        </FieldRow>
      </div>

      {/* Audience column */}
      <div className="flex flex-col gap-2 w-[260px] flex-shrink-0">
        <ColumnHeading>Audience</ColumnHeading>
        <FieldRow label="Borrows from">
          <AudiencePicker
            value={dj.audienceDjUids ?? []}
            options={affiliationOptions}
            onChange={(uids) => onSetAudience(dj, uids)}
          />
        </FieldRow>
        <FieldRow label="Lent to">
          <ChipPicker
            selected={listedInAudienceOf}
            addOptions={listedInAudienceAddOptions}
            onAdd={(owner) => onSetMembershipInAudience(dj, owner, true)}
            onRemove={(owner) => onSetMembershipInAudience(dj, owner, false)}
          />
        </FieldRow>
      </div>

      {/* Scenes column — takes remaining space */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <ColumnHeading>Scenes</ColumnHeading>
        <div className="flex flex-wrap gap-1.5">
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
    </div>
  );
}

function ColumnHeading({ children }: { children: ReactNode }) {
  return (
    <div className="text-[9px] uppercase tracking-[0.18em] text-gray-600 font-medium">
      {children}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[10px] text-gray-500">{label}</div>
      {children}
    </div>
  );
}

// Generic add/remove chip picker used by the two inverse sections.
function ChipPicker({
  selected,
  addOptions,
  onAdd,
  onRemove,
}: {
  selected: DjForScenesAdmin[];
  addOptions: DjForScenesAdmin[];
  onAdd: (dj: DjForScenesAdmin) => void;
  onRemove: (dj: DjForScenesAdmin) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {selected.map((d) => (
        <span
          key={d.userId}
          className="inline-flex items-center gap-1 bg-gray-800 text-gray-200 text-[10px] rounded border border-gray-700 px-1.5 py-0.5"
        >
          {d.chatUsername || d.name || d.displayName}
          <button
            onClick={() => onRemove(d)}
            className="text-gray-500 hover:text-red-400 leading-none"
            aria-label={`Remove ${d.chatUsername || d.displayName}`}
          >
            ×
          </button>
        </span>
      ))}
      <select
        value=""
        onChange={(e) => {
          const uid = e.target.value;
          e.target.value = '';
          if (!uid) return;
          const target = addOptions.find((o) => o.userId === uid);
          if (target) onAdd(target);
        }}
        className="bg-gray-800 text-gray-200 text-[11px] rounded border border-gray-700 px-1.5 py-0.5 max-w-[140px]"
      >
        <option value="">+ add DJ</option>
        {addOptions.map((o) => (
          <option key={o.userId} value={o.userId}>
            {o.chatUsername || o.name || o.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}

function DjGroup({
  title,
  djs,
  emptyLabel,
  scenes,
  allDjs,
  crewMembersByLeadUid,
  listedInAudienceOfByUid,
  engagementCounts,
  onToggle,
  onSetResidency,
  onSetAffiliation,
  onSetAudience,
  onSetChildAffiliation,
  onSetMembershipInAudience,
}: {
  title: string;
  djs: DjForScenesAdmin[];
  emptyLabel: string;
  scenes: SceneSerialized[];
  allDjs: DjForScenesAdmin[];
  crewMembersByLeadUid: Map<string, DjForScenesAdmin[]>;
  listedInAudienceOfByUid: Map<string, DjForScenesAdmin[]>;
  engagementCounts?: Record<string, DjEngagementCounts>;
  onToggle: (dj: DjForScenesAdmin, sceneId: string) => void;
  onSetResidency: (dj: DjForScenesAdmin, cadence: ResidencyCadence | null) => void;
  onSetAffiliation: (dj: DjForScenesAdmin, affiliatedWithUid: string | null) => void;
  onSetAudience: (dj: DjForScenesAdmin, audienceDjUids: string[]) => void;
  onSetChildAffiliation: (parent: DjForScenesAdmin, child: DjForScenesAdmin, value: boolean) => void;
  onSetMembershipInAudience: (member: DjForScenesAdmin, owner: DjForScenesAdmin, value: boolean) => void;
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
              allDjs={allDjs}
              crewMembers={crewMembersByLeadUid.get(dj.userId) ?? []}
              listedInAudienceOf={listedInAudienceOfByUid.get(dj.userId) ?? []}
              engagement={engagementCounts?.[dj.userId]}
              onToggle={onToggle}
              onSetResidency={onSetResidency}
              onSetAffiliation={onSetAffiliation}
              onSetAudience={onSetAudience}
              onSetChildAffiliation={onSetChildAffiliation}
              onSetMembershipInAudience={onSetMembershipInAudience}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AudiencePicker({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: DjForScenesAdmin[];
  onChange: (uids: string[]) => void;
}) {
  const labelByUid = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.userId, o.chatUsername || o.name || o.displayName);
    return m;
  }, [options]);

  const selected = value;
  const unselectedOptions = useMemo(
    () => options.filter((o) => !selected.includes(o.userId)),
    [options, selected]
  );

  const handleAdd = (uid: string) => {
    if (!uid || selected.includes(uid)) return;
    onChange([...selected, uid]);
  };
  const handleRemove = (uid: string) => {
    onChange(selected.filter((u) => u !== uid));
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {selected.map((uid) => (
        <span
          key={uid}
          className="inline-flex items-center gap-1 bg-gray-800 text-gray-200 text-[10px] rounded border border-gray-700 px-1.5 py-0.5"
        >
          {labelByUid.get(uid) ?? uid.slice(0, 6)}
          <button
            onClick={() => handleRemove(uid)}
            className="text-gray-500 hover:text-red-400 leading-none"
            aria-label={`Remove ${labelByUid.get(uid) ?? uid}`}
          >
            ×
          </button>
        </span>
      ))}
      <select
        value=""
        onChange={(e) => {
          handleAdd(e.target.value);
          e.target.value = '';
        }}
        className="bg-gray-800 text-gray-200 text-[11px] rounded border border-gray-700 px-1.5 py-0.5 max-w-[140px]"
      >
        <option value="">+ add DJ</option>
        {unselectedOptions.map((o) => (
          <option key={o.userId} value={o.userId}>
            {o.chatUsername || o.name || o.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}

function AffiliationPicker({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: DjForScenesAdmin[];
  onChange: (uid: string | null) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="bg-gray-800 text-gray-200 text-[11px] rounded border border-gray-700 px-1.5 py-0.5 max-w-[200px]"
    >
      <option value="">— none —</option>
      {options.map((o) => (
        <option key={o.userId} value={o.userId}>
          {o.chatUsername || o.name || o.displayName}
        </option>
      ))}
    </select>
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
