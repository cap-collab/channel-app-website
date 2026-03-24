import { makeOG } from '@/lib/og';
import { DJPortalClient } from './DJPortalClient';

export const metadata = makeOG();

export default function DJPortalPage() {
  return <DJPortalClient />;
}
