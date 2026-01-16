// Audio input methods for DJ broadcasting
export type AudioInputMethod = 'system' | 'device' | 'rtmp';

// Broadcast slot status
// - scheduled: slot created, waiting for DJ to go live
// - live: DJ is currently broadcasting
// - paused: DJ disconnected (browser closed, network failure) - can resume with same token
// - completed: slot ended (DJ clicked end, or slot time passed)
// - missed: slot time passed without ever going live
export type BroadcastSlotStatus = 'scheduled' | 'live' | 'paused' | 'completed' | 'missed';

// Broadcast type - venue uses permanent URL, remote gets unique token
export type BroadcastType = 'venue' | 'remote';

// Individual DJ profile for B3B scenarios (multiple DJs sharing one slot)
export interface DJProfileInfo {
  email?: string;           // For lookup and tips fallback
  userId?: string;          // Firebase UID (if account exists)
  username?: string;        // Chat username
  bio?: string;             // Bio text
  photoUrl?: string;        // Profile picture URL
  promoText?: string;       // Promo text
  promoHyperlink?: string;  // Promo link
  thankYouMessage?: string; // Thank you message for tips
  socialLinks?: {
    soundcloud?: string;
    instagram?: string;
    youtube?: string;
  };
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
  djPromoText?: string;          // Default promo text
  djPromoHyperlink?: string;     // Default promo link
  djThankYouMessage?: string;    // Thank you message
  djSocialLinks?: {              // Social links
    soundcloud?: string;
    instagram?: string;
    youtube?: string;
  };

  // B3B support: multiple DJs sharing the same slot
  djProfiles?: DJProfileInfo[];  // Array of DJ profiles for B3B scenarios

  // Runtime fields (set when slot becomes active)
  liveDjUserId?: string;     // Firebase UID of DJ who claimed this slot
  liveDjUsername?: string;   // Their chat username (or djName if no account)
  promoText?: string;        // Active promo text (can override default)
  promoHyperlink?: string;   // Active promo link (can override default)
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
  liveDjPromoText?: string;    // DJ promo text (from their profile)
  liveDjPromoHyperlink?: string; // DJ promo link (from their profile)
  // Current DJ slot tracking (for venue multi-DJ shows)
  currentDjSlotId?: string;      // ID of the currently active DJ slot
  // Show-level promo (default for all DJs)
  showPromoText?: string;
  showPromoHyperlink?: string;
  // Recording (for downloadable audio files)
  egressId?: string;              // HLS egress ID
  recordingEgressId?: string;     // MP4 file egress ID
  recordingUrl?: string;          // Public URL to download file
  recordingStatus?: 'recording' | 'processing' | 'ready' | 'failed';
  recordingDuration?: number;     // Duration in seconds
}

// Serialized version for API responses (timestamps as numbers)
export interface BroadcastSlotSerialized {
  id: string;
  stationId: string;
  showName: string;            // Show title (REQUIRED)
  djName?: string;             // Single DJ for remote broadcasts (optional)
  djUserId?: string;           // DJ's Firebase UID (set at approval if user exists, or reconciled later)
  djEmail?: string;            // DJ's email for matching in DJ Profile (set on approval)
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
  liveDjPromoText?: string;
  liveDjPromoHyperlink?: string;
  // Current DJ slot tracking (for venue multi-DJ shows)
  currentDjSlotId?: string;
  // Show-level promo
  showPromoText?: string;
  showPromoHyperlink?: string;
  // Recording (for downloadable audio files)
  egressId?: string;
  recordingEgressId?: string;
  recordingUrl?: string;
  recordingStatus?: 'recording' | 'processing' | 'ready' | 'failed';
  recordingDuration?: number;
}

// Recording status type
export type RecordingStatus = 'recording' | 'processing' | 'ready' | 'failed';

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
}

// Audio device for device selection
export interface AudioDevice {
  deviceId: string;
  label: string;
}

// Chat message types for DJ chat
export type ChatMessageType = 'chat' | 'promo' | 'love' | 'tip';

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
  promoText?: string;          // Promo text to display
  promoHyperlink?: string;     // Clickable promo link (optional)
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
  promoText?: string;
  promoHyperlink?: string;
}

// Constants
export const ROOM_NAME = 'channel-radio';
export const STATION_ID = 'channel-main';  // Default station for now
