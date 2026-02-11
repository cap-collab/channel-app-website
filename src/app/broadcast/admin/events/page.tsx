import { Metadata } from 'next';
import { EventsAdmin } from './EventsAdmin';

export const metadata: Metadata = {
  title: 'Manage Events - Channel Admin',
  description: 'Create and manage events',
};

export default function EventsPage() {
  return <EventsAdmin />;
}
