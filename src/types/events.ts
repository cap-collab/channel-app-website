// DJ reference within an event or venue (can be a registered user or a pending DJ)
export interface EventDJRef {
  djName: string;
  djUserId?: string;
  djUsername?: string;
  djPhotoUrl?: string;
}

// Venue document in Firestore
export interface Venue {
  id: string;
  name: string;
  slug: string;
  photo?: string | null;
  location?: string | null;
  description?: string | null;
  genres?: string[];
  socialLinks?: {
    instagram?: string;
    soundcloud?: string;
    website?: string;
    residentAdvisor?: string;
  };
  residentDJs?: EventDJRef[];
  createdAt: number;
  createdBy: string;
}

// Event document in Firestore
export interface Event {
  id: string;
  name: string;
  slug: string;
  date: number;
  endDate?: number;
  photo?: string | null;
  description?: string | null;
  venueId?: string | null;
  venueName?: string | null;
  djs: EventDJRef[];
  genres?: string[];
  location?: string | null;
  ticketLink?: string | null;
  createdAt: number;
  createdBy: string;
}
