import { Metadata } from 'next';
import { DJPortalClient } from './DJPortalClient';

export const metadata: Metadata = {
  title: 'DJ Portal - Channel',
  description: 'Apply to broadcast live DJ sets on Channel',
};

export default function DJPortalPage() {
  return <DJPortalClient />;
}
