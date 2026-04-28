// Audio input methods for DJ broadcasting
export type AudioInputMethod = 'system' | 'device' | 'rtmp';

// Broadcast slot status
// - scheduled: slot created, waiting for DJ to go live
// - live: DJ is currently broadcasting
// - paused: DJ disconnected (browser closed, network failure) - can resume with same token
// - completed: slot ended (DJ clicked end, or slot time passed)
// - missed: slot time passed without ever going live
export type BroadcastSlotStatus = 'scheduled' | 'live' | 'paused' | 'completed' | 'missed';

// Broadcast type - venue uses permanent URL, remote gets unique token, recording is self-service, restream plays archived content
export type BroadcastType = 'venue' | 'remote' | 'recording' | 'restream';

// Individual DJ profile for B3B scenarios (multiple DJs sharing one slot)
export interface DJProfileInfo {
  email?: string;           // For lookup and tips fallback
  userId?: string;          // Firebase UID (if account exists)
  username?: string;        // Chat username
  usernameNormalized?: string; // Normalized username for URL (lowercase, no spaces)
  bio?: string;             // Bio text
  photoUrl?: string;        // Profile picture URL
  tipButtonLink?: string;   // External tip/support URL
  thankYouMessage?: string; // Thank you message for tips
  hasProfile?: boolean;     // Whether the DJ has a public profile page (user exists with dj/broadcaster/admin role)
  socialLinks?: {
    soundcloud?: string;
    instagram?: string;
    youtube?: string;
    bandcamp?: string;
  };
}

// Tagged DJ for recordings (simpler than full profile - just name and optional email)
export interface TaggedDJ {
  djName: string;           // Display name (required)
  email?: string;           // Optional email for profile lookup/linking
  userId?: string;          // Firebase UID (if account exists, looked up from email)
  username?: string;        // Chat username (if found from email lookup)
}

// DJ slot within a venue show
export interface DJSlot {
  id: string;
  djName?: string;           // Display name (required at creation, can be TBD initially)
  startTime: number;         // Unix timestamp ms
  endTime: number;           // Unix timestamp ms

  // Pre-populated at setup time via email lookup
  djEmail?: string;              // DJ's email (for tips fallback & profile lookup)
  djUserId?: string;             // Firebase UID (if account exists)
  djUsername?: string;           // Chat username (from chatUsername)
  djBio?: string;                // Bio text
  djPhotoUrl?: string;           // Profile picture URL
  djTipButtonLink?: string;      // External tip/support URL
  djThankYouMessage?: string;    // Thank you message
  djSocialLinks?: {              // Social links
    soundcloud?: string;
    instagram?: string;
    youtube?: string;
    bandcamp?: string;
  };

  // B3B support: multiple DJs sharing the same slot
  djProfiles?: DJProfileInfo[];  // Array of DJ profiles for B3B scenarios

  // Runtime fields (set when slot becomes active)
  liveDjUserId?: string;     // Firebase UID of DJ who claimed this slot
  liveDjUsername?: string;   // Their chat username (or djName if no account)
}

// Generic timestamp interface that works with both Admin and Client SDK
export interface FirestoreTimestamp {
  toMillis(): number;
}

