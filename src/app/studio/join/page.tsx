import { Metadata } from 'next';
import { StudioJoinClient } from './StudioJoinClient';

export const metadata: Metadata = {
  title: 'Apply to Livestream on Channel',
  description: 'Create your curator profile, live stream or record sets, notify fans, receive tips, and apply to play on Channel Broadcast.',
};

export default function StudioJoinPage() {
  return <StudioJoinClient />;
}
