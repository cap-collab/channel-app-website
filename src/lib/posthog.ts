'use client';

import posthog from 'posthog-js';

const POSTHOG_KEY = 'phc_rhujqaRNX5mTSUnJh6udGpVLkdQW8uroDt6K69GVKzQu';
const POSTHOG_HOST = 'https://us.i.posthog.com';

let initialized = false;

export function initPostHog() {
  if (initialized || typeof window === 'undefined') return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    persistence: 'localStorage',
  });
  initialized = true;
}

export function captureEvent(event: string, properties?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  if (!initialized) initPostHog();
  posthog.capture(event, properties);
}
