// Show data from metadata.json (V2 format with compressed field names)
export interface ShowV2 {
  n: string; // name
  s: string; // start time (ISO 8601)
  e: string; // end time (ISO 8601)
  d?: string | null; // description
  j?: string | null; // dj/host
  u?: string | null; // image url
  t?: string | null; // type (weekly, monthly, restream, playlist)
  p?: string | null; // profile username (for DJ profile link)
}

// Expanded show with station info
export interface Show {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  description?: string;
  dj?: string;
  djBio?: string;
  djPhotoUrl?: string;
  djUsername?: string; // For DJ profile URL
  djLocation?: string; // DJ's city/location from profile
  imageUrl?: string;
  stationId: string;
  type?: string; // weekly, monthly, restream, playlist
  // For tipping (broadcast shows only)
  djUserId?: string;
  djEmail?: string;
  broadcastSlotId?: string;
  // Promo info (broadcast shows only)
  promoText?: string;
  promoUrl?: string;
  // DJ genres from profile
  djGenres?: string[];
}

// Metadata response from GitHub
export interface MetadataResponse {
  v: number;
  updated: string;
  stations: {
    [key: string]: ShowV2[];
  };
}

// Station configuration
export interface Station {
  id: string;
  name: string;
  metadataKey: string;
  streamUrl: string;
  websiteUrl: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
}

// User document in Firestore
export interface UserDocument {
  email: string;
  displayName: string;
  createdAt: Date;
  lastSeenAt: Date;
  timezone: string;
  role?: 'user' | 'dj' | 'broadcaster' | 'admin';
  djTermsAcceptedAt?: Date;
  googleCalendar?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    calendarId: string;
  };
  emailNotifications: {
    showStarting: boolean;
    watchlistMatch: boolean;
    mentions?: boolean;
    popularity?: boolean;
    djOnline?: boolean;
  };
  lastWatchlistEmailAt?: Date;
  lastDjOnlineEmailAt?: Record<string, number>; // { [djUserId]: timestamp }
  djProfile?: {
    bio: string | null;
    promoText: string | null;
    promoHyperlink: string | null;
    stripeAccountId: string | null;
    stripeOnboarded: boolean;
    photoUrl: string | null;
  };
  // Recording quota tracking (for self-service recording feature)
  recordingQuota?: {
    monthKey: string;           // "2026-02" format for current billing period
    usedSeconds: number;        // Total seconds used this month
    maxSeconds: number;         // 7200 (2 hours) default, can be overridden per user
  };
}

// Favorite document in Firestore
export interface FavoriteDocument {
  term: string;
  type: "show" | "dj" | "search";
  showName?: string;
  djName?: string;
  stationId?: string;
  createdAt: Date;
  createdBy: "web" | "ios";
}

// IRL Show data for "IRL near you" section
export interface IRLShowData {
  djUsername: string;
  djName: string;
  djPhotoUrl?: string;
  djLocation?: string; // DJ's home city from profile
  djGenres?: string[];
  eventName: string;
  location: string;   // Event city
  ticketUrl: string;
  date: string;       // ISO date string (YYYY-MM-DD)
}

// Station application
export interface StationApplication {
  stationName: string;
  logoUrl: string;
  accentColor: string;
  streamUrl: string;
  scheduleUrl: string;
  contactEmail: string;
  message?: string;
  submittedAt: Date;
  status: "pending" | "approved" | "rejected";
}
