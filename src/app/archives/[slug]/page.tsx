import { Metadata } from 'next';
import { ArchiveClient } from './ArchiveClient';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  // Could fetch archive data here for dynamic title, but keeping it simple
  return {
    title: `${slug.replace(/-/g, ' ')} | Channel Archives`,
    description: 'Listen to this recorded broadcast from Channel',
  };
}

export default async function ArchivePage({ params }: Props) {
  const { slug } = await params;
  return <ArchiveClient slug={slug} />;
}
