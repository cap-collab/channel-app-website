'use client';

import posthog from 'posthog-js';

const POSTHOG_KEY = 'phc_rhujqaRNX5mTSUnJh6udGpVLkdQW8uroDt6K69GVKzQu';
const POSTHOG_HOST = '/ingest';

let initialized = false;

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
  posthog.identify(uid, props);
}
