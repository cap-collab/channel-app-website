'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/Header';
import { HeaderSearch } from '@/components/HeaderSearch';
import { AuthModal } from '@/components/AuthModal';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { SceneRecommendations } from '@/components/scene/SceneRecommendations';

export function SceneClient() {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  // In edit mode, a click anywhere exits — except the remove (X) buttons (which
  // stopPropagation) and the Edit toggle itself.
  useEffect(() => {
    if (!editMode) return;
    const handler = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('[data-scene-edit-toggle]')) return;
      setEditMode(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [editMode]);

  return (
    <div className="min-h-[100dvh] text-white relative flex flex-col">
      <AnimatedBackground />
      <Header currentPage="explore" position="sticky" />

      <main className="flex-1 w-full">
        {/* Search bar — left, capped, aligned with the cards' left edge. */}
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className="max-w-md">
            <HeaderSearch onAuthRequired={() => setShowAuthModal(true)} />
          </div>
        </div>

        {/* Edit toggle — FIXED top-right, stays visible while scrolling. Wrapped
            in the same max-w-7xl container so its right edge aligns with the
            cards; top-20 sits it ~level with the search bar, below the header. */}
        {canEdit && (
          <div className="fixed inset-x-0 top-20 z-40 pointer-events-none">
            <div className="max-w-7xl mx-auto px-4 flex justify-end">
              <button
                data-scene-edit-toggle
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={() => setEditMode((v) => !v)}
                aria-pressed={editMode}
                className="pointer-events-auto flex items-center gap-2 px-3 py-2.5
                           text-[11px] font-mono uppercase tracking-[0.2em] text-white
                           bg-white/10 hover:bg-white/20 border border-white/30 backdrop-blur-md
                           transition-colors"
              >
                <span
                  aria-hidden
                  className={`inline-block w-[6px] h-[6px] rounded-full transition-all ${
                    editMode ? 'bg-green-400 shadow-[0_0_6px_2px_rgba(74,222,128,0.6)]' : 'bg-zinc-400'
                  }`}
                />
                {editMode ? 'Done' : 'Edit'}
              </button>
            </div>
          </div>
        )}

        <SceneRecommendations
          onAuthRequired={() => setShowAuthModal(true)}
          editMode={editMode}
          onCanEditChange={setCanEdit}
        />
      </main>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </div>
  );
}
