import { makeOG } from '@/lib/og';
import { FieldNotesClient } from './FieldNotesClient';

export const metadata = makeOG({
  title: 'Tapes',
  description: 'Voices from the people who were there.',
  path: '/tape',
});

export default function TapePage() {
  return <FieldNotesClient />;
}
