import { Metadata } from 'next';
import { makeOG } from '@/lib/og';
import { ArchiveClient } from './ArchiveClient';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const name = slug.replace(/-/g, ' ');
  return makeOG({ title: `Channel - ${name}` });
}

export default async function ArchivePage({ params }: Props) {
  const { slug } = await params;
  return <ArchiveClient slug={slug} />;
}
