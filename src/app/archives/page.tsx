import { Metadata } from 'next';
import { ArchivesClient } from './ArchivesClient';

export const metadata: Metadata = {
  title: 'Archives | Channel',
  description: 'Listen to recorded live broadcasts from Channel DJs',
};

export default function ArchivesPage() {
  return <ArchivesClient />;
}
