import { makeOG } from '@/lib/og';
import { FieldNotesClient } from './FieldNotesClient';

export const metadata = makeOG({
  title: 'Field Notes',
  description: 'Voice impressions from people who were there.',
  path: '/field-notes',
});

export default function FieldNotesPage() {
  return <FieldNotesClient />;
}
