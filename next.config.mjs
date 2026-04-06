/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: '/',
        destination: '/radio',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
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
