import { Metadata } from 'next';
import { Suspense } from 'react';
import { RecordClient } from './RecordClient';

export const metadata: Metadata = {
  title: 'Record Your Set - Channel',
  description: 'Record your DJ set on Channel (2 hours per month)',
};

export default function RecordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    }>
      <RecordClient />
    </Suspense>
  );
}
