'use client';

import posthog from 'posthog-js';

const POSTHOG_KEY = 'phc_rhujqaRNX5mTSUnJh6udGpVLkdQW8uroDt6K69GVKzQu';
const POSTHOG_HOST = '/ingest';

let initialized = false; // init() scheduled (3s timer armed or fired)
let ready = false;       // posthog.init() has actually run

// Identity captured before posthog.init() runs (e.g. a logged-in user on page
// reload — Firebase restores the session well within the 3s init delay). We
// can't call posthog.identify() yet, so stash it and flush once ready.
let pendingIdentity: { uid: string; props: Record<string, unknown> } | null = null;

export function initPostHog() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true; // prevent double init
  // Delay PostHog init so it never competes with audio loading
  setTimeout(() => {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
      persistence: 'localStorage',
    });
    ready = true;
    if (pendingIdentity) {
      posthog.identify(pendingIdentity.uid, pendingIdentity.props);
      pendingIdentity = null;
    }
  }, 3000);
}

export function captureEvent(event: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  if (!initialized) initPostHog();
  posthog.capture(event, properties);
}

/**
 * Tie the anonymous device session to a real user account so PostHog persons
 * carry an email / chat username instead of just a random distinct_id.
 * Safe to call repeatedly — PostHog dedupes once the distinct_id is set.
 */
export function identifyUser(
  uid: string,
  properties?: { email?: string | null; chatUsername?: string | null },
) {
  if (typeof window === 'undefined' || !uid) return;
  if (!initialized) initPostHog();
  const props: Record<string, unknown> = {};
  if (properties?.email) props.email = properties.email;
  if (properties?.chatUsername) props.chatUsername = properties.chatUsername;
  // If posthog.init() hasn't run yet (still inside the 3s delay), identify()
  // would silently no-op. Defer it; initPostHog() flushes pendingIdentity.
  if (!ready) {
    pendingIdentity = { uid, props };
    return;
  }
  posthog.identify(uid, props);
}
