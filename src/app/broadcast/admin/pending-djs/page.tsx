import { Metadata } from 'next';
import { PendingDJsAdmin } from './PendingDJsAdmin';

export const metadata: Metadata = {
  title: 'Create Pending DJ Profile - Channel Admin',
  description: 'Create DJ profiles for DJs who haven\'t signed up yet',
};

export default function PendingDJsPage() {
  return <PendingDJsAdmin />;
}
