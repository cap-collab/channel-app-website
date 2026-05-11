import { Metadata } from 'next';
import { RadioPortalClient } from './RadioPortalClient';

export const metadata: Metadata = {
  title: "Radio Portal",
  description: "Launch or feature your independent radio station on Channel.",
  robots: { index: false, follow: false },
};

export default function RadioPortalPage() {
  return <RadioPortalClient />;
}
