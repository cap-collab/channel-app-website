// Client-side Stripe utilities (no secret key needed)

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
