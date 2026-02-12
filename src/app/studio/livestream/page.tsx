import { Metadata } from 'next';
import { StudioLivestreamClient } from './StudioLivestreamClient';

export const metadata: Metadata = {
  title: 'Request a Livestream Slot on Channel',
  description: 'Apply to schedule a live set on Channel Broadcast.',
};

export default function StudioLivestreamPage() {
  return <StudioLivestreamClient />;
}
