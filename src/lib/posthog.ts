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
