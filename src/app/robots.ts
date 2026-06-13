import type { MetadataRoute } from 'next';

const BASE_URL = 'https://channel-app.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/internal/',
          '/broadcast/',
          '/settings',
          '/emailSignIn',
          '/unsubscribe',
          '/radio-portal',
          '/record',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
