import { Timestamp } from 'firebase/firestore';

export interface TipTransaction {
  id: string;
  createdAt: Timestamp;

  // Who tipped (anonymous in chat, but tracked for records)
  tipperUserId: string;
  tipperUsername: string;

  // Who was live / scheduled
  djUserId: string;              // Firebase UID, or 'pending' if DJ not logged in
  djUsername: string;
  djEmail?: string;              // For reconciliation when djUserId is 'pending'

  // Context
  broadcastSlotId: string;
  showName: string;

  // Money (all in cents)
  tipAmountCents: number;      // What DJ receives
  platformFeeCents: number;    // Platform fee (15% or $0.50 min)
  totalChargedCents: number;   // What user paid

  // Stripe
  stripeSessionId: string;
  stripePaymentIntentId?: string;
  stripeTransferId?: string;   // Set when transferred to DJ
  status: 'pending' | 'succeeded' | 'failed';

  // Payout status
  // 'pending' = ready to transfer when DJ has Stripe
  // 'pending_dj_account' = DJ not found yet, waiting for account creation
  // 'transferred' = successfully sent to DJ
  // 'failed' = transfer failed
  // 'reallocated_to_pool' = DJ never connected Stripe, tip reallocated after 60 days
  payoutStatus: 'pending' | 'pending_dj_account' | 'transferred' | 'failed' | 'reallocated_to_pool';
  transferredAt?: Timestamp;
  reallocatedAt?: Timestamp;
}

// Support Pool Reallocation record
export interface SupportPoolReallocation {
  id: string;
  tipId: string;
  djUserId: string;
  djUsername: string;
  djEmail?: string;
  amountCents: number;
  originalTipDate: Timestamp;
  reallocatedAt: Timestamp;
}

// Serialized version for client-side use
export interface TipTransactionSerialized {
  id: string;
  createdAt: number; // timestamp in ms

  tipperUserId: string;
  tipperUsername: string;

  djUserId: string;
  djUsername: string;
  djEmail?: string;

  broadcastSlotId: string;
  showName: string;

  tipAmountCents: number;
  platformFeeCents: number;
  totalChargedCents: number;

  stripeSessionId: string;
  stripePaymentIntentId?: string;
  stripeTransferId?: string;
  status: 'pending' | 'succeeded' | 'failed';

  payoutStatus: 'pending' | 'pending_dj_account' | 'transferred' | 'failed' | 'reallocated_to_pool';
  transferredAt?: number;
  reallocatedAt?: number;
}
