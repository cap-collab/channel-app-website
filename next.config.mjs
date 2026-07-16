/** @type {import('next').NextConfig} */
const nextConfig = {
  // PostHog's SDK always POSTs to trailing-slash paths (/ingest/e/, /ingest/i/v0/e/).
  // Next.js otherwise answers those with a 308 → /ingest/e redirect, and events sent
  // via navigator.sendBeacon on page-leave DON'T follow redirects, so they're dropped
  // (silently undercounting plays). Skip the redirect so /ingest/* proxies straight
  // through to PostHog with a direct 200.
  skipTrailingSlashRedirect: true,
  async redirects() {
    return [
      // /radio is the historical URL for the homepage. Google may still hold
      // SEO equity at this URL — preserve it via permanent redirect so signals
      // consolidate to /.
      {
        source: '/radio',
        destination: '/',
        permanent: true,
      },
      // /scene was renamed to /foryou. Live weekly emails already in inboxes
      // deep-link /scene?u=<token>; this 301 keeps them working (Next.js
      // preserves the ?u= query string) and consolidates SEO to /foryou.
      {
        source: '/scene',
        destination: '/foryou',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return {
      afterFiles: [
        {
          source: '/ingest/static/:path*',
          destination: 'https://us-assets.i.posthog.com/static/:path*',
        },
        {
          source: '/ingest/:path*',
          destination: 'https://us.i.posthog.com/:path*',
        },
      ],
    };
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
      // R2-backed media CDN (archive covers, recordings, interludes)
      {
        protocol: 'https',
        hostname: 'media.channel-app.com',
      },
      {
        protocol: 'https',
        hostname: '*.firebasestorage.app',
      },
      // Auto DJ profile images from external radios
      {
        protocol: 'https',
        hostname: 'dublab-api-1.s3.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'media.nts.live',
      },
      {
        protocol: 'https',
        hostname: 'media2.ntslive.co.uk',
      },
      // Subtle Radio Supabase storage
      {
        protocol: 'https',
        hostname: 'pkqpxkyxuaklmztbvryf.supabase.co',
      },
    ],
  },
};

export default nextConfig;
