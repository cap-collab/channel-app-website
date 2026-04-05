'use client';

import { useState } from 'react';
import { HeaderSearch } from '@/components/HeaderSearch';
import { AuthModal } from '@/components/AuthModal';
import { ChannelClient } from '../radio/ChannelClient';

export function ExploreClient() {
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <>
      <ChannelClient
        skipHero
        exploreSearchBar={
          <div className="px-4 md:px-8 pt-4 pb-2 relative z-10">
            <div className="max-w-7xl mx-auto">
              <HeaderSearch onAuthRequired={() => setShowAuthModal(true)} />
            </div>
          </div>
        }
      />
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}
