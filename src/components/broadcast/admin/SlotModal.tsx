'use client';

import { useState, useEffect } from 'react';
import { BroadcastSlotSerialized } from '@/types/broadcast';

interface SlotModalProps {
  slot?: BroadcastSlotSerialized | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { djName: string; showName?: string; startTime: number; endTime: number }) => Promise<void>;
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
      } else if (initialStartTime && initialEndTime) {
        // Creating new slot from calendar drag
        setDjName('');
        setShowName('');
        setDate(initialStartTime.toISOString().split('T')[0]);
        setStartTime(initialStartTime.toTimeString().slice(0, 5));
        setEndTime(initialEndTime.toTimeString().slice(0, 5));
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
    const url = `${window.location.origin}/broadcast/live?token=${slot.broadcastToken}`;
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
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/broadcast/live?token=${slot.broadcastToken}`
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
