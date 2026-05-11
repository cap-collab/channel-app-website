import { Metadata } from 'next';
import { ArchivesClient } from './ArchivesClient';

export const metadata: Metadata = {
  title: "Archives",
  description: "Listen to recorded live shows from DJs broadcasting on Channel.",
};

export default function ArchivesPage() {
  return <ArchivesClient />;
}
