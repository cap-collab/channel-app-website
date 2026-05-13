"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface ResidentItem {
  key: string;
  href: string | null;
  name: string;
  photoUrl?: string;
  bio?: string;
  badge?: string;
  isCollective: boolean;
}

interface ResidentsGridProps {
  items: ResidentItem[];
}

export function ResidentsGrid({ items }: ResidentsGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [activePage, setActivePage] = useState(0);

  const measure = () => {
    const el = scrollRef.current;
    if (!el) return;
    const overflow = el.scrollWidth > el.clientWidth + 1;
    setHasOverflow(overflow);
    const left = el.scrollLeft;
    setCanLeft(left > 0);
    setCanRight(left < el.scrollWidth - el.clientWidth - 1);
    if (overflow && el.clientWidth > 0) {
      const pages = Math.max(1, Math.ceil(el.scrollWidth / el.clientWidth));
      setPageCount(pages);
      setActivePage(Math.min(pages - 1, Math.round(left / el.clientWidth)));
    } else {
      setPageCount(1);
      setActivePage(0);
    }
  };

  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
    };
  }, [items.length]);

  const scrollByPage = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="relative">
      {/* Left arrow (desktop only) */}
      {hasOverflow && canLeft && (
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollByPage(-1)}
          className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 z-10 h-9 w-9 items-center justify-center rounded-full bg-zinc-900/80 border border-white/10 text-white hover:bg-zinc-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {/* Right arrow (desktop only) */}
      {hasOverflow && canRight && (
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollByPage(1)}
          className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 z-10 h-9 w-9 items-center justify-center rounded-full bg-zinc-900/80 border border-white/10 text-white hover:bg-zinc-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      <div
        ref={scrollRef}
        className="overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0 scrollbar-hide"
      >
        <div className="grid grid-rows-2 grid-flow-col gap-3 auto-cols-[calc(50%-0.375rem)] md:auto-cols-[calc(33.333%-0.5rem)]">
          {items.map((it) => {
            const placeholderSvg = it.isCollective ? (
              <svg className="w-6 h-6 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            );
            const inner = (
              <div className="flex items-start gap-3 bg-zinc-900/50 border border-white/10 rounded-lg p-3 hover:bg-zinc-800/50 transition-colors h-20 md:h-24 overflow-hidden">
                <div className="w-14 h-14 bg-zinc-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {it.photoUrl ? (
                    <Image
                      src={it.photoUrl}
                      alt={it.name}
                      width={56}
                      height={56}
                      className="w-full h-full object-cover"
                      unoptimized
                    />
                  ) : placeholderSvg}
                </div>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <p className="text-white font-medium text-sm truncate">{it.name}</p>
                  {it.badge && (
                    <p className="text-zinc-500 text-[10px] uppercase tracking-wider mt-1">{it.badge}</p>
                  )}
                  {it.bio && (
                    <p className="hidden md:block text-zinc-400 text-xs mt-1 line-clamp-2 overflow-hidden">{it.bio}</p>
                  )}
                </div>
              </div>
            );
            return it.href ? (
              <Link key={it.key} href={it.href} className="block">{inner}</Link>
            ) : (
              <div key={it.key}>{inner}</div>
            );
          })}
        </div>
      </div>

      {/* Pagination dots */}
      {hasOverflow && pageCount > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {Array.from({ length: pageCount }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Scroll to page ${i + 1}`}
              onClick={() => {
                const el = scrollRef.current;
                if (!el) return;
                el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
              }}
              className={`h-1.5 rounded-full transition-all ${
                i === activePage ? "w-6 bg-white" : "w-1.5 bg-zinc-700 hover:bg-zinc-600"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
