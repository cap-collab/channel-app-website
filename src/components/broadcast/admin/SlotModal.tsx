'use client';

import { useState, useEffect } from 'react';
import { BroadcastSlotSerialized, BroadcastType } from '@/types/broadcast';

interface SlotModalProps {
  slot?: BroadcastSlotSerialized | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { djName: string; showName?: string; startTime: number; endTime: number; broadcastType: BroadcastType }) => Promise<void>;
  onDelete?: (slotId: string) => Promise<void>;
  // For creating new slots
  initialStartTime?: Date;
  initialEndTime?: Date;
}

export function SlotModal({
  slot,
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialStartTime,
  initialEndTime,
}: SlotModalProps) {
  const [djName, setDjName] = useState('');
  const [showName, setShowName] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [broadcastType, setBroadcastType] = useState<BroadcastType>('venue');
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const isEditing = !!slot;

  // Initialize form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (slot) {
        // Editing existing slot
        const start = new Date(slot.startTime);
        const end = new Date(slot.endTime);
        setDjName(slot.djName);
        setShowName(slot.showName || '');
        setDate(start.toISOString().split('T')[0]);
        setStartTime(start.toTimeString().slice(0, 5));
        setEndTime(end.toTimeString().slice(0, 5));
        setBroadcastType(slot.broadcastType || 'venue');
      } else if (initialStartTime && initialEndTime) {
        // Creating new slot from calendar drag
        setDjName('');
        setShowName('');
        setDate(initialStartTime.toISOString().split('T')[0]);
        setStartTime(initialStartTime.toTimeString().slice(0, 5));
        setEndTime(initialEndTime.toTimeString().slice(0, 5));
        setBroadcastType('venue'); // Default to venue for new slots
      }
    }
  }, [isOpen, slot, initialStartTime, initialEndTime]);

  const handleSave = async () => {
    if (!djName || !date || !startTime || !endTime) return;

    setIsSaving(true);
    try {
      const startDateTime = new Date(`${date}T${startTime}`).getTime();
      let endDateTime = new Date(`${date}T${endTime}`).getTime();

      // Handle overnight slots
      if (endDateTime <= startDateTime) {
        endDateTime += 24 * 60 * 60 * 1000;
      }

      await onSave({
        djName,
        showName: showName || undefined,
        startTime: startDateTime,
        endTime: endDateTime,
        broadcastType,
      });
      onClose();
    } catch (error) {
      console.error('Failed to save slot:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!slot || !onDelete) return;
    if (!confirm('Delete this broadcast slot?')) return;

    setIsSaving(true);
    try {
      await onDelete(slot.id);
      onClose();
    } catch (error) {
      console.error('Failed to delete slot:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const copyBroadcastLink = async () => {
    if (!slot) return;
    const url = slot.broadcastType === 'venue'
      ? `${window.location.origin}/broadcast/bettertomorrow`
      : `${window.location.origin}/broadcast/live?token=${slot.broadcastToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  if (!isOpen) return null;

  const broadcastUrl = slot
    ? slot.broadcastType === 'venue'
      ? `${typeof window !== 'undefined' ? window.location.origin : ''}/broadcast/bettertomorrow`
      : `${typeof window !== 'undefined' ? window.location.origin : ''}/broadcast/live?token=${slot.broadcastToken}`
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-gray-900 rounded-xl w-full max-w-md mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Edit Broadcast Slot' : 'New Broadcast Slot'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Broadcast link (for existing slots) */}
          {isEditing && (
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">Broadcast Link</span>
                <button
                  onClick={copyBroadcastLink}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    copied
                      ? 'bg-green-600 text-white'
                      : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}
                >
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
              <div className="text-xs text-gray-500 font-mono truncate">
                {broadcastUrl}
              </div>
            </div>
          )}

          {/* DJ Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">DJ Name *</label>
            <input
              type="text"
              value={djName}
              onChange={(e) => setDjName(e.target.value)}
              placeholder="e.g., DJ Shadow"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Show Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Show Name (optional)</label>
            <input
              type="text"
              value={showName}
              onChange={(e) => setShowName(e.target.value)}
              placeholder="e.g., Late Night Sessions"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Broadcast Type */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Broadcast Location</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setBroadcastType('venue')}
                className={`flex-1 p-3 rounded-lg border transition-colors ${
                  broadcastType === 'venue'
                    ? 'bg-blue-600/20 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2 justify-center">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="font-medium">bettertomorrow</span>
                </div>
                <p className="text-xs mt-1 opacity-70">At the venue CDJs</p>
              </button>
              <button
                type="button"
                onClick={() => setBroadcastType('remote')}
                className={`flex-1 p-3 rounded-lg border transition-colors ${
                  broadcastType === 'remote'
                    ? 'bg-purple-600/20 border-purple-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2 justify-center">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium">Remote</span>
                </div>
                <p className="text-xs mt-1 opacity-70">Unique link for DJ</p>
              </button>
            </div>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Date *</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Start *</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">End *</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Status badge (for existing slots) */}
          {isEditing && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Status:</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                slot?.status === 'live' ? 'bg-red-600 text-white' :
                slot?.status === 'scheduled' ? 'bg-blue-600 text-white' :
                slot?.status === 'completed' ? 'bg-green-600 text-white' :
                'bg-gray-600 text-gray-300'
              }`}>
                {slot?.status}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-800">
          {isEditing && onDelete ? (
            <button
              onClick={handleDelete}
              disabled={isSaving}
              className="px-4 py-2 text-red-400 hover:bg-red-900/30 rounded-lg transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          ) : (
            <div />
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:bg-gray-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !djName || !date || !startTime || !endTime}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
            >
              {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Slot'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
