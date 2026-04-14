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
  const name = slug.replace(/-/g, ' ');

  let image: string | undefined;
  try {
    const adminDb = getAdminDb();
    if (adminDb) {
      const snap = await adminDb.collection('archives').where('slug', '==', slug).limit(1).get();
      if (!snap.empty) {
        const data = snap.docs[0].data();
        image = data.showImageUrl || data.djs?.[0]?.photoUrl || undefined;
      }
    }
  } catch (error) {
    console.error('[Archive Metadata] Error:', error);
  }

  return makeOG({ title: `Channel - ${name}`, image });
}

export default async function ArchivePage({ params }: Props) {
  const { slug } = await params;
  return <ArchiveClient slug={slug} />;
}
