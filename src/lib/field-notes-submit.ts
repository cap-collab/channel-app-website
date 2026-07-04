import type { User } from 'firebase/auth';
import type { CapturedTake } from '@/components/field-notes/FieldNoteCapture';
import type { EventDJRef, EventVenueRef, CollectiveRef } from '@/types/events';

export interface SubmitExtras {
  djs?: EventDJRef[];
  venues?: EventVenueRef[];
  collectives?: CollectiveRef[];
  linkedSlotId?: string | null;
  linkedArchiveId?: string | null;
  linkedEventId?: string | null;
  eventName?: string | null;
  eventDate?: number | null;
  city?: string | null;
  parentNoteId?: string | null;
}

// The single 3-step submit used by BOTH the recorder and voice replies, so the
// two paths can't diverge: init (presigned URL + doc) → PUT blob to R2 →
// complete (flip uploadStatus to 'ready'). Auth optional (anonymous allowed).
export async function submitFieldNote(take: CapturedTake, extras: SubmitExtras, user: User | null): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;

  // 1. init
  const initRes = await fetch('/api/field-notes', {
    method: 'POST',
    headers,
    body: JSON.stringify({ fileType: take.mimeType, durationSec: take.durationSec, ...extras }),
  });
  const initData = await initRes.json();
  if (!initRes.ok) throw new Error(initData.error || 'Failed to submit');

  // 2. PUT blob to R2 — Content-Type MUST match the (codecs-stripped) type the
  //    server signed with. take.mimeType is already stripped by the capturer.
  const putRes = await fetch(initData.presignedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': take.mimeType },
    body: take.blob,
  });
  if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

  // 3. complete
  const completeRes = await fetch('/api/field-notes/complete', {
    method: 'POST',
    headers,
    body: JSON.stringify({ fieldNoteId: initData.fieldNoteId }),
  });
  const completeData = await completeRes.json().catch(() => ({}));
  if (!completeRes.ok) throw new Error(completeData.error || `Finalize failed (${completeRes.status})`);
}
