import { Timestamp } from 'firebase/firestore';

export type DJApplicationStatus = 'pending' | 'info-requested' | 'approved' | 'denied';
export type LocationType = 'home' | 'venue';

export interface TimeSlot {
  start: number; // Unix timestamp ms
  end: number;   // Unix timestamp ms
}

export interface DJApplication {
  id: string;
  djName: string;
  email: string;
  showName: string;
  locationType: LocationType;
  venueName?: string;
  soundcloud?: string;
  instagram?: string;
  youtube?: string;
  preferredSlots: TimeSlot[];
  timezone: string; // IANA timezone, e.g., "America/New_York"
  comments?: string;
  needsSetupSupport?: boolean;
  status: DJApplicationStatus;
  submittedAt: Timestamp;
  adminNotes?: string;
  scheduledSlotId?: string; // Set when approved
}

// Serialized version for API responses (timestamps as numbers)
export interface DJApplicationSerialized {
  id: string;
  djName: string;
  email: string;
  showName: string;
  locationType: LocationType;
  venueName?: string;
  soundcloud?: string;
  instagram?: string;
  youtube?: string;
  preferredSlots: TimeSlot[];
  timezone: string;
  comments?: string;
  needsSetupSupport?: boolean;
  status: DJApplicationStatus;
  submittedAt: number;
  adminNotes?: string;
  scheduledSlotId?: string;
}

// Form data for submission
export interface DJApplicationFormData {
  djName: string;
  email: string;
  showName: string;
  locationType: LocationType;
  venueName?: string;
  soundcloud?: string;
  instagram?: string;
  youtube?: string;
  preferredSlots: TimeSlot[];
  timezone: string;
  comments?: string;
  needsSetupSupport?: boolean;
}
