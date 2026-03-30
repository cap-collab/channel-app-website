'use client';

import { useState, useRef, useCallback, useEffect, ReactNode, MouseEvent } from 'react';

interface SwipeableCardCarouselProps {
  children: ReactNode[];
  className?: string;
}

export function SwipeableCardCarousel({ children, className = '' }: SwipeableCardCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Refs for touch/drag state (avoids re-renders during gestures)
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const translateXRef = useRef(0);
  const directionRef = useRef<'horizontal' | 'vertical' | null>(null);
  const currentIndexRef = useRef(0);
  const visibleCardsRef = useRef(1);

  // Track screen size for responsive behavior
  useEffect(() => {
    const checkDesktop = () => {
      const desktop = window.innerWidth >= 768;
      setIsDesktop(desktop);
      visibleCardsRef.current = desktop ? 2 : 1;
    };
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  const totalCards = children.length;
  const visibleCards = isDesktop ? 2 : 1;
  const maxIndex = Math.max(0, totalCards - visibleCards);

  // Keep ref in sync with state
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // Clamp currentIndex when maxIndex changes (e.g., when resizing)
  useEffect(() => {
    if (currentIndex > maxIndex) {
      setCurrentIndex(maxIndex);
    }
  }, [currentIndex, maxIndex]);

  const canGoLeft = currentIndex > 0;
  const canGoRight = currentIndex < maxIndex;

  const handlePrev = useCallback(() => {
    if (currentIndexRef.current > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, []);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => {
      const vc = visibleCardsRef.current;
      const mi = Math.max(0, totalCards - vc);
      return prev < mi ? prev + 1 : prev;
    });
  }, [totalCards]);

  // Apply transform directly to DOM (no React re-render)
  const applyTransform = useCallback((dragOffset: number, animate: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    const vc = visibleCardsRef.current;
    const baseTranslate = currentIndexRef.current * (100 / vc);
    track.style.transitionDuration = animate ? '300ms' : '0ms';
    track.style.transform = `translateX(calc(-${baseTranslate}% + ${dragOffset}px))`;
  }, []);

  // Native touch handlers (attached via addEventListener for passive: false)
  const handleTouchStart = useCallback((e: globalThis.TouchEvent) => {
    isDraggingRef.current = true;
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    translateXRef.current = 0;
    directionRef.current = null;
  }, []);

  const handleTouchMove = useCallback((e: globalThis.TouchEvent) => {
    if (!isDraggingRef.current) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = Math.abs(currentX - startXRef.current);
    const deltaY = Math.abs(currentY - startYRef.current);

    // Determine direction on first significant movement
    if (directionRef.current === null && deltaX + deltaY > 10) {
      directionRef.current = deltaY > deltaX ? 'vertical' : 'horizontal';
    }

    // Vertical scroll — bail out, let browser handle it
    if (directionRef.current === 'vertical') {
      isDraggingRef.current = false;
      return;
    }

    // Horizontal swipe — prevent vertical scroll and update transform
    if (directionRef.current === 'horizontal') {
      e.preventDefault();
      const diff = currentX - startXRef.current;
      translateXRef.current = diff;
      applyTransform(diff, false);
    }
  }, [applyTransform]);

  const handleTouchEnd = useCallback(() => {
    if (!isDraggingRef.current && directionRef.current !== 'horizontal') return;
    isDraggingRef.current = false;

    const threshold = 50;
    const tx = translateXRef.current;
    translateXRef.current = 0;

    if (tx > threshold) {
      handlePrev();
    } else if (tx < -threshold) {
      handleNext();
    } else {
      // Snap back
      applyTransform(0, true);
    }
  }, [handlePrev, handleNext, applyTransform]);

  // Attach native touch listeners with { passive: false } so preventDefault works
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  // Mouse handlers (desktop drag — kept as React events, less perf-sensitive)
  const handleMouseDown = (e: MouseEvent) => {
    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    translateXRef.current = 0;
    directionRef.current = 'horizontal'; // Mouse is always horizontal intent
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const diff = e.clientX - startXRef.current;
    translateXRef.current = diff;
    applyTransform(diff, false);
  };

  const handleMouseDragEnd = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    const threshold = 50;
    const tx = translateXRef.current;
    translateXRef.current = 0;

    if (tx > threshold) {
      handlePrev();
    } else if (tx < -threshold) {
      handleNext();
    } else {
      applyTransform(0, true);
    }
  };

  // Sync transform when currentIndex changes (from dots, arrows, or swipe)
  useEffect(() => {
    applyTransform(0, true);
  }, [currentIndex, applyTransform]);

  if (totalCards === 0) return null;

  return (
    <div className={`relative ${className}`}>
      {/* Card container */}
      <div
        ref={containerRef}
        className="overflow-hidden touch-pan-y"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseDragEnd}
        onMouseLeave={handleMouseDragEnd}
      >
        <div
          ref={trackRef}
          className="flex transition-transform duration-300 ease-out"
          style={{
            transform: `translateX(-${currentIndex * (100 / visibleCards)}%)`,
          }}
        >
          {children.map((child, index) => (
            <div
              key={index}
              className="w-full md:w-1/2 flex-shrink-0 px-1 self-stretch"
              style={{ userSelect: 'none' }}
            >
              {child}
            </div>
          ))}
        </div>
      </div>

      {/* Dots indicator - shows number of scroll positions, not total cards */}
      {maxIndex > 0 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {Array.from({ length: maxIndex + 1 }).map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                index === currentIndex ? 'bg-white' : 'bg-white/30'
              }`}
              aria-label={`Go to position ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Navigation arrows - shown on larger screens when there's content to scroll */}
      {maxIndex > 0 && (
        <>
          {/* Left arrow */}
          <button
            onClick={handlePrev}
            disabled={!canGoLeft}
            className={`hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5 w-10 h-10 items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors ${
              !canGoLeft ? 'opacity-30 cursor-not-allowed' : ''
            }`}
            aria-label="Previous card"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Right arrow */}
          <button
            onClick={handleNext}
            disabled={!canGoRight}
            className={`hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-5 w-10 h-10 items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors ${
              !canGoRight ? 'opacity-30 cursor-not-allowed' : ''
            }`}
            aria-label="Next card"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
