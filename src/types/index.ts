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
  };
  lastWatchlistEmailAt?: Date;
  djProfile?: {
    bio: string | null;
    promoText: string | null;
    promoHyperlink: string | null;
    stripeAccountId: string | null;
    stripeOnboarded: boolean;
    photoUrl: string | null;
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
