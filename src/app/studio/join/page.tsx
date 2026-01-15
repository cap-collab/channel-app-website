import { Metadata } from 'next';
import { StudioJoinClient } from './StudioJoinClient';

export const metadata: Metadata = {
  title: 'DJ Studio - Channel',
  description: 'Apply to broadcast live DJ sets on Channel',
};

export default function StudioJoinPage() {
  return <StudioJoinClient />;
}
