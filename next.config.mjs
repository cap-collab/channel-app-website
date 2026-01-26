/** @type {import('next').NextConfig} */
const nextConfig = {
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
    ],
  },
};

export default nextConfig;
