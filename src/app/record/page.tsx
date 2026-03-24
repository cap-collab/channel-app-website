import { Suspense } from 'react';
import { makeOG } from '@/lib/og';
import { RecordClient } from './RecordClient';

export const metadata = makeOG();

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
