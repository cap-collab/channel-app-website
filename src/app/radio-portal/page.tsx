import { Metadata } from 'next';
import { RadioPortalClient } from './RadioPortalClient';

export const metadata: Metadata = {
  title: 'Radio Portal - Channel',
  description: 'Launch or feature your radio station on Channel',
};

export default function RadioPortalPage() {
  return <RadioPortalClient />;
}
