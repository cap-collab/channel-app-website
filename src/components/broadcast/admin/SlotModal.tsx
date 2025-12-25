'use client';

import { useState, useEffect } from 'react';
import { BroadcastSlotSerialized, BroadcastType, DJSlot } from '@/types/broadcast';

interface SlotModalProps {
  slot?: BroadcastSlotSerialized | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    showName: string;
    djName?: string;
    djSlots?: DJSlot[];
    startTime: number;
    endTime: number;
    broadcastType: BroadcastType;
  }) => Promise<void>;
  onDelete?: (slotId: string) => Promise<void>;
  initialStartTime?: Date;
  initialEndTime?: Date;
  venueName: string;
  venueSlug: string;
}

interface LocalDJSlot {
  id: string;
  djName: string;
  startTime: string; // HH:mm format
  endTime: string;   // HH:mm format
}

// Generate time options in 30-minute increments with simple labels
function generateTimeOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const value = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const ampm = hour < 12 ? 'am' : 'pm';
      // Simpler format: "8pm" or "8:30pm"
      const label = minute === 0 ? `${hour12}${ampm}` : `${hour12}:${minute}${ampm}`;
      options.push({ value, label });
    }
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

// Snap time string to nearest 30-minute increment
function snapToHalfHour(timeStr: string): string {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const snappedMinutes = Math.round(minutes / 30) * 30;
  if (snappedMinutes === 60) {
    return `${((hours + 1) % 24).toString().padStart(2, '0')}:00`;
  }
  return `${hours.toString().padStart(2, '0')}:${snappedMinutes.toString().padStart(2, '0')}`;
}

// Convert time string to minutes since midnight
function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// Convert minutes since midnight to time string
function minutesToTime(minutes: number): string {
  // Handle overnight (minutes can be > 1440 for next day)
  const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalizedMinutes / 60);
  const mins = normalizedMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// Adjust DJ slots to fit within show boundaries
function adjustDjSlotsToShowBounds(
  djSlots: LocalDJSlot[],
  showStartTime: string,
  showEndTime: string,
  isOvernight: boolean
): LocalDJSlot[] {
  if (djSlots.length === 0) return djSlots;

  const showStartMins = timeToMinutes(showStartTime);
  let showEndMins = timeToMinutes(showEndTime);

  // For overnight shows, end time is on next day
  if (isOvernight || showEndMins <= showStartMins) {
    showEndMins += 1440; // Add 24 hours
  }

  return djSlots.map(dj => {
    let djStartMins = timeToMinutes(dj.startTime);
    let djEndMins = timeToMinutes(dj.endTime);

    // Handle overnight DJ slots
    if (djStartMins < showStartMins && !isOvernight) {
      djStartMins += 1440;
    }
    if (djEndMins <= djStartMins) {
      djEndMins += 1440;
    }

    // Clamp DJ start time to show bounds
    if (djStartMins < showStartMins) {
      djStartMins = showStartMins;
    }
    if (djStartMins > showEndMins) {
      djStartMins = showEndMins;
    }

    // Clamp DJ end time to show bounds
    if (djEndMins < showStartMins) {
      djEndMins = showStartMins;
    }
    if (djEndMins > showEndMins) {
      djEndMins = showEndMins;
    }

    // If DJ slot is completely squeezed (start >= end after clamping),
    // set both to show start time as a placeholder
    if (djStartMins >= djEndMins) {
      djStartMins = showStartMins;
      djEndMins = showStartMins;
    }

    return {
      ...dj,
      startTime: minutesToTime(djStartMins),
      endTime: minutesToTime(djEndMins),
    };
  });
}

