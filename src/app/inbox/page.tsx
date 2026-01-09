import { Suspense } from 'react';
import { InboxClient } from './InboxClient';

export default function InboxPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
      </div>
    }>
      <InboxClient />
    </Suspense>
  );
}
