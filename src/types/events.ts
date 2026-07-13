// DJ reference within an event or venue (can be a registered user or a pending DJ)
export interface EventDJRef {
  djName: string;
  djUserId?: string;
  djUsername?: string;
  djPhotoUrl?: string;
}

// Reference to a collective from another collective
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

// Venue on an event. Venues are NOT an entity — this is just a free-text name.
// `venueId` is legacy (older docs linked to a venues collection that no longer
// exists); it is never written anymore and nothing resolves it.
export interface EventVenueRef {
  venueName: string;
  venueId?: string;
}

// Custom link (label + URL pair) for admin-added links
export interface CustomLink {
  label: string;
  url: string;
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
  // Guest DJs — a separate category from residents, shown in its own grid on
  // the collective page and surfaced on each guest's DJ page like residents.
  guestDJs?: EventDJRef[];
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
  // Denormalized free-text venue name (from linkedVenues[0]). Venues are not an
  // entity — there is no id to resolve and no venue page to link to.
  venueName?: string | null;
  // Legacy: older docs linked to a venues collection that no longer exists.
  venueId?: string | null;
  venueCollectiveId?: string | null;
  venueCollectiveName?: string | null;
  venueCollectiveSlug?: string | null;
  collectiveId?: string | null;
  collectiveName?: string | null;
  linkedVenues?: EventVenueRef[];
  linkedCollectives?: CollectiveRef[];
  djs: EventDJRef[];
  genres?: string[];
  location?: string | null;
  ticketLink?: string | null;
  // Optional discount/promo code for the event. Display is gated to logged-in
  // users on the public card (rendering added later).
  discountCode?: string | null;
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