export function SlotModal({
  slot,
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialStartTime,
  initialEndTime,
  venueName,
  venueSlug,
}: SlotModalProps) {
  const [showName, setShowName] = useState('');
  const [djName, setDjName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [broadcastType, setBroadcastType] = useState<BroadcastType>('venue');
  const [djSlots, setDjSlots] = useState<LocalDJSlot[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const isEditing = !!slot;

  // Check if this is an overnight show
  const isOvernight = startDate && endDate && endDate > startDate;

  // Helper to format date as YYYY-MM-DD in local timezone
  const formatLocalDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Initialize form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (slot) {
        // Editing existing slot
        const start = new Date(slot.startTime);
        const end = new Date(slot.endTime);
        setShowName(slot.showName || '');
        setDjName(slot.djName || '');
        // Use local date formatting to avoid timezone issues
        setStartDate(formatLocalDate(start));
        setEndDate(formatLocalDate(end));
        setStartTime(snapToHalfHour(start.toTimeString().slice(0, 5)));
        setEndTime(snapToHalfHour(end.toTimeString().slice(0, 5)));
        setBroadcastType(slot.broadcastType || 'venue');

        // Convert DJ slots to local format
        if (slot.djSlots && slot.djSlots.length > 0) {
          setDjSlots(slot.djSlots.map(dj => ({
            id: dj.id,
            djName: dj.djName || '',
            startTime: snapToHalfHour(new Date(dj.startTime).toTimeString().slice(0, 5)),
            endTime: snapToHalfHour(new Date(dj.endTime).toTimeString().slice(0, 5)),
          })));
        } else {
          setDjSlots([]);
        }
      } else if (initialStartTime && initialEndTime) {
        // Creating new slot from calendar drag
        setShowName('');
        setDjName('');
        // Use local date formatting to avoid timezone issues
        setStartDate(formatLocalDate(initialStartTime));
        setEndDate(formatLocalDate(initialEndTime));
        setStartTime(snapToHalfHour(initialStartTime.toTimeString().slice(0, 5)));
        setEndTime(snapToHalfHour(initialEndTime.toTimeString().slice(0, 5)));
        setBroadcastType('venue');
        setDjSlots([]);
      }
    }
  }, [isOpen, slot, initialStartTime, initialEndTime]);

  // Auto-set end date when start date changes (if not overnight)
  useEffect(() => {
    if (startDate && !endDate) {
      setEndDate(startDate);
    }
  }, [startDate, endDate]);

  // Auto-detect overnight when end time is before start time on same date
  useEffect(() => {
    if (startDate && startTime && endTime && startDate === endDate) {
      const startMinutes = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
      const endMinutes = parseInt(endTime.split(':')[0]) * 60 + parseInt(endTime.split(':')[1]);
      if (endMinutes <= startMinutes) {
        // End time is before start time, assume overnight
        const nextDay = new Date(startDate);
        nextDay.setDate(nextDay.getDate() + 1);
        setEndDate(nextDay.toISOString().split('T')[0]);
      }
    }
  }, [startDate, endDate, startTime, endTime]);

  // Adjust DJ slots when show times change to keep them within bounds
  useEffect(() => {
    if (djSlots.length > 0 && startTime && endTime && startDate && endDate) {
      const isOvernightShow = endDate > startDate;
      const adjustedSlots = adjustDjSlotsToShowBounds(djSlots, startTime, endTime, isOvernightShow);

      // Only update if there are actual changes to avoid infinite loops
      const hasChanges = adjustedSlots.some((adjusted, i) =>
        adjusted.startTime !== djSlots[i].startTime ||
        adjusted.endTime !== djSlots[i].endTime
      );

      if (hasChanges) {
        setDjSlots(adjustedSlots);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, endTime, startDate, endDate]);

  const handleSave = async () => {
    if (!showName || !startDate || !endDate || !startTime || !endTime) return;

    setIsSaving(true);
    try {
      const startDateTime = new Date(`${startDate}T${startTime}`).getTime();
      const endDateTime = new Date(`${endDate}T${endTime}`).getTime();

      // Convert local DJ slots to timestamps
      const convertedDjSlots: DJSlot[] | undefined = broadcastType === 'venue' && djSlots.length > 0
        ? djSlots.map(dj => {
            // Determine which date to use for this DJ slot
            const djStartMinutes = parseInt(dj.startTime.split(':')[0]) * 60 + parseInt(dj.startTime.split(':')[1]);
            const showStartMinutes = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);

            // If DJ start time is before show start time, it's on the next day
            const djStartDate = djStartMinutes < showStartMinutes ? endDate : startDate;
            const djEndMinutes = parseInt(dj.endTime.split(':')[0]) * 60 + parseInt(dj.endTime.split(':')[1]);
            const djEndDate = djEndMinutes <= djStartMinutes || djEndMinutes < showStartMinutes ? endDate : djStartDate;

            return {
              id: dj.id,
              djName: dj.djName || undefined,
              startTime: new Date(`${djStartDate}T${dj.startTime}`).getTime(),
              endTime: new Date(`${djEndDate}T${dj.endTime}`).getTime(),
            };
          })
        : undefined;

      await onSave({
        showName,
        djName: broadcastType === 'remote' ? (djName || undefined) : undefined,
        djSlots: convertedDjSlots,
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
    if (!confirm('Delete this show?')) return;

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
      ? `${window.location.origin}/broadcast/${venueSlug}`
      : `${window.location.origin}/broadcast/live?token=${slot.broadcastToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const addDjSlot = () => {
    const newId = `dj-${Date.now()}`;
    // Default to show start/end times for new DJ slot
    setDjSlots([...djSlots, {
      id: newId,
      djName: '',
      startTime: djSlots.length > 0 ? djSlots[djSlots.length - 1].endTime : startTime,
      endTime: endTime,
    }]);
  };

  const updateDjSlot = (id: string, field: keyof LocalDJSlot, value: string) => {
    setDjSlots(djSlots.map(dj => {
      if (dj.id !== id) return dj;

      const updatedDj = { ...dj, [field]: value };

      // If updating time fields, clamp to show bounds
      if (field === 'startTime' || field === 'endTime') {
        const isOvernightShow = endDate > startDate;
        const [adjusted] = adjustDjSlotsToShowBounds([updatedDj], startTime, endTime, isOvernightShow);
        return adjusted;
      }

      return updatedDj;
    }));
  };

  const removeDjSlot = (id: string) => {
    setDjSlots(djSlots.filter(dj => dj.id !== id));
  };

  if (!isOpen) return null;

  const broadcastUrl = slot
    ? slot.broadcastType === 'venue'
      ? `${typeof window !== 'undefined' ? window.location.origin : ''}/broadcast/${venueSlug}`
      : `${typeof window !== 'undefined' ? window.location.origin : ''}/broadcast/live?token=${slot.broadcastToken}`
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-gray-900 rounded-xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Edit Show' : 'New Show'}
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
                      : 'bg-accent hover:bg-accent-hover text-white'
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

          {/* Show Name (REQUIRED) */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Show Name *</label>
            <input
              type="text"
              value={showName}
              onChange={(e) => setShowName(e.target.value)}
              placeholder="e.g., Sunday Sessions"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
            />
          </div>

          {/* Date & Time */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Start Date *</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">End Date *</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Start Time *</label>
                <select
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                >
                  {TIME_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">End Time *</label>
                <select
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
                >
                  {TIME_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Overnight indicator */}
            {isOvernight && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-sm">
                <div className="flex items-center gap-2 text-gray-300">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                  <span>Overnight show</span>
                </div>
                <p className="text-gray-400 text-xs mt-1">
                  Ends {new Date(endDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {endTime}
                </p>
              </div>
            )}
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
                    ? 'bg-accent/20 border-accent text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2 justify-center">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="font-medium">{venueName}</span>
                </div>
                <p className="text-xs mt-1 opacity-70">At the venue CDJs</p>
              </button>
              <button
                type="button"
                onClick={() => setBroadcastType('remote')}
                className={`flex-1 p-3 rounded-lg border transition-colors ${
                  broadcastType === 'remote'
                    ? 'bg-blue-600/20 border-blue-500 text-white'
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

          {/* DJ Lineup (venue only) */}
          {broadcastType === 'venue' && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">DJ Lineup</label>
              <div className="space-y-2">
                {djSlots.map((dj, index) => (
                  <div key={dj.id} className="bg-gray-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-500 w-6">#{index + 1}</span>
                      <input
                        type="text"
                        value={dj.djName}
                        onChange={(e) => updateDjSlot(dj.id, 'djName', e.target.value)}
                        placeholder="DJ Name (optional)"
                        className="flex-1 bg-gray-700 text-white border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-gray-500"
                      />
                      <button
                        type="button"
                        onClick={() => removeDjSlot(dj.id)}
                        className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="flex items-center gap-2 ml-6">
                      <select
                        value={dj.startTime}
                        onChange={(e) => updateDjSlot(dj.id, 'startTime', e.target.value)}
                        className="bg-gray-700 text-white border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-gray-500"
                      >
                        {TIME_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <span className="text-gray-500">-</span>
                      <select
                        value={dj.endTime}
                        onChange={(e) => updateDjSlot(dj.id, 'endTime', e.target.value)}
                        className="bg-gray-700 text-white border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-gray-500"
                      >
                        {TIME_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addDjSlot}
                  className="w-full py-2 border border-dashed border-gray-700 rounded-lg text-gray-400 hover:border-gray-600 hover:text-gray-300 transition-colors text-sm"
                >
                  + Add DJ Slot
                </button>
              </div>
            </div>
          )}

          {/* DJ Name (remote only) */}
          {broadcastType === 'remote' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">DJ Name</label>
              <input
                type="text"
                value={djName}
                onChange={(e) => setDjName(e.target.value)}
                placeholder="e.g., DJ Shadow (optional)"
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:border-gray-500"
              />
            </div>
          )}

          {/* Status badge (for existing slots) */}
          {isEditing && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Status:</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                slot?.status === 'live' ? 'bg-red-600 text-white' :
                slot?.status === 'scheduled' ? 'bg-accent text-white' :
                slot?.status === 'paused' ? 'bg-orange-600 text-white' :
                slot?.status === 'completed' ? 'bg-gray-600 text-white' :
                'bg-gray-600 text-gray-300'
              }`}>
                {slot?.status}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-800 sticky bottom-0 bg-gray-900">
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
              disabled={isSaving || !showName || !startDate || !endDate || !startTime || !endTime}
              className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
            >
              {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Show'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
