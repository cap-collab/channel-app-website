'use client';

import { useState, useRef, useCallback, useEffect, ReactNode, TouchEvent, MouseEvent } from 'react';

interface SwipeableCardCarouselProps {
  children: ReactNode[];
  className?: string;
}

export function SwipeableCardCarousel({ children, className = '' }: SwipeableCardCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [translateX, setTranslateX] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track screen size for responsive behavior
  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 768);
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  const totalCards = children.length;
  const visibleCards = isDesktop ? 2 : 1;
  const maxIndex = Math.max(0, totalCards - visibleCards);

  // Clamp currentIndex when maxIndex changes (e.g., when resizing)
  useEffect(() => {
    if (currentIndex > maxIndex) {
      setCurrentIndex(maxIndex);
    }
  }, [currentIndex, maxIndex]);

  const canGoLeft = currentIndex > 0;
  const canGoRight = currentIndex < maxIndex;

  const handlePrev = useCallback(() => {
    if (canGoLeft) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [canGoLeft]);

  const handleNext = useCallback(() => {
    if (canGoRight) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [canGoRight]);

  const handleTouchStart = (e: TouchEvent) => {
    setIsDragging(true);
    setStartX(e.touches[0].clientX);
  };

  const handleMouseDown = (e: MouseEvent) => {
    setIsDragging(true);
    setStartX(e.clientX);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - startX;
    setTranslateX(diff);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    const currentX = e.clientX;
    const diff = currentX - startX;
    setTranslateX(diff);
  };

  const handleDragEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);

    const threshold = 50; // Minimum swipe distance to trigger card change

    if (translateX > threshold && canGoLeft) {
      handlePrev();
    } else if (translateX < -threshold && canGoRight) {
      handleNext();
    }

    setTranslateX(0);
  };

  const handleTouchEnd = () => handleDragEnd();
  const handleMouseUp = () => handleDragEnd();
  const handleMouseLeave = () => {
    if (isDragging) handleDragEnd();
  };

  if (totalCards === 0) return null;

  return (
    <div className={`relative ${className}`}>
      {/* Card container */}
      <div
        ref={containerRef}
        className="overflow-hidden touch-pan-y"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{
            // On desktop (2 visible), each card is 50% width, so translate by 50% per index
            // On mobile (1 visible), each card is 100% width, so translate by 100% per index
            transform: `translateX(calc(-${currentIndex * (100 / visibleCards)}% + ${isDragging ? translateX : 0}px))`,
            transitionDuration: isDragging ? '0ms' : '300ms',
          }}
        >
          {children.map((child, index) => (
            <div
              key={index}
              className="w-full md:w-1/2 flex-shrink-0 px-1"
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
