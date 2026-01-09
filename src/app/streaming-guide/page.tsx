import { Metadata } from 'next';
import { StreamingGuideClient } from './StreamingGuideClient';

export const metadata: Metadata = {
  title: 'Streaming Setup Guide - Channel',
  description: 'Learn how to set up your livestream on Channel. Check if your equipment is ready and get step-by-step setup instructions.',
};

export default function StreamingGuidePage() {
  return <StreamingGuideClient />;
}
