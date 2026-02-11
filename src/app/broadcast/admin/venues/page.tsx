import { Metadata } from 'next';
import { VenuesAdmin } from './VenuesAdmin';

export const metadata: Metadata = {
  title: 'Manage Venues - Channel Admin',
  description: 'Create and manage venue profiles',
};

export default function VenuesPage() {
  return <VenuesAdmin />;
}
