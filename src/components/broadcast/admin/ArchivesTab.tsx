'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArchiveSerialized, ArchivePriority } from '@/types/broadcast';

interface ArchivesTabProps {
  onArchiveCountChange: (count: number) => void;
}

type FilterSource = 'all' | 'live' | 'recording';
type FilterPriority = 'all' | ArchivePriority;
type SortBy = 'date' | 'duration' | 'streams' | 'priority';

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-red-900/40 text-red-400 border-red-800',
  medium: 'bg-yellow-900/30 text-yellow-400 border-yellow-800',
  low: 'bg-gray-800/50 text-gray-500 border-gray-700',
};
const PRIORITY_CYCLE: ArchivePriority[] = ['low', 'medium', 'high'];

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ArchivesTab({ onArchiveCountChange }: ArchivesTabProps) {
  const [archives, setArchives] = useState<ArchiveSerialized[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<FilterSource>('all');
  const [filterPriority, setFilterPriority] = useState<FilterPriority>('all');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [passwordModal, setPasswordModal] = useState<{
    archiveId: string;
    archiveName: string;
    reason: 'live' | 'long';
  } | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<{
    archiveId: string;
    archiveName: string;
  } | null>(null);

  const fetchArchives = useCallback(async () => {
    try {
      const response = await fetch('/api/archives?includePrivate=true');
      if (!response.ok) throw new Error('Failed to fetch archives');
      const data = await response.json();
      setArchives(data.archives || []);
      onArchiveCountChange((data.archives || []).length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load archives');
    } finally {
      setIsLoading(false);
    }
  }, [onArchiveCountChange]);

  useEffect(() => {
    fetchArchives();
  }, [fetchArchives]);

  const handleDelete = async (archiveId: string, passwordValue?: string) => {
    setDeletingId(archiveId);
    setPasswordError('');

    try {
      const response = await fetch('/api/admin/archives/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archiveId,
          password: passwordValue,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.requiresPassword) {
          // Need password - show modal
          const archive = archives.find(a => a.id === archiveId);
          setPasswordModal({
            archiveId,
            archiveName: archive?.showName || 'Unknown',
            reason: data.reason,
          });
          setDeletingId(null);
          return;
        }
        if (response.status === 403 && passwordValue) {
          setPasswordError('Incorrect password');
          setDeletingId(null);
          return;
        }
        throw new Error(data.error || 'Failed to delete');
      }

      // Success
      setPasswordModal(null);
      setConfirmDelete(null);
      setPassword('');
      await fetchArchives();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete archive');
    } finally {
      setDeletingId(null);
    }
  };

  const initiateDelete = (archive: ArchiveSerialized) => {
    const isLive = archive.sourceType === 'live';
    const isLong = (archive.duration || 0) > 20 * 60;

    if (isLive || isLong) {
      setPasswordModal({
        archiveId: archive.id,
        archiveName: archive.showName,
        reason: isLive ? 'live' : 'long',
      });
    } else {
      setConfirmDelete({
        archiveId: archive.id,
        archiveName: archive.showName,
      });
    }
  };

  const handlePriorityChange = async (archiveId: string, newPriority: ArchivePriority) => {
    // Optimistic update
    setArchives(prev => prev.map(a =>
      a.id === archiveId ? { ...a, priority: newPriority } : a
    ));

    try {
      const response = await fetch('/api/admin/archives/priority', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archiveId, priority: newPriority }),
      });
      if (!response.ok) {
        throw new Error('Failed to update priority');
      }
    } catch {
      // Revert on failure
      await fetchArchives();
    }
  };

  // Filter
  const filtered = archives.filter((a) => {
    if (filterSource !== 'all' && a.sourceType !== filterSource) return false;
    if (filterPriority !== 'all' && (a.priority || 'medium') !== filterPriority) return false;
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'duration':
        return (b.duration || 0) - (a.duration || 0);
      case 'streams':
        return (b.streamCount || 0) - (a.streamCount || 0);
      case 'priority':
        return (PRIORITY_ORDER[a.priority || 'medium'] ?? 1) - (PRIORITY_ORDER[b.priority || 'medium'] ?? 1);
      case 'date':
      default:
        return (b.recordedAt || 0) - (a.recordedAt || 0);
    }
  });

  // Stats
  const totalDuration = archives.reduce((sum, a) => sum + (a.duration || 0), 0);
  const liveCount = archives.filter(a => a.sourceType === 'live').length;
  const recordingCount = archives.filter(a => a.sourceType === 'recording').length;

  const sourceGroups: { source: FilterSource; label: string; count: number }[] = [
    { source: 'all', label: 'All', count: archives.length },
    { source: 'live', label: 'Live Broadcasts', count: liveCount },
    { source: 'recording', label: 'Recordings', count: recordingCount },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => {
            setError(null);
            setIsLoading(true);
            fetchArchives();
          }}
          className="mt-4 px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Stats bar */}
      <div className="flex gap-4 mb-6 text-sm text-gray-400">
        <span>{archives.length} archives</span>
        <span>Total: {formatDuration(totalDuration)}</span>
      </div>

      {/* Filters and Sort */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {sourceGroups.map((group) => (
            <button
              key={group.source}
              onClick={() => setFilterSource(group.source)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
                filterSource === group.source
                  ? 'bg-gray-700 text-white'
                  : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800'
              }`}
            >
              {group.label}
              {group.count > 0 && (
                <span className={`px-1.5 py-0.5 text-xs rounded ${
                  filterSource === group.source ? 'bg-gray-600' : 'bg-gray-700'
                }`}>
                  {group.count}
                </span>
              )}
            </button>
          ))}

          <span className="text-gray-700 mx-1">|</span>

          {(['all', 'high', 'medium', 'low'] as FilterPriority[]).map((p) => (
            <button
              key={p}
              onClick={() => setFilterPriority(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                filterPriority === p
                  ? 'bg-gray-700 text-white'
                  : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800'
              }`}
            >
              {p === 'all' ? 'Any Priority' : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="bg-gray-800 text-gray-300 text-sm rounded-lg px-3 py-1.5 border border-gray-700"
        >
          <option value="date">Sort by Date</option>
          <option value="duration">Sort by Duration</option>
          <option value="streams">Sort by Streams</option>
          <option value="priority">Sort by Priority</option>
        </select>
      </div>

      {/* Archives list */}
      {sorted.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p>No archives found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((archive) => (
            <ArchiveCard
              key={archive.id}
              archive={archive}
              onDelete={() => initiateDelete(archive)}
              onPriorityChange={handlePriorityChange}
              isDeleting={deletingId === archive.id}
            />
          ))}
        </div>
      )}

      {/* Simple confirm modal (no password needed) */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] rounded-xl p-6 max-w-md w-full border border-gray-800">
            <h3 className="text-lg font-bold text-white mb-2">Delete Archive</h3>
            <p className="text-gray-400 mb-1">
              Are you sure you want to delete this archive?
            </p>
            <p className="text-white font-medium mb-4">&ldquo;{confirmDelete.archiveName}&rdquo;</p>
            <p className="text-gray-500 text-sm mb-6">
              This will delete the recording file from storage and remove all database records. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete.archiveId)}
                disabled={deletingId === confirmDelete.archiveId}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deletingId === confirmDelete.archiveId ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password modal (for live broadcasts or long archives) */}
      {passwordModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] rounded-xl p-6 max-w-md w-full border border-gray-800">
            <h3 className="text-lg font-bold text-white mb-2">Password Required</h3>
            <p className="text-gray-400 mb-4">
              {passwordModal.reason === 'live'
                ? 'This archive was recorded from a live broadcast. Enter the admin password to delete it.'
                : 'This archive is longer than 20 minutes. Enter the admin password to delete it.'}
            </p>
            <p className="text-white font-medium mb-4">&ldquo;{passwordModal.archiveName}&rdquo;</p>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password) {
                  handleDelete(passwordModal.archiveId, password);
                }
              }}
              placeholder="Admin password"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white mb-2 focus:outline-none focus:border-gray-500"
              autoFocus
            />
            {passwordError && (
              <p className="text-red-400 text-sm mb-2">{passwordError}</p>
            )}
            <div className="flex gap-3 justify-end mt-4">
              <button
                onClick={() => {
                  setPasswordModal(null);
                  setPassword('');
                  setPasswordError('');
                }}
                className="px-4 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(passwordModal.archiveId, password)}
                disabled={!password || deletingId === passwordModal.archiveId}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deletingId === passwordModal.archiveId ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Archive Card Component
