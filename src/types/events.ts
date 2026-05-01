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

// Reference to an event from a venue or collective
export interface EventRef {
  eventId: string;
  eventName: string;
  eventSlug?: string;
  eventDate?: number;
}

// Reference to a venue from an event (for multi-venue support)
export interface EventVenueRef {
  venueId: string;
  venueName: string;
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
  linkedEvents?: EventRef[];
  sceneIds?: string[];
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
  linkedEvents?: EventRef[];
  sceneIds?: string[];
  // Channel users (with auth) who can claim live ingress for this collective and edit it.
  // Distinct from residentDJs (which can include pending DJs without accounts).
  owners?: string[];
  // External support/tip URL. Button only renders on the public page when this is set.
  tipButtonLink?: string;
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
  linkedVenues?: EventVenueRef[];
  linkedCollectives?: CollectiveRef[];
  djs: EventDJRef[];
  genres?: string[];
  location?: string | null;
  ticketLink?: string | null;
  source?: 'admin' | 'dj' | 'pending-admin';
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
  sceneIdsOverride?: string[] | null; // null/undefined = inherit from DJs + collectives; [] = no scene; [ids] = pinned
  createdAt: number;
  createdBy: string;
}
