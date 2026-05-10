import type { MetadataRoute } from 'next';

const BASE_URL = 'https://channel-app.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const entries: Array<{
    path: string;
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
    priority: number;
  }> = [
    { path: '/', changeFrequency: 'always', priority: 1.0 },
    { path: '/archives', changeFrequency: 'daily', priority: 0.9 },
    { path: '/djshows', changeFrequency: 'daily', priority: 0.9 },
    { path: '/explore', changeFrequency: 'daily', priority: 0.8 },
    { path: '/streaming-guide', changeFrequency: 'weekly', priority: 0.7 },
    { path: '/about', changeFrequency: 'monthly', priority: 0.7 },
    { path: '/apply', changeFrequency: 'monthly', priority: 0.7 },
    { path: '/guidelines', changeFrequency: 'monthly', priority: 0.5 },
    { path: '/dj-terms', changeFrequency: 'yearly', priority: 0.3 },
    { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
    { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  ];

  return entries.map(({ path, changeFrequency, priority }) => ({
    url: `${BASE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
