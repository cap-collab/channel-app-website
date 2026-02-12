import { Metadata } from 'next';
import { StudioJoinClient } from './StudioJoinClient';

export const metadata: Metadata = {
  title: 'Claim Your Curator Profile on Channel',
  description: 'Create your curator profile on Channel. Share your sets, notify fans, receive tips, and connect with your community.',
};

export default function StudioJoinPage() {
  return <StudioJoinClient />;
}
