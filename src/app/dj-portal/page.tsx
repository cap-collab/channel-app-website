import { makeOG } from '@/lib/og';
import { DJPortalClient } from './DJPortalClient';

export const metadata = makeOG({
  title: "DJ Portal",
  description: "Apply to DJ on Channel — pick your time slot and tell us about your show.",
});

export default function DJPortalPage() {
  return <DJPortalClient />;
}
