# Stripe Tipping Integration — Reference Notes

> **Status:** Removed from codebase (March 2026). This document preserves the architecture
> and implementation details for future re-implementation.

## Architecture Overview

- **Stripe Connect Express** accounts for DJs (individual type)
- **Destination charges** for onboarded DJs (payment goes to DJ, platform collects app fee)
- **Platform-held payments** for non-onboarded DJs (transferred later via cron)
- **60-day claim window** for unclaimed tips (reallocated to DJ Support Pool after expiry)

## Fee Structure

- Platform fee: **15%** or **$0.50 minimum**, whichever is higher
- `calculatePlatformFee(tipAmountCents)`: `Math.max(Math.round(tipAmountCents * 0.15), 50)`
- Total charge = tip amount + platform fee

## Tip Limits

- Guest users: max **$20** per tip
- Authenticated users: max **$200** per tip, max **$200** per session (per DJ per broadcast)
- Minimum tip: **$1**

## Environment Variables

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
CRON_SECRET=<random-secret-for-cron-auth>
```

## npm Package

```json
"stripe": "^20.1.2"
```

API version used: `2025-12-15.clover`

## Firestore Collections

### `tips` collection
Each document represents a completed tip:
```
{
  createdAt: Timestamp,
  tipperUserId: string,        // 'guest' for unauthenticated
  tipperUsername: string,
  tipperEmail?: string,
  djUserId: string,            // 'pending' if DJ not found
  djUsername: string,
  djEmail?: string,
  djThankYouMessage: string,
  broadcastSlotId: string,
  showName: string,
  tipAmountCents: number,
  platformFeeCents: number,
  totalChargedCents: number,
  stripeSessionId: string,
  stripePaymentIntentId: string,
  stripeTransferId?: string,
  status: 'succeeded',
  payoutStatus: 'pending' | 'pending_dj_account' | 'transferred' | 'reallocated_to_pool' | 'failed',
  usedDestinationCharge: boolean,
  transferredAt?: Timestamp,
  reallocatedAt?: Timestamp,
}
```

### `users` collection (Stripe-related fields on djProfile)
```
{
  stripeCustomerId?: string,         // On tipper's user doc (for saved cards)
  djProfile: {
    stripeAccountId: string | null,  // DJ's Stripe Connect Express account ID
    stripeOnboarded: boolean,        // Whether DJ completed Stripe onboarding
    thankYouMessage: string | null,  // Shown after tip
  }
}
```

## Deleted Files Inventory

### API Routes (`src/app/api/stripe/`)
| File | Purpose |
|------|---------|
| `stripe/tip/create-checkout/route.ts` | Creates Stripe Checkout Session for tips |
| `stripe/webhook/route.ts` | Handles checkout.session.completed, account.updated, transfer.created/failed |
| `stripe/connect/create-account/route.ts` | Creates Stripe Connect Express account for DJ |
| `stripe/connect/account-link/route.ts` | Generates Stripe onboarding link |
| `stripe/connect/check-status/route.ts` | Checks if DJ's Stripe account is fully onboarded |
| `stripe/connect/process-pending/route.ts` | Processes pending tips for newly connected DJ |
| `stripe/debug-tips/route.ts` | Debug endpoint for recent tips |
| `stripe/webhook-test/route.ts` | Test endpoint for webhook reachability |

### Tips API Routes (`src/app/api/tips/`)
| File | Purpose |
|------|---------|
| `tips/history/route.ts` | GET — tip history for a user (grouped by DJ) |
| `tips/received/route.ts` | GET — tips received by a DJ (grouped by tipper) |
| `tips/by-session/route.ts` | GET — tip details by Stripe session ID |

### Cron Jobs (`src/app/api/cron/`)
| File | Purpose | Schedule |
|------|---------|----------|
| `cron/process-pending-tips/route.ts` | Transfers pending tips to DJs with Stripe | Daily |
| `cron/send-tip-reminders/route.ts` | Emails DJs about unclaimed tips (days 1,7,30,45,50,59) | Daily |
| `cron/reallocate-expired-tips/route.ts` | Moves 60-day-old unclaimed tips to DJ Support Pool | Daily |

### Libraries (`src/lib/`)
| File | Purpose |
|------|---------|
| `stripe.ts` | Server-side Stripe SDK init, fee calculations |
| `stripe-client.ts` | Client-side fee calculations (no secret key) |
| `tip-history-storage.ts` | LocalStorage for guest tip history |

### Components (`src/components/channel/`)
| File | Purpose |
|------|---------|
| `TipModal.tsx` | Modal with preset amounts ($5/$10/$20), custom input, fee breakdown, Stripe checkout redirect |
| `TipThankYouModal.tsx` | Post-tip confirmation modal with DJ's thank you message |

### Pages
| File | Purpose |
|------|---------|
| `src/app/inbox/page.tsx` | Inbox page server component |
| `src/app/inbox/InboxClient.tsx` | Tips sent/received tabs, grouped by DJ/tipper |
| `src/app/stripe-setup/page.tsx` | Stripe setup guide page |
| `src/app/stripe-setup/StripeSetupClient.tsx` | Accordion guide for DJ Stripe onboarding |

### Hooks (`src/hooks/`)
| File | Purpose |
|------|---------|
| `usePendingPayout.ts` | Monitors DJ's pending/transferred tips from Firestore |
| `useTipTotal.ts` | Calculates total tips for a DJ/broadcast session |

## Key Flows

### 1. Tip Checkout Flow
1. User clicks tip button → TipModal opens
2. User selects amount ($5/$10/$20 or custom)
3. Fee breakdown shown (tip + 15% platform fee)
4. User agrees to terms → POST `/api/stripe/tip/create-checkout`
5. API checks DJ's Stripe account status
6. If DJ has Stripe: creates checkout with `transfer_data.destination` + `application_fee_amount`
7. If DJ doesn't have Stripe: creates checkout on platform account (tip held for later transfer)
8. User redirected to Stripe Checkout → completes payment
9. Stripe webhook fires `checkout.session.completed` → tip record created in Firestore
10. If destination charge: payment auto-transfers to DJ
11. If platform-held: cron job transfers later when DJ connects Stripe

### 2. DJ Stripe Onboarding
1. DJ visits Studio → Payments section → "Connect Stripe"
2. POST `/api/stripe/connect/create-account` → creates Express account
3. POST `/api/stripe/connect/account-link` → generates onboarding URL
4. DJ completes Stripe onboarding (identity, bank account, etc.)
5. Redirected back to Studio with `?stripe=success`
6. GET `/api/stripe/connect/check-status` → verifies `charges_enabled && payouts_enabled`
7. Updates `djProfile.stripeOnboarded = true` in Firestore

### 3. Pending Tip Processing (Cron)
1. Daily cron: `/api/cron/process-pending-tips`
2. Queries tips with `payoutStatus='pending'`, groups by DJ
3. For each DJ: checks if Stripe account enabled
4. If enabled: creates Stripe transfer, updates `payoutStatus='transferred'`
5. If not enabled: skips (tip remains pending)

### 4. Tip Reminders (Cron)
1. Daily cron: `/api/cron/send-tip-reminders`
2. Finds DJs with pending tips
3. Sends reminder emails at days 1, 7, 30, 45, 50, 59
4. 60-day claim window enforced

### 5. Expired Tip Reallocation (Cron)
1. Daily cron: `/api/cron/reallocate-expired-tips`
2. Finds tips older than 60 days with `payoutStatus='pending'`
3. Updates to `payoutStatus='reallocated_to_pool'`
4. Creates audit record

## Webhook Events Handled
- `checkout.session.completed` — creates tip record, posts chat message
- `account.updated` — syncs DJ Stripe onboarding status, triggers pending tip transfers
- `transfer.created` — updates tip payout status to 'transferred'
- `transfer.failed` — marks tip as 'failed'

## Re-implementation Checklist
1. Install `stripe` npm package
2. Set environment variables (see above)
3. Re-create API routes (see file inventory)
4. Re-create TipModal component with preset amounts and fee display
5. Re-create Stripe Connect onboarding flow in Studio
6. Set up Stripe webhook endpoint and configure in Stripe Dashboard
7. Set up Vercel cron jobs for tip processing/reminders/reallocation
8. Re-add `stripeAccountId` and `stripeOnboarded` to djProfile type
9. Re-create inbox page for tip history
10. Add `usePendingPayout` and `useTipTotal` hooks
11. Configure Stripe Connect settings (Express accounts, card_payments + transfers capabilities)
