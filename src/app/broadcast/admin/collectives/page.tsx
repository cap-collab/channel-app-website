import { Metadata } from 'next';
import { CollectivesAdmin } from './CollectivesAdmin';

export const metadata: Metadata = {
  title: 'Manage Collectives - Channel Admin',
  description: 'Create and manage collective profiles',
};

export default function CollectivesPage() {
  return <CollectivesAdmin />;
}
