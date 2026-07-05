import { EventDJRef, EventVenueRef, CollectiveRef } from '@/types/events';

export type FieldNoteStatus = 'pending' | 'published' | 'rejected';

// A field note: a short (<=90s) voice impression a listener records after a
// live music experience, linked to an event/DJ(s)/venue(s)/collective(s)/city.
// Stored in the `field-notes` Firestore collection. Audio lives in R2 under the
// isolated `field-notes/{uid}/{ts}.{ext}` prefix — never touches the live /
// restream / archive-radio pipelines.
export interface FieldNoteDoc {
  // Author (denormalized from users/{uid} at submit)
  recordedByUserId: string;
  recordedByUsername: string;
  recordedByPhotoUrl?: string | null;

  // Audio (R2)
  audioUrl: string;        // `${R2_PUBLIC_URL}/${audioKey}`
  audioKey: string;        // field-notes/{uid}/{ts}.{ext}
  audioMimeType: string;   // audio/mp4 | audio/webm | video/mp4 ...
  durationSec: number;     // integer, <= 90

  // Event link — set ONE linked* id when linking an existing item, otherwise
  // use manual eventName/eventDate (denormalized; no write to `events`).
  linkedSlotId?: string | null;
  linkedArchiveId?: string | null;
  linkedEventId?: string | null;
  eventName?: string | null;
  eventDate?: number | null;   // unix ms

  // Tagging — multi-select, set by listener at submit AND editable by admin.
  djs: EventDJRef[];
  venues: EventVenueRef[];
  collectives: CollectiveRef[];
  // Flat, indexable id arrays derived from the tag arrays on every write. Used
  // to group "all notes attributed to entity X" for the attributed-playback
  // section. Kept in sync whenever djs/venues/collectives change.
  taggedDjKeys: string[];         // djUserId ?? normalizeUsername(djName) per DJ
  taggedVenueIds: string[];
  taggedCollectiveIds: string[];

  city: string;            // resolved at capture, not user-editable
  caption?: string | null;

  transcript?: string | null;   // RESERVED — never populated in MVP

  // Voting — denormalized counts; per-user vote lives in the `votes` subcollection.
  upvotes?: number;
  downvotes?: number;

  // If this note is a voice reply, the id of the note it replies to. The reply
  // is otherwise a normal note that inherits the parent's attributions.
  parentNoteId?: string | null;

  // Whether the submitter granted Channel usage rights (the submit checkbox).
  usagePermission?: boolean;

  // Workflow
  status: FieldNoteStatus;                 // starts 'pending'
  uploadStatus: 'uploading' | 'ready';
  createdAt: number;                       // unix ms
  publishedAt?: number | null;
  reviewedBy?: string | null;              // admin uid
  rejectionReason?: string | null;         // admin-entered; shown to the author
  adminNotes?: string | null;              // internal, not shown to author
}

export interface FieldNoteSerialized extends FieldNoteDoc {
  id: string;
  myVote?: 1 | -1 | 0;   // the viewing user's vote (0/undefined = none)
}

// Shape the submit endpoint accepts from the client to build a pending note.
export interface FieldNoteSubmitInput {
  fileType: string;
  durationSec: number;
  linkedSlotId?: string | null;
  linkedArchiveId?: string | null;
  linkedEventId?: string | null;
  eventName?: string | null;
  eventDate?: number | null;
  djs?: EventDJRef[];
  venues?: EventVenueRef[];
  collectives?: CollectiveRef[];
  city?: string | null;
  caption?: string | null;
  parentNoteId?: string | null;   // set for voice replies
  usagePermission?: boolean;      // user granted Channel usage rights
}

// A candidate event/show for the "link to a recent event" picker.
export interface RecentEventCandidate {
  type: 'slot' | 'archive' | 'event';
  id: string;
  name: string;
  date: number;            // unix ms
  djs: EventDJRef[];
}
