'use client';

import { useState, useEffect } from 'react';
import { BroadcastSlotSerialized } from '@/types/broadcast';

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

    const validateToken = async () => {
      try {
        const res = await fetch(`/api/broadcast/validate-token?token=${encodeURIComponent(token)}`);
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || 'Invalid token');
          setSlot(null);
        } else {
          setSlot(data.slot);
          setScheduleStatus(data.scheduleStatus);
          setMessage(data.message);
          setError(null);
        }
      } catch {
        setError('Failed to validate token');
        setSlot(null);
      } finally {
        setLoading(false);
      }
    };

    validateToken();
  }, [token]);

  return { slot, error, loading, scheduleStatus, message };
}
