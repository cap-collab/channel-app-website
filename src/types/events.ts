// DJ reference within an event or venue (can be a registered user or a pending DJ)
export interface EventDJRef {
  djName: string;
  djUserId?: string;
  djUsername?: string;
  djPhotoUrl?: string;
}

// Reference to a venue from a collective (or vice versa)
export interface CollectiveVenueRef {
  venueId: string;
  venueName: string;
}

// Reference to a collective from a venue or another collective
export interface CollectiveRef {
  collectiveId: string;
  collectiveName: string;
  collectiveSlug?: string;
  collectivePhoto?: string | null;
}

// Custom link (label + URL pair) for admin-added links
export interface CustomLink {
  label: string;
  url: string;
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
    bandcamp?: string;
    youtube?: string;
    mixcloud?: string;
    email?: string;
    website?: string;
    residentAdvisor?: string;
    customLinks?: CustomLink[];
  };
  residentDJs?: EventDJRef[];
  collectives?: CollectiveRef[];
  createdAt: number;
  createdBy: string;
}

// Collective document in Firestore
export interface Collective {
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
    bandcamp?: string;
    youtube?: string;
    mixcloud?: string;
    email?: string;
    website?: string;
    residentAdvisor?: string;
    customLinks?: CustomLink[];
  };
  residentDJs?: EventDJRef[];
  linkedVenues?: CollectiveVenueRef[];
  linkedCollectives?: CollectiveRef[];
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
  collectiveId?: string | null;
  collectiveName?: string | null;
  djs: EventDJRef[];
  genres?: string[];
  location?: string | null;
  ticketLink?: string | null;
  socialLinks?: {
    instagram?: string;
    soundcloud?: string;
    bandcamp?: string;
    youtube?: string;
    mixcloud?: string;
    email?: string;
    website?: string;
    residentAdvisor?: string;
    customLinks?: CustomLink[];
  };
  createdAt: number;
  createdBy: string;
}
