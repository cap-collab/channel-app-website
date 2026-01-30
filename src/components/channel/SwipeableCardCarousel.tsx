'use client';

import { useState, useRef, useCallback, ReactNode, TouchEvent, MouseEvent } from 'react';

interface SwipeableCardCarouselProps {
  children: ReactNode[];
  className?: string;
}

export function SwipeableCardCarousel({ children, className = '' }: SwipeableCardCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [translateX, setTranslateX] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalCards = children.length;
  const canGoLeft = currentIndex > 0;
  const canGoRight = currentIndex < totalCards - 1;

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
            transform: `translateX(calc(-${currentIndex * 100}% + ${isDragging ? translateX : 0}px))`,
            transitionDuration: isDragging ? '0ms' : '300ms',
          }}
        >
          {children.map((child, index) => (
            <div
              key={index}
              className="w-full flex-shrink-0 px-1"
              style={{ userSelect: 'none' }}
            >
              {child}
            </div>
          ))}
        </div>
      </div>

      {/* Dots indicator */}
      {totalCards > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {children.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                index === currentIndex ? 'bg-white' : 'bg-white/30'
              }`}
              aria-label={`Go to card ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Navigation arrows - shown on larger screens */}
      {totalCards > 1 && (
        <>
          {/* Left arrow */}
          <button
            onClick={handlePrev}
            disabled={!canGoLeft}
            className={`hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-8 h-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors ${
              !canGoLeft ? 'opacity-30 cursor-not-allowed' : ''
            }`}
            aria-label="Previous card"
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Right arrow */}
          <button
            onClick={handleNext}
            disabled={!canGoRight}
            className={`hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-8 h-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors ${
              !canGoRight ? 'opacity-30 cursor-not-allowed' : ''
            }`}
            aria-label="Next card"
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
