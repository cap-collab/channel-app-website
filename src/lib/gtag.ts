const GOOGLE_ADS_ID = 'AW-18093488515';
const LEAD_CONVERSION_LABEL = 'TrzhCNOe0ZwcEIPz0rND';
// Separate "Play" conversion — distinct label so Google Ads can optimize toward
// listeners without plays drowning out the lead signal. Set to Secondary in the
// Ads UI (Count: One) so it informs bidding but doesn't dominate it.
const PLAY_CONVERSION_LABEL = 'gLWkCNOf0NEcEIPz0rND';

type GtagFn = (...args: unknown[]) => void;

export function trackLeadConversion(value = 1.0, currency = 'USD') {
  if (typeof window === 'undefined') return;
  const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
  if (typeof gtag !== 'function') return;
  gtag('event', 'conversion', {
    send_to: `${GOOGLE_ADS_ID}/${LEAD_CONVERSION_LABEL}`,
    value,
    currency,
  });
}

// Fires the "Play" Ads conversion once per page load. Safe to call from every
// playback_started site (archive/radio/live, incl. live's webrtc/native/hls
// fallbacks) — the module-level guard collapses them to a single fire, matching
// the Ads action's Count: One without relying on Google-side dedup. No-ops
// safely if gtag hasn't loaded yet.
let playConversionFired = false;
export function trackPlayConversion() {
  if (typeof window === 'undefined') return;
  if (playConversionFired) return;
  const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
  if (typeof gtag !== 'function') return;
  playConversionFired = true;
  gtag('event', 'conversion', {
    send_to: `${GOOGLE_ADS_ID}/${PLAY_CONVERSION_LABEL}`,
  });
}
