import Stripe from 'stripe';

// Initialize Stripe lazily to avoid build-time errors
let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
    }
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-12-15.clover' as Stripe.LatestApiVersion,
      typescript: true,
    });
  }
  return stripeInstance;
}

// Export as getter to maintain same API
export const stripe = {
  get accounts() { return getStripe().accounts; },
  get accountLinks() { return getStripe().accountLinks; },
  get checkout() { return getStripe().checkout; },
  get customers() { return getStripe().customers; },
  get transfers() { return getStripe().transfers; },
  get webhooks() { return getStripe().webhooks; },
};

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
