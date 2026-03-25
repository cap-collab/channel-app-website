import { Suspense } from 'react';
import { DemoClient } from './DemoClient';

export const metadata = {
  robots: 'noindex, nofollow',
};

export default function RadioDemoPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <DemoClient />
    </Suspense>
  );
}
