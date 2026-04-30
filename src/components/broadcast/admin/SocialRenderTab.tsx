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
  // Description-only metadata. Worker doesn't read these — they exist
  // solely so the admin tab can build YouTube + SoundCloud title/description
  // text on the Done jobs panel.
  djUsername?: string | null;
  djLocation?: string | null;
  tipButtonLink?: string | null;
  // Per-platform consent snapshots taken at job-creation time. The worker
  // produces YouTube outputs only when youtubeOptIn !== false, and
  // SoundCloud outputs only when soundcloudOptIn !== false. Default = true.
  youtubeOptIn?: boolean;
  soundcloudOptIn?: boolean;
  status: 'queued' | 'rendering' | 'done' | 'failed';
  progressPct?: number;
  outputUrl?: string;             // YouTube MP4
  soundcloudAudioUrl?: string;    // M4A (lossless audio extract)
  soundcloudImageUrl?: string;    // 1500x1500 cover JPG
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

export function SocialRenderTab() {
  const [archives, setArchives] = useState<ArchiveSerialized[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ArchiveSerialized | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [genresInput, setGenresInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
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

  // archiveId → primary DJ. Used by DoneJobActions to live-read current
  // opt-in flags + Instagram handle (from /api/archives's djProfile
  // enrichment), so the Done panel reflects each DJ's current consent
  // state rather than whatever was snapshotted when the job was created.
  // Falls back to undefined for jobs whose archive has been deleted —
  // DoneJobActions then uses the job's own snapshot as a backup.
  const archiveDjByArchiveId = useMemo(() => {
    const map = new Map<string, ArchiveSerialized['djs'][number]>();
    for (const a of archives) {
      if (a.djs[0]) map.set(a.id, a.djs[0]);
    }
    return map;
  }, [archives]);

  // archiveIds that already have a non-failed render job (queued, rendering,
  // or done). Failed jobs are NOT counted — if a render failed, the archive
  // should still appear in the picker so the admin can retry.
  const blockedArchiveIds = useMemo(() => {
    const blocked = new Set<string>();
    for (const j of jobs) {
      if (j.status === 'failed') continue;
      if (j.archiveId) blocked.add(j.archiveId);
    }
    return blocked;
  }, [jobs]);

  const filteredArchives = useMemo(() => {
    const q = search.trim().toLowerCase();
    return archives.filter((a) => {
      // Hide archives shorter than 25 minutes — too short to be worth a
      // social upload and likely test/aborted recordings.
      if ((a.duration || 0) < 25 * 60) return false;
      // Hide archives where the primary DJ has opted out of BOTH platforms.
      // If at least one of YouTube/SoundCloud is opted in, the archive
      // belongs in the picker (the render produces the relevant outputs
      // and skips the others). Absence of the field = opted in (default).
      const dj = a.djs[0];
      const ytOff = dj?.youtubeOptIn === false;
      const scOff = dj?.soundcloudOptIn === false;
      if (ytOff && scOff) return false;
      // Hide archives that already have a render in flight or finished.
      if (blockedArchiveIds.has(a.id)) return false;
      // Search filter (no query = show all remaining).
      if (!q) return true;
      if (a.showName.toLowerCase().includes(q)) return true;
      if (a.djs.some((d) => d.name?.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [archives, search, blockedArchiveIds]);

  const handleSelect = (archive: ArchiveSerialized) => {
    setSelected(archive);
    const initialEdit = archiveToEditState(archive);
    setEdit(initialEdit);
    setGenresInput(initialEdit.djGenres.join(', '));
    setSubmitError(null);
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
          recordedAt: selected.recordedAt ?? null,
          // Description-metadata (not used by the worker; only by the admin
          // tab's Copy-description buttons). Pulled from /api/archives which
          // live-enriches these from djProfile at request time.
          djUsername: selected.djs[0]?.username ?? null,
          djLocation: selected.djs[0]?.location ?? null,
          tipButtonLink: selected.djs[0]?.tipButtonLink ?? null,
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
                  {j.status === 'done' && (
                    <DoneJobActions job={j} liveDj={archiveDjByArchiveId.get(j.archiveId)} />
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
 * Action rows shown under a completed render. One row per platform the DJ
 * opted into. Each row has Download (R2 sets Content-Disposition: attachment
 * so the browser saves the file) plus Copy-title and Copy-description
 * buttons that put platform-ready text on the clipboard.
 *
 * `liveDj` is the current state of the archive's primary DJ pulled from
 * /api/archives — preferred over the job's own snapshot so legacy renders
 * honor today's consent + show today's Instagram handle. Falls back to the
 * snapshot only if the archive was deleted (no liveDj available).
 */
function DoneJobActions({
  job,
  liveDj,
}: {
  job: RenderJob;
  liveDj: ArchiveSerialized['djs'][number] | undefined;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const djNameDisplay = job.renderData.djName;
  const showNameDisplay = job.renderData.showName;

  const recordedAt = new Date(job.createdAt);
  const monthYear = recordedAt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // username + tipButtonLink + location come from the job doc (snapshotted
  // at submission time from /api/archives, which live-enriches from
  // djProfile). Older jobs from before this was wired won't have them — we
  // omit those lines for those.
  const djUsername = job.djUsername
    ? job.djUsername.replace(/\s+/g, '').toLowerCase()
    : null;
  const tipButtonLink = job.tipButtonLink || null;
  const djLocation = job.djLocation?.trim() || null;

  // ─── YouTube text ──────────────────────────────────────────────────────
  // Title format: "<DJ> – <Show> (Live DJ Set) | <Month YYYY>"
  // Note the en-dash (–) not a hyphen — matches Cap's house style.
  // Names are kept exactly as the DJ/admin entered them — no case
  // normalization, since lowercase is part of /radio's stylistic look
  // and Cap wants the same treatment carried over to YouTube.
  const youtubeTitle = `${djNameDisplay} – ${showNameDisplay} (Live DJ Set) | ${monthYear}`;

  // Genre is sentence-cased ("Ambient set recorded live for Channel.")
  // since it leads a sentence — DJ name and show name keep their original
  // casing (per Cap), but the genre word here is grammatical, not a name.
  const capitalizeFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const genres = (job.renderData.djGenres || []).filter((g) => typeof g === 'string' && g.length > 0);
  const primaryGenre = genres[0] || '';
  const genreSentence = primaryGenre
    ? `${capitalizeFirst(primaryGenre)} set recorded live for Channel.`
    : `Live set recorded for Channel.`;
  const ytBioParagraph =
    job.renderData.djDescription?.trim() ||
    `${showNameDisplay} is a recurring show by ${djNameDisplay}${
      genres.length > 0 ? `, focused on ${genres.join(' and ')} music` : ''
    }.\nBroadcast via Channel.`;
  // Hashtags: lowercased + spaces stripped per genre, plus baseline tags.
  const hashtagify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hashtags = [
    ...genres.map(hashtagify).filter(Boolean).map((t) => `#${t}`),
    '#djset',
    '#liveradio',
  ].join(' ');
  // Tip line if DJ has set one; learn-more line if we have a username.
  const ytExtraLinks = [
    tipButtonLink ? `→ To support ${djNameDisplay}: ${tipButtonLink}` : null,
    djUsername ? `→ Learn more about ${djNameDisplay}: https://channel-app.com/dj/${djUsername}` : null,
  ].filter(Boolean);
  const youtubeDescription = [
    youtubeTitle,
    genreSentence,
    '',
    `→ Listen to more sets & live radio: https://channel-app.com`,
    `→ Follow Channel: https://www.instagram.com/channelrad.io/`,
    '',
    '—',
    '',
    ytBioParagraph,
    ...(ytExtraLinks.length > 0 ? ['', ...ytExtraLinks] : []),
    '',
    hashtags,
  ].join('\n');

  // ─── SoundCloud text ───────────────────────────────────────────────────
  // Format per Cap: "<DJ> — <Show> | channel | <Month YYYY>"
  // Em-dash (—) between DJ and show, pipes around "channel".
  const soundcloudTitle = `${djNameDisplay} — ${showNameDisplay} | channel | ${monthYear}`;

  // Bio block per Cap: hardcoded "DJ and producer based in <location>" —
  // not the DJ's own bio. Drop the "based in ..." clause if the DJ has
  // no location set (rare; reads naturally either way).
  const scBioLine = djLocation
    ? `${djNameDisplay} is a DJ and producer based in ${djLocation}.`
    : `${djNameDisplay} is a DJ and producer.`;
  const scProfileLink = djUsername ? `https://channel-app.com/dj/${djUsername}` : null;
  const soundcloudDescription = [
    `${showNameDisplay} — recorded live for Channel.`,
    '',
    `→ More sets & live radio: https://channel-app.com`,
    `→ Follow: https://www.instagram.com/channelrad.io/`,
    '',
    '—',
    '',
    scBioLine,
    ...(scProfileLink ? ['', `→ ${scProfileLink}`] : []),
  ].join('\n');

  const copy = async (kind: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
    } catch {
      // ignore — older browsers
    }
  };

  // Per-platform consent. Prefer the live DJ profile (from /api/archives)
  // over the job's snapshot so legacy jobs that were rendered before opt-in
  // snapshots existed still honor a DJ's current opt-out — and so toggling
  // a flag on /studio retroactively hides the relevant download row.
  // Default = true (opted in) when both sources are undefined.
  const liveYtOff = liveDj?.youtubeOptIn === false;
  const liveScOff = liveDj?.soundcloudOptIn === false;
  const liveMetaOff = liveDj?.metaOptIn === false;
  const ytEnabled = liveDj
    ? !liveYtOff
    : job.youtubeOptIn !== false;
  const scEnabled = liveDj
    ? !liveScOff
    : job.soundcloudOptIn !== false;
  const metaEnabled = liveDj ? !liveMetaOff : true;
  const instagramHandle = liveDj?.instagram?.trim() || null;

  return (
    <div className="mt-3 space-y-3">
      {ytEnabled && job.outputUrl && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">YouTube</div>
          <div className="flex items-center gap-3 flex-wrap">
            <a
              href={job.outputUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="text-blue-400 hover:text-blue-300 text-xs underline"
            >
              Download mp4
            </a>
            <button
              onClick={() => copy('yt-title', youtubeTitle)}
              className="text-gray-400 hover:text-white text-xs underline"
              title={youtubeTitle}
            >
              {copied === 'yt-title' ? 'Copied!' : 'Copy title'}
            </button>
            <button
              onClick={() => copy('yt-desc', youtubeDescription)}
              className="text-gray-400 hover:text-white text-xs underline"
            >
              {copied === 'yt-desc' ? 'Copied!' : 'Copy description'}
            </button>
          </div>
        </div>
      )}

      {scEnabled && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">SoundCloud</div>
          <div className="flex items-center gap-3 flex-wrap">
            {job.soundcloudAudioUrl && (
              <a
                href={job.soundcloudAudioUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="text-blue-400 hover:text-blue-300 text-xs underline"
              >
                Download m4a
              </a>
            )}
            {job.soundcloudImageUrl && (
              <a
                href={job.soundcloudImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="text-blue-400 hover:text-blue-300 text-xs underline"
              >
                Download cover
              </a>
            )}
            <button
              onClick={() => copy('sc-title', soundcloudTitle)}
              className="text-gray-400 hover:text-white text-xs underline"
              title={soundcloudTitle}
            >
              {copied === 'sc-title' ? 'Copied!' : 'Copy title'}
            </button>
            <button
              onClick={() => copy('sc-desc', soundcloudDescription)}
              className="text-gray-400 hover:text-white text-xs underline"
            >
              {copied === 'sc-desc' ? 'Copied!' : 'Copy description'}
            </button>
          </div>
        </div>
      )}

      {/* Instagram info line. Status only — no buttons. We have no IG
          rendering pipeline yet, so this just tells the admin whether
          IG sharing is OK and what handle to tag. Three states:
            - "IG: @handle"   — opted in, handle on file
            - "IG: not set"   — opted in, no handle yet (DJ hasn't filled
              their profile out — admin can DM them)
            - "IG: opted out" — DJ has metaOptIn === false; don't share */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Instagram</div>
        <div className="text-xs text-gray-300">
          {!metaEnabled
            ? 'IG: opted out'
            : instagramHandle
              ? `IG: @${instagramHandle}`
              : 'IG: not set'}
        </div>
      </div>
    </div>
  );
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
