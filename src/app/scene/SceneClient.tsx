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
  // Measured top offset for the fixed Edit button = sticky <header> height + the
  // search bar's pt-4 (16px), so it lands level with the search bar regardless of
  // whether the broadcast bar inside the header is showing.
  const [editTop, setEditTop] = useState(96);

  useEffect(() => {
    const measure = () => {
      const header = document.querySelector('header');
      const h = header?.getBoundingClientRect().height ?? 80;
      setEditTop(Math.round(h + 16)); // + pt-4
    };
    measure();
    window.addEventListener('resize', measure);
    // Re-measure shortly after mount (broadcast bar may expand/collapse async).
    const t = setTimeout(measure, 500);
    return () => {
      window.removeEventListener('resize', measure);
      clearTimeout(t);
    };
  }, [canEdit]);

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

      {/* Edit toggle — fixed, stays visible while scrolling. `top` is MEASURED
          from the sticky header height (nav + broadcast bar, which varies) so it
          lands level with the search bar. Wrapped in the cards' max-w-7xl
          container (justify-end) so its RIGHT edge aligns with the cards, not the
          viewport edge, on desktop. */}
      {canEdit && (
        <div
          style={{ top: editTop }}
          className="fixed inset-x-0 z-50 pointer-events-none"
        >
          <div className="max-w-7xl mx-auto px-4 flex justify-end">
            <button
              data-scene-edit-toggle
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onClick={() => setEditMode((v) => !v)}
              aria-pressed={editMode}
              className="pointer-events-auto flex items-center gap-2 px-3 py-2
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

      <main className="flex-1 w-full">
        {/* Search bar — left, capped, aligned with the cards' left edge. Right
            padding reserves space for the fixed Edit button so the field stops
            before it on mobile (md+ has room, so no reserve needed). */}
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className="max-w-md pr-20 md:pr-0">
            <HeaderSearch onAuthRequired={() => setShowAuthModal(true)} />
          </div>
        </div>

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
