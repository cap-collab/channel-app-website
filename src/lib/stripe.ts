import Stripe from 'stripe';

// Initialize Stripe with secret key (server-side only)
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-12-15.clover',
  typescript: true,
});

// Platform fee calculation: 15% or $0.50 minimum, whichever is higher
export function calculatePlatformFee(tipAmountCents: number): number {
  const percentageFee = Math.round(tipAmountCents * 0.15);
  const minimumFee = 50; // $0.50 in cents
  return Math.max(percentageFee, minimumFee);
}

// Calculate total charge amount (tip + platform fee)
export function calculateTotalCharge(tipAmountCents: number): {
  tipAmountCents: number;
  platformFeeCents: number;
  totalCents: number;
} {
  const platformFeeCents = calculatePlatformFee(tipAmountCents);
  return {
    tipAmountCents,
    platformFeeCents,
    totalCents: tipAmountCents + platformFeeCents,
  };
}
