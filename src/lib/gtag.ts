const GOOGLE_ADS_ID = 'AW-18093488515';
const LEAD_CONVERSION_LABEL = 'TrzhCNOe0ZwcEIPz0rND';

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