// Broadcast slot stored in Firestore (used for type hints in API routes)
// Note: Uses generic timestamp interface to work with both Admin and Client SDKs
export interface BroadcastSlot {
  id: string;
  stationId: string;           // For multi-station future
  showName: string;            // Show title (REQUIRED)
  djName?: string;             // Single DJ for remote broadcasts (optional)
  djUserId?: string;           // DJ's Firebase UID (set at approval if user exists, or reconciled later)
  djEmail?: string;            // DJ's email for matching (set on approval)
  djUsername?: string;         // DJ's chatUsername for profile URL (set at approval if user exists)
  djSlots?: DJSlot[];          // Multiple DJ slots for venue broadcasts (optional)
  startTime: FirestoreTimestamp;  // Scheduled start
  endTime: FirestoreTimestamp;    // Scheduled end
  broadcastToken: string;      // Unique token for the broadcast link (only used for 'remote' type)
  tokenExpiresAt: FirestoreTimestamp; // Link expiration (end time + buffer)
  createdAt: FirestoreTimestamp;
  createdBy: string;           // Owner's UID
  status: BroadcastSlotStatus;
  broadcastType: BroadcastType; // 'venue' or 'remote' - determines DJ journey
  // Live DJ info (for single-DJ broadcasts)
  liveDjUserId?: string;       // Firebase UID of the DJ who went live
  liveDjUsername?: string;     // Their chat username
  liveDjBio?: string;          // DJ bio (from their profile)
  liveDjPhotoUrl?: string;     // DJ profile picture URL
  liveDjTipButtonLink?: string;  // External tip/support URL (from their profile)
  liveDjBandcamp?: string;       // DJ bandcamp URL (from their socialLinks)
  liveDjGenres?: string[];       // DJ genres (from their profile)
  liveDjDescription?: string;    // DJ description (from their profile)
  // Current DJ slot tracking (for venue multi-DJ shows)
  currentDjSlotId?: string;      // ID of the currently active DJ slot
  // Show image (used for archives)
  showImageUrl?: string;
  // Recording (for downloadable audio files)
  egressId?: string;              // HLS egress ID
  recordingEgressId?: string;     // MP4 file egress ID (legacy, for backward compat)
  recordingUrl?: string;          // Public URL to download file (legacy)
  recordingStatus?: 'recording' | 'processing' | 'ready' | 'failed';  // Legacy
  recordingDuration?: number;     // Duration in seconds (legacy)
  // Multiple recordings support (stop/restart creates new recordings)
  recordings?: Recording[];
  // Recording-only mode fields
  isPublic?: boolean;           // For recording type - visible on profile?
  publishedAt?: number;         // When made public (Unix ms)
  roomName?: string;            // Custom room name for recordings (not shared channel-radio)
  // Tagged DJs for venue recordings (other DJs playing alongside the recorder)
  taggedDJs?: TaggedDJ[];
  // Restream fields (when broadcastType === 'restream')
  archiveId?: string;             // Firestore doc ID of the archive being restreamed
  archiveRecordingUrl?: string;   // Cached MP4 URL from the archive
  archiveDuration?: number;       // Duration in seconds
  restreamDjs?: ArchiveDJ[];      // All DJs from the archive (for multi-DJ restream display)
  restreamIngressId?: string;     // LiveKit ingress ID for URL playback (legacy)
  restreamWorkerId?: string;      // Restream worker slot ID (set by start-restream)
  restreamEgressId?: string;      // LiveKit HLS egress ID (set by webhook on track_published)
  streamCount?: number;            // Number of streams (counted after 5+ min playback)
  sceneIdsOverride?: string[] | null; // null/undefined = inherit from DJs; [] = no scene; [ids] = pinned
}

// Serialized version for API responses (timestamps as numbers)
export interface BroadcastSlotSerialized {
  id: string;
  stationId: string;
  showName: string;            // Show title (REQUIRED)
  djName?: string;             // Single DJ for remote broadcasts (optional)
  djUserId?: string;           // DJ's Firebase UID (set at approval if user exists, or reconciled later)
  djEmail?: string;            // DJ's email for matching in DJ Profile (set on approval)
  djUsername?: string;         // DJ's chatUsername for profile URL (set at approval if user exists)
  djSlots?: DJSlot[];          // Multiple DJ slots for venue broadcasts (optional)
  startTime: number;           // Unix timestamp ms
  endTime: number;
  broadcastToken: string;
  tokenExpiresAt: number;
  createdAt: number;
  createdBy: string;
  status: BroadcastSlotStatus;
  broadcastType: BroadcastType; // 'venue' or 'remote' - determines DJ journey
  // Live DJ info (for single-DJ broadcasts)
  liveDjUserId?: string;
  liveDjUsername?: string;
  liveDjBio?: string;
  liveDjPhotoUrl?: string;
  liveDjTipButtonLink?: string;  // External tip/support URL (from their profile)
  liveDjBandcamp?: string;       // DJ bandcamp URL (from their socialLinks)
  liveDjGenres?: string[];       // DJ genres (from their profile)
  liveDjDescription?: string;    // DJ description (from their profile)
  // Current DJ slot tracking (for venue multi-DJ shows)
  currentDjSlotId?: string;
  // Show image (used for archives)
  showImageUrl?: string;
  // Recording (for downloadable audio files)
  egressId?: string;
  recordingEgressId?: string;
  recordingUrl?: string;
  recordingStatus?: 'recording' | 'processing' | 'ready' | 'failed';
  recordingDuration?: number;
  // Multiple recordings support
  recordings?: Recording[];
  // Recording-only mode fields
  isPublic?: boolean;           // For recording type - visible on profile?
  publishedAt?: number;         // When made public (Unix ms)
  roomName?: string;            // Custom room name for recordings
  // Tagged DJs for venue recordings (other DJs playing alongside the recorder)
  taggedDJs?: TaggedDJ[];
  // Restream fields (when broadcastType === 'restream')
  archiveId?: string;             // Firestore doc ID of the archive being restreamed
  archiveRecordingUrl?: string;   // Cached MP4 URL from the archive
  archiveDuration?: number;       // Duration in seconds
  restreamDjs?: ArchiveDJ[];      // All DJs from the archive (for multi-DJ restream display)
  streamCount?: number;            // Number of streams (counted after 5+ min playback)
  sceneIdsOverride?: string[] | null; // null/undefined = inherit from DJs; [] = no scene; [ids] = pinned
}

