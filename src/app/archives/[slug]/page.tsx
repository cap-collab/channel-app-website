import { Metadata } from 'next';
import { makeOG } from '@/lib/og';
import { getAdminDb } from '@/lib/firebase-admin';
import { ArchiveClient } from './ArchiveClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const fallbackName = slug.replace(/-/g, ' ');

  let showName = fallbackName;
  let djNames = '';
  let image: string | undefined;
  try {
    const adminDb = getAdminDb();
    if (adminDb) {
      const snap = await adminDb.collection('archives').where('slug', '==', slug).limit(1).get();
      if (!snap.empty) {
        const data = snap.docs[0].data();
        showName = data.showName || fallbackName;
        const djs: Array<{ name?: string; photoUrl?: string }> = data.djs || [];
        djNames = djs.map((dj) => dj.name).filter(Boolean).join(', ');
        image = data.showImageUrl || djs[0]?.photoUrl || undefined;
      }
    }
  } catch (error) {
    console.error('[Archive Metadata] Error:', error);
  }

  const title = djNames ? `${showName} · ${djNames}` : showName;
  const description = djNames
    ? `Listen to ${showName} by ${djNames} on Channel — community-led internet radio.`
    : `Listen to ${showName} on Channel — community-led internet radio.`;
  return makeOG({ title, description, image, path: `/archives/${encodeURIComponent(slug)}` });
}

export default async function ArchivePage({ params }: Props) {
  const { slug } = await params;
  return <ArchiveClient slug={slug} />;
}
