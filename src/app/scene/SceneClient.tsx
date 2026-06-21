'use client';

import { useState } from 'react';
import { Header } from '@/components/Header';
import { HeaderSearch } from '@/components/HeaderSearch';
import { AuthModal } from '@/components/AuthModal';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { SceneRecommendations } from '@/components/scene/SceneRecommendations';

export function SceneClient() {
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <Header currentPage="explore" position="sticky" />

      <main className="flex-1 w-full">
        {/* Search bar (kept from the old /scene) */}
        <div className="max-w-5xl mx-auto px-4 pt-4">
          <HeaderSearch onAuthRequired={() => setShowAuthModal(true)} />
        </div>

        <SceneRecommendations onAuthRequired={() => setShowAuthModal(true)} />
      </main>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </div>
  );
}
