import type { MetadataRoute } from 'next';

const BASE_URL = 'https://channel-app.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/api/',
          '/internal/',
          '/dj/studio',
          '/dj-portal',
          '/radio-portal',
          '/broadcast/',
          '/my-shows',
          '/settings',
          '/emailSignIn',
          '/unsubscribe',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
