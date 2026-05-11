import { Metadata } from 'next';
import { StudioLivestreamClient } from './StudioLivestreamClient';

export const metadata: Metadata = {
  title: "Book a show",
  description: "Request a livestream slot on Channel radio.",
};

export default function StudioLivestreamPage() {
  return <StudioLivestreamClient />;
}
