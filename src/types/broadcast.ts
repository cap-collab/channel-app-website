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

// DJ slot within a venue show
export interface DJSlot {
  id: string;
  djName?: string;           // Optional - can be TBD
  startTime: number;         // Unix timestamp ms
  endTime: number;           // Unix timestamp ms
  // Live DJ info (filled when DJ claims slot)
  liveDjUserId?: string;     // Firebase UID of DJ who claimed this slot
  liveDjUsername?: string;   // Their chat username
  promoUrl?: string;         // DJ-specific promo link (overrides show promo)
  promoTitle?: string;       // Optional title for promo
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
  // Show-level promo (default for all DJs)
  showPromoUrl?: string;
  showPromoTitle?: string;
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
  // Show-level promo
  showPromoUrl?: string;
  showPromoTitle?: string;
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
  promoUrl?: string;           // only for messageType: 'promo'
  promoTitle?: string;         // optional display title
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
  promoUrl?: string;
  promoTitle?: string;
}

// Constants
export const ROOM_NAME = 'channel-radio';
export const STATION_ID = 'channel-main';  // Default station for now
