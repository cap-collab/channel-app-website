import { Metadata } from 'next';
import { StudioJoinClient } from './StudioJoinClient';

export const metadata: Metadata = {
  title: 'DJ Studio - Create Your DJ Channel',
  description: 'Create your DJ profile, live stream or record sets, notify fans, receive tips, and apply to play on Channel Broadcast.',
};

export default function StudioJoinPage() {
  return <StudioJoinClient />;
}
