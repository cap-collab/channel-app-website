import { Timestamp } from 'firebase/firestore';

export interface TipTransaction {
  id: string;
  createdAt: Timestamp;

  // Who tipped (anonymous in chat, but tracked for records)
  tipperUserId: string;
  tipperUsername: string;

  // Who was live / scheduled
  djUserId: string;
  djUsername: string;

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
  payoutStatus: 'pending' | 'transferred' | 'failed';
  transferredAt?: Timestamp;
}

// Serialized version for client-side use
export interface TipTransactionSerialized {
  id: string;
  createdAt: number; // timestamp in ms

  tipperUserId: string;
  tipperUsername: string;

  djUserId: string;
  djUsername: string;

  broadcastSlotId: string;
  showName: string;

  tipAmountCents: number;
  platformFeeCents: number;
  totalChargedCents: number;

  stripeSessionId: string;
  stripePaymentIntentId?: string;
  stripeTransferId?: string;
  status: 'pending' | 'succeeded' | 'failed';

  payoutStatus: 'pending' | 'transferred' | 'failed';
  transferredAt?: number;
}
