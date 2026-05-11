import type { MetadataRoute } from 'next';
import { getAdminDb } from '@/lib/firebase-admin';

const BASE_URL = 'https://channel-app.com';

// Public DJ profile pages live at /dj/[chatUsernameNormalized]. We include
// users explicitly tagged role === 'dj', plus the single admin account that
// runs the station feed (chatUsernameNormalized === 'channelbroadcast'), so
// its profile is discoverable.
async function getDjEntries(): Promise<MetadataRoute.Sitemap> {
  const adminDb = getAdminDb();
  if (!adminDb) return [];

  try {
    const lastModified = new Date();
    const seen = new Set<string>();
    const out: MetadataRoute.Sitemap = [];

    const pushFromSnapshot = (
      snapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>,
    ) => {
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const slug: string | undefined = data.chatUsernameNormalized;
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        out.push({
          url: `${BASE_URL}/dj/${encodeURIComponent(slug)}`,
          lastModified,
          changeFrequency: 'weekly',
          priority: 0.7,
        });
      }
    };

    const [djSnap, channelBroadcastSnap] = await Promise.all([
      adminDb.collection('users').where('role', '==', 'dj').get(),
      adminDb
        .collection('users')
        .where('chatUsernameNormalized', '==', 'channelbroadcast')
        .limit(1)
        .get(),
    ]);

    pushFromSnapshot(djSnap);
    pushFromSnapshot(channelBroadcastSnap);

    return out;
  } catch (error) {
    console.error('[sitemap] Failed to fetch DJ entries:', error);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();

  const staticEntries: Array<{
    path: string;
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
    priority: number;
  }> = [
    { path: '/', changeFrequency: 'always', priority: 1.0 },
    { path: '/archives', changeFrequency: 'daily', priority: 0.9 },
    { path: '/explore', changeFrequency: 'daily', priority: 0.8 },
    { path: '/streaming-guide', changeFrequency: 'weekly', priority: 0.7 },
    { path: '/about', changeFrequency: 'monthly', priority: 0.7 },
    { path: '/dj-portal', changeFrequency: 'monthly', priority: 0.6 },
    { path: '/guidelines', changeFrequency: 'monthly', priority: 0.5 },
    { path: '/dj-terms', changeFrequency: 'yearly', priority: 0.3 },
    { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
    { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  ];

  const djEntries = await getDjEntries();

  return [
    ...staticEntries.map(({ path, changeFrequency, priority }) => ({
      url: `${BASE_URL}${path}`,
      lastModified,
      changeFrequency,
      priority,
    })),
    ...djEntries,
  ];
}
