'use client';

import { useState, useEffect } from 'react';
import { BroadcastSlotSerialized } from '@/types/broadcast';
import { validateToken } from '@/lib/broadcast-slots';

interface TokenValidationResult {
  slot: BroadcastSlotSerialized | null;
  error: string | null;
  loading: boolean;
  scheduleStatus: 'early' | 'on-time' | 'late' | null;
  message: string | null;
}

export function useBroadcastToken(token: string | null): TokenValidationResult {
  const [slot, setSlot] = useState<BroadcastSlotSerialized | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scheduleStatus, setScheduleStatus] = useState<'early' | 'on-time' | 'late' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('No broadcast token provided');
      setLoading(false);
      return;
    }

    const validate = async () => {
      try {
        const result = await validateToken(token);

        if (!result.valid) {
          setError(result.error || 'Invalid token');
          setSlot(null);
        } else {
          setSlot(result.slot || null);
          setScheduleStatus(result.scheduleStatus || null);
          setMessage(result.message || null);
          setError(null);
        }
      } catch (err) {
        console.error('Token validation error:', err);
        setError('Failed to validate token');
        setSlot(null);
      } finally {
        setLoading(false);
      }
    };

    validate();
  }, [token]);

  return { slot, error, loading, scheduleStatus, message };
}
