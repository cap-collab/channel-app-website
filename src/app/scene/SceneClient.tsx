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
        {/* Search bar — same container as the cards (max-w-7xl px-4) so its left
            edge aligns with the grid below; the field itself is capped + left. */}
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className="max-w-md">
            <HeaderSearch onAuthRequired={() => setShowAuthModal(true)} />
          </div>
        </div>

        <SceneRecommendations onAuthRequired={() => setShowAuthModal(true)} />
      </main>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </div>
  );
}