// Recording status type
export type RecordingStatus = 'recording' | 'processing' | 'ready' | 'failed';

// Individual recording within a broadcast (supports multiple recordings per slot)
export interface Recording {
  egressId: string;
  url?: string;
  status: RecordingStatus;
  duration?: number;  // seconds
  startedAt: number;  // Unix timestamp ms
  endedAt?: number;   // Unix timestamp ms
}

// State for the broadcast hook
export interface BroadcastState {
  inputMethod: AudioInputMethod | null;
  isConnected: boolean;
  isPublishing: boolean;
  isLive: boolean;              // Egress is running
  egressId: string | null;
  recordingEgressId: string | null;  // MP4 file egress ID for recording
  hlsUrl: string | null;
  roomName: string;
  error: string | null;
  roomOccupied?: boolean;       // Another DJ is currently broadcasting
  roomFreeAt?: number | null;   // When the current DJ's slot ends (Unix ms)
  isQueued?: boolean;           // DJ is pre-connected and waiting for room to clear
  isGoingLive?: boolean;        // Go-live sequence is running (unmute → egress → Firestore)
}

// RTMP ingress info
export interface IngressInfo {
  ingressId: string;
  url: string;                  // RTMP URL
  streamKey: string;
  status: 'inactive' | 'buffering' | 'publishing' | 'error';
}

// Room status response
export interface RoomStatus {
  isLive: boolean;
  currentDJ: string | null;
  participantCount: number;
  currentSlotEndTime?: number;  // When the current live slot ends (Unix ms)
}

// Audio device for device selection
export interface AudioDevice {
  deviceId: string;
  label: string;
}

// Chat message types for DJ chat
export type ChatMessageType = 'chat' | 'love' | 'tip' | 'lockedin';

export interface ChatMessage {
  id?: string;
  stationId: string;
  username: string;
  message: string;
  timestamp: FirestoreTimestamp | Date;
  heartCount?: number;
  // DJ-specific fields
  isDJ?: boolean;              // true if sender is current DJ
  djSlotId?: string;           // broadcast-slot ID for validation
  messageType?: ChatMessageType;
}

export interface ChatMessageSerialized {
  id?: string;
  stationId: string;
  username: string;
  message: string;
  timestamp: number;
  heartCount?: number;
  isDJ?: boolean;
  djSlotId?: string;
  messageType?: ChatMessageType;
}

// Archive DJ info (simplified for archive display)
export interface ArchiveDJ {
  name: string;                // Display name
  username?: string;           // Chat username for profile link
  userId?: string;             // Firebase UID
  email?: string;              // DJ email (for watchlist matching)
  photoUrl?: string;           // Profile photo
  genres?: string[];           // DJ genres (for genre matching)
  location?: string;           // DJ city/location (for city matching)
  bio?: string;                // DJ bio snapshot from djProfile.bio at archive-creation time
}

// Archive priority (admin-only field, not exposed in public API)
export type ArchivePriority = 'high' | 'medium' | 'low';

// Archive stored in Firestore
export interface Archive {
  id: string;                    // Firestore doc ID (auto-generated)
  slug: string;                  // URL-friendly show name (e.g., "deep-house-sessions" or "deep-house-sessions-2")
  broadcastSlotId: string;       // Reference to original broadcast-slot
  showName: string;              // Original show title
  djs: ArchiveDJ[];              // DJ information (supports multiple DJs for B3B)
  recordingUrl: string;          // MP4 URL from R2
  duration: number;              // Duration in seconds
  recordedAt: number;            // Unix ms - when the show was recorded
  createdAt: number;             // Unix ms - when archive was created
  stationId: string;             // 'channel-main'
  showImageUrl?: string;         // Show image (from broadcast slot)
  streamCount?: number;          // Number of streams (counted after 5+ min playback)
  // Recording-only mode fields
  isPublic?: boolean;            // Default true for live broadcasts, false for recordings until published
  sourceType?: 'live' | 'recording';  // Distinguish live broadcast recordings from private recordings
  publishedAt?: number;          // When recording was published (Unix ms)
  priority?: ArchivePriority;    // Admin-only: high, medium, or low (default medium)
  sceneIdsOverride?: string[] | null; // null/undefined = inherit from DJs; [] = no scene; [ids] = pinned
}

// Serialized version for API responses (same as Archive since all fields are already serialized)
export type ArchiveSerialized = Archive;

// Constants
export const ROOM_NAME = 'channel-radio';
export const STATION_ID = 'channel-main';  // Default station for now