function ArchiveCard({
  archive,
  onDelete,
  onPriorityChange,
  isDeleting,
}: {
  archive: ArchiveSerialized;
  onDelete: () => void;
  onPriorityChange: (archiveId: string, priority: ArchivePriority) => void;
  isDeleting: boolean;
}) {
  const djNames = archive.djs?.map(dj => dj.name).join(', ') || 'Unknown DJ';
  const isLive = archive.sourceType === 'live';
  const isPublic = archive.isPublic !== false;
  const currentPriority = archive.priority || 'medium';

  const cyclePriority = () => {
    const currentIdx = PRIORITY_CYCLE.indexOf(currentPriority);
    const nextIdx = (currentIdx + 1) % PRIORITY_CYCLE.length;
    onPriorityChange(archive.id, PRIORITY_CYCLE[nextIdx]);
  };

  return (
    <div className="p-4 bg-[#1a1a1a] border border-gray-800 rounded-xl hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="font-medium text-white truncate">{archive.showName}</h3>
            <span className={`px-2 py-0.5 text-xs rounded border ${
              isLive
                ? 'bg-cyan-900/30 text-cyan-400 border-cyan-800'
                : 'bg-purple-900/30 text-purple-400 border-purple-800'
            }`}>
              {isLive ? 'Live' : 'Recording'}
            </span>
            {!isPublic && (
              <span className="px-2 py-0.5 text-xs rounded border bg-gray-900/30 text-gray-400 border-gray-700">
                Private
              </span>
            )}
            <button
              onClick={cyclePriority}
              title={`Priority: ${currentPriority} (click to change)`}
              className={`px-2 py-0.5 text-xs rounded border cursor-pointer transition-colors hover:opacity-80 ${PRIORITY_COLORS[currentPriority]}`}
            >
              {currentPriority.charAt(0).toUpperCase() + currentPriority.slice(1)}
            </button>
          </div>
          <p className="text-sm text-gray-400 truncate mb-2">{djNames}</p>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>{formatDuration(archive.duration || 0)}</span>
            {archive.recordedAt && (
              <span>{formatDate(archive.recordedAt)} at {formatTime(archive.recordedAt)}</span>
            )}
            {(archive.streamCount || 0) > 0 && (
              <span>{archive.streamCount} stream{archive.streamCount !== 1 ? 's' : ''}</span>
            )}
            {archive.slug && (
              <span className="text-gray-600">/archives/{archive.slug}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {archive.recordingUrl && (
            <a
              href={archive.recordingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
              title="Open recording URL"
            >
              MP4
            </a>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            disabled={isDeleting}
            className="px-3 py-1.5 rounded-lg text-xs bg-red-900/30 text-red-400 border border-red-800 hover:bg-red-900/50 transition-colors disabled:opacity-50"
          >
            {isDeleting ? '...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
