'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getAuth } from 'firebase/auth';
import { ArchiveSerialized } from '@/types/broadcast';
import { useScenesData, resolveArchiveScenes } from '@/hooks/useScenesData';

type RenderJob = {
  id: string;
  archiveId: string;
  archiveSlug: string;
  recordingUrl: string;
  durationSec: number;
  renderData: {
    showName: string;
    djName: string;
    djPhotoUrl: string;
    djGenres: string[];
    djDescription: string | null;
    sceneSlug: string | null;
  };
  status: 'queued' | 'rendering' | 'done' | 'failed';
  progressPct?: number;
  outputUrl?: string;
  error?: string;
  createdAt: number;
};

type EditState = {
  showName: string;
  djName: string;
  djPhotoUrl: string;
  djGenres: string[]; // comma-separated in input, parsed on commit
  djDescription: string;
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function getAuthToken(): Promise<string | null> {
  const user = getAuth().currentUser;
  if (!user) return null;
  return user.getIdToken();
}

function archiveToEditState(archive: ArchiveSerialized): EditState {
  const djName = archive.djs.map((d) => d.name).filter(Boolean).join(' & ') || archive.djs[0]?.name || '';
  const djPhotoUrl = archive.showImageUrl || archive.djs[0]?.photoUrl || '';
  const djGenres = Array.from(
    new Set(archive.djs.flatMap((d) => d.genres || []).filter((g): g is string => typeof g === 'string' && g.length > 0))
  );
  // Default the bio to the first DJ's snapshot (admin can edit per render).
  const djDescription = archive.djs[0]?.bio ?? '';
  return {
    showName: archive.showName,
    djName,
    djPhotoUrl,
    djGenres,
    djDescription,
  };
}

export function YouTubeRenderTab() {
  const [archives, setArchives] = useState<ArchiveSerialized[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ArchiveSerialized | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [genresInput, setGenresInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [backfillState, setBackfillState] = useState<
    | { kind: 'idle' }
    | { kind: 'running'; mode: 'dry-run' | 'execute' }
    | { kind: 'result'; mode: 'DRY_RUN' | 'EXECUTED'; payload: Record<string, unknown> }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const { djSceneMap } = useScenesData();

  // First non-grid scene slug for the selected archive — same logic as the
  // /radio archive player. Passed through to the render page so the preview
  // and final mp4 show the scene icon next to the play button.
  const sceneSlug = useMemo(() => {
    if (!selected) return null;
    const scenes = resolveArchiveScenes(selected, djSceneMap);
    return scenes.find((s) => s !== 'grid') ?? null;
  }, [selected, djSceneMap]);

  const fetchArchives = useCallback(async () => {
    try {
      const res = await fetch('/api/archives?includePrivate=true');
      if (!res.ok) throw new Error('Failed to load archives');
      const data = await res.json();
      setArchives(data.archives || []);
    } catch {
      // ignore — UI shows empty list
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) return;
    try {
      const res = await fetch('/api/youtube-render/jobs', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch {
      // ignore — keep last list
    }
  }, []);

  useEffect(() => {
    fetchArchives();
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [fetchArchives, fetchJobs]);

  const filteredArchives = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return archives;
    return archives.filter((a) => {
      if (a.showName.toLowerCase().includes(q)) return true;
      if (a.djs.some((d) => d.name?.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [archives, search]);

  const handleSelect = (archive: ArchiveSerialized) => {
    setSelected(archive);
    const initialEdit = archiveToEditState(archive);
    setEdit(initialEdit);
    setGenresInput(initialEdit.djGenres.join(', '));
    setSubmitError(null);
  };

  const handleBackfillBios = async (mode: 'dry-run' | 'execute') => {
    setBackfillState({ kind: 'running', mode });
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Not signed in');
      const dryRun = mode === 'dry-run';
      const res = await fetch(`/api/admin/youtube-render/backfill-bios?dryRun=${dryRun}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error || `Failed (${res.status})`);
      }
      setBackfillState({
        kind: 'result',
        mode: payload.mode === 'EXECUTED' ? 'EXECUTED' : 'DRY_RUN',
        payload,
      });
      // After a successful execute, refresh the archive list so the textarea
      // pre-fill picks up the freshly-written bios.
      if (payload.mode === 'EXECUTED') fetchArchives();
    } catch (err) {
      setBackfillState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Backfill failed',
      });
    }
  };

  const previewUrl = useMemo(() => {
    if (!selected || !edit) return null;
    const data = {
      showName: edit.showName,
      djName: edit.djName,
      djPhotoUrl: edit.djPhotoUrl,
      djGenres: edit.djGenres,
      djDescription: edit.djDescription || null,
      durationSec: selected.duration,
      sceneSlug,
    };
    return `/internal/render-mix?data=${encodeURIComponent(JSON.stringify(data))}`;
  }, [selected, edit, sceneSlug]);

  const handleStartRender = async () => {
    if (!selected || !edit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Not signed in');
      const res = await fetch('/api/youtube-render/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          archiveId: selected.id,
          archiveSlug: selected.slug,
          recordingUrl: selected.recordingUrl,
          durationSec: selected.duration,
          renderData: {
            showName: edit.showName,
            djName: edit.djName,
            djPhotoUrl: edit.djPhotoUrl,
            djGenres: edit.djGenres,
            djDescription: edit.djDescription || null,
            sceneSlug,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      setSelected(null);
      setEdit(null);
      fetchJobs();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <BackfillBiosPanel state={backfillState} onRun={handleBackfillBios} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left pane: archive picker + queue */}
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-bold text-white mb-3">Pick an archive</h3>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by show or DJ"
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm mb-3 focus:outline-none focus:border-gray-500"
          />
          <div className="border border-gray-800 rounded max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-gray-500 text-sm">Loading…</div>
            ) : filteredArchives.length === 0 ? (
              <div className="p-4 text-gray-500 text-sm">No archives match.</div>
            ) : (
              filteredArchives.map((a) => {
                const isSelected = selected?.id === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => handleSelect(a)}
                    className={`w-full text-left px-3 py-2 border-b border-gray-800 last:border-b-0 hover:bg-gray-900 transition-colors ${
                      isSelected ? 'bg-gray-900' : ''
                    }`}
                  >
                    <div className="text-white text-sm font-medium truncate">{a.showName}</div>
                    <div className="text-gray-500 text-xs truncate">
                      {a.djs.map((d) => d.name).join(', ')} · {formatDate(a.recordedAt)} · {formatDuration(a.duration)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-bold text-white mb-3">Render queue</h3>
          <div className="space-y-2">
            {jobs.length === 0 ? (
              <div className="text-gray-500 text-sm">No render jobs yet.</div>
            ) : (
              jobs.map((j) => (
                <div key={j.id} className="border border-gray-800 rounded p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-white text-sm font-medium truncate">{j.renderData.showName}</div>
                      <div className="text-gray-500 text-xs truncate">{j.renderData.djName}</div>
                    </div>
                    <StatusBadge status={j.status} progressPct={j.progressPct} />
                  </div>
                  {j.status === 'done' && j.outputUrl && (
                    <a
                      href={j.outputUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-blue-400 hover:text-blue-300 text-xs underline"
                    >
                      Download mp4
                    </a>
                  )}
                  {j.status === 'failed' && j.error && (
                    <div className="mt-2 text-red-400 text-xs">{j.error}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Right pane: edit + preview */}
      <div className="space-y-4">
        {!selected || !edit ? (
          <div className="text-gray-500 text-sm">Select an archive to preview and render.</div>
        ) : (
          <>
            <h3 className="text-lg font-bold text-white">Customize</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Show name</label>
                <input
                  type="text"
                  value={edit.showName}
                  onChange={(e) => setEdit({ ...edit, showName: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">DJ name</label>
                <input
                  type="text"
                  value={edit.djName}
                  onChange={(e) => setEdit({ ...edit, djName: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Genres (comma-separated)</label>
                <input
                  type="text"
                  value={genresInput}
                  onChange={(e) => {
                    setGenresInput(e.target.value);
                    const parsed = e.target.value
                      .split(',')
                      .map((g) => g.trim())
                      .filter(Boolean);
                    setEdit({ ...edit, djGenres: parsed });
                  }}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Bio (optional)</label>
                <textarea
                  value={edit.djDescription}
                  onChange={(e) => setEdit({ ...edit, djDescription: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm"
                />
              </div>
            </div>

            <div>
              <h4 className="text-xs text-gray-400 mb-2">Preview (1920×1080, scaled)</h4>
              <PreviewFrame previewUrl={previewUrl} />
            </div>

            <button
              onClick={handleStartRender}
              disabled={submitting}
              className="w-full px-4 py-2 bg-white text-black text-sm font-bold rounded hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting…' : 'Start render'}
            </button>
            {submitError && <div className="text-red-400 text-xs">{submitError}</div>}
          </>
        )}
      </div>
      </div>
    </div>
  );
}

type BackfillState =
  | { kind: 'idle' }
  | { kind: 'running'; mode: 'dry-run' | 'execute' }
  | { kind: 'result'; mode: 'DRY_RUN' | 'EXECUTED'; payload: Record<string, unknown> }
  | { kind: 'error'; message: string };

function BackfillBiosPanel({
  state,
  onRun,
}: {
  state: BackfillState;
  onRun: (mode: 'dry-run' | 'execute') => void;
}) {
  const isRunning = state.kind === 'running';
  const dryRunResult =
    state.kind === 'result' && state.mode === 'DRY_RUN' ? state.payload : null;
  const executedResult =
    state.kind === 'result' && state.mode === 'EXECUTED' ? state.payload : null;
  const error = state.kind === 'error' ? state.message : null;

  return (
    <div className="border border-gray-800 rounded p-4 bg-gray-950">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-white text-sm font-medium">Backfill DJ bios on existing archives</div>
          <div className="text-gray-500 text-xs mt-0.5">
            One-time. Pulls each DJ&apos;s bio from their profile onto the archive doc. Won&apos;t overwrite bios that
            already exist.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onRun('dry-run')}
            disabled={isRunning}
            className="px-3 py-1.5 bg-gray-800 text-white text-xs rounded hover:bg-gray-700 disabled:opacity-50"
          >
            {isRunning && state.mode === 'dry-run' ? 'Running…' : 'Dry-run'}
          </button>
          <button
            onClick={() => {
              if (confirm('Write DJ bios to all matching archives? This is a one-time operation.')) {
                onRun('execute');
              }
            }}
            disabled={isRunning || !dryRunResult}
            className="px-3 py-1.5 bg-white text-black text-xs font-bold rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            title={!dryRunResult ? 'Run dry-run first' : 'Apply backfill'}
          >
            {isRunning && state.mode === 'execute' ? 'Writing…' : 'Execute'}
          </button>
        </div>
      </div>

      {error && <div className="mt-3 text-red-400 text-xs">{error}</div>}

      {dryRunResult && (
        <pre className="mt-3 text-xs text-gray-300 bg-black/40 rounded p-3 overflow-auto max-h-72">
{JSON.stringify(dryRunResult, null, 2)}
        </pre>
      )}
      {executedResult && (
        <div className="mt-3 text-green-400 text-xs">
          Done. {String((executedResult as { archivesUpdated?: number }).archivesUpdated ?? 0)} archive
          {(executedResult as { archivesUpdated?: number }).archivesUpdated === 1 ? '' : 's'} updated.
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, progressPct }: { status: RenderJob['status']; progressPct?: number }) {
  const base = 'text-xs px-2 py-0.5 rounded font-medium flex-shrink-0';
  if (status === 'queued') return <span className={`${base} bg-gray-800 text-gray-400`}>Queued</span>;
  if (status === 'rendering')
    return (
      <span className={`${base} bg-blue-900/40 text-blue-300`}>
        Rendering {typeof progressPct === 'number' ? `${Math.round(progressPct)}%` : ''}
      </span>
    );
  if (status === 'done') return <span className={`${base} bg-green-900/40 text-green-300`}>Done</span>;
  return <span className={`${base} bg-red-900/40 text-red-300`}>Failed</span>;
}

/**
 * 1920×1080 iframe scaled down to fit a responsive 16:9 container. Uses a
 * ResizeObserver to track the wrapper width and applies a transform: scale()
 * to the iframe so the preview is exactly the dimensions the worker will use.
 */
function PreviewFrame({ previewUrl }: { previewUrl: string | null }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = () => setScale(wrapper.clientWidth / 1920);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="relative w-full overflow-hidden bg-black border border-gray-800"
      style={{ aspectRatio: '16 / 9' }}
    >
      {previewUrl && (
        <iframe
          key={previewUrl}
          src={previewUrl}
          className="absolute top-0 left-0 origin-top-left border-0"
          style={{ width: '1920px', height: '1080px', transform: `scale(${scale})` }}
          sandbox="allow-scripts allow-same-origin"
        />
      )}
    </div>
  );
}
