import { makeOG } from '@/lib/og';
import { StudioJoinClient } from './StudioJoinClient';

export const metadata = makeOG();

export default function StudioJoinPage() {
  return <StudioJoinClient />;
}
