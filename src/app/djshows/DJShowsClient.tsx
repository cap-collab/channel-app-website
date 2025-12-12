"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { SearchBar } from "@/components/SearchBar";
import { CalendarGrid } from "@/components/calendar/CalendarGrid";
import { Header } from "@/components/Header";
import { BPMProvider } from "@/contexts/BPMContext";

export function DJShowsClient() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchBarSticky, setIsSearchBarSticky] = useState(true);

  // Track scroll position to make search bar non-sticky after scrolling past current time
  // BUT always keep it sticky when there's an active search
  useEffect(() => {
    const handleScroll = () => {
      // Always keep sticky when search is active
      if (searchQuery.trim()) {
        setIsSearchBarSticky(true);
        return;
      }

      const todayGrid = document.querySelector('[data-time-grid="today"]');
      if (!todayGrid) return;

      const now = new Date();
      const PIXELS_PER_HOUR = 80;
      const timePosition = (now.getHours() + now.getMinutes() / 60) * PIXELS_PER_HOUR;

      const gridTop = todayGrid.getBoundingClientRect().top;
      // Current time position relative to viewport
      const currentTimeViewportPosition = gridTop + timePosition;

      // Search bar height + header height = ~52 + ~60 = 112px
      // If current time line is above the sticky area, make search bar non-sticky
      const stickyThreshold = 120;
      setIsSearchBarSticky(currentTimeViewportPosition > stickyThreshold);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Check on mount

    return () => window.removeEventListener('scroll', handleScroll);
  }, [searchQuery]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  return (
    <BPMProvider>
    <div className="min-h-screen bg-black">
      {/* Header */}
      <Header currentPage="djshows" position="sticky" />

      {/* Search bar section - sticky until scrolled past current time */}
      <div className={`${isSearchBarSticky ? 'sticky top-[52px] z-[45]' : ''} px-4 py-3 bg-black border-b border-gray-900`}>
        <SearchBar
          onSearch={handleSearch}
          placeholder="Search shows or DJs..."
        />
      </div>

      {/* Calendar Grid */}
      <main>
        <CalendarGrid searchQuery={searchQuery} onClearSearch={handleClearSearch} isSearchBarSticky={isSearchBarSticky} />
      </main>

      {/* Get Involved Section */}
      <section id="get-involved" className="py-16 px-6 bg-[#1a1a1a]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-8 text-center">
            Get Involved
          </h2>

          <div className="space-y-6 text-gray-400 leading-relaxed">
            <p>
              My name is Cap. I&apos;m building Channel out of love for DJ radio and the communities that make it so special.
            </p>

            <p>
              After moving from Paris to New York to Los Angeles, I realized how hard it was to stay connected with my favorite DJs, dancers, and curators beyond the dancefloor. This ecosystem deserves better tools: to support artists, strengthen communities, and make it easier to follow the sounds and the people you love.
            </p>

            <p>
              I&apos;m looking to connect with <span className="text-white">DJs, radio operators, nightlife promoters, dancers, and music heads</span> of all kinds. Whether you want to collaborate, give feedback, or just chat, I&apos;d truly love to hear from you.
            </p>

            <p>
              Channel is growing, and I&apos;m actively seeking help with:
            </p>

            <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
              <li>DJ show curation (ambient, dub, electronic, techno, minimal, house, ...)</li>
              <li>Product & website design</li>
              <li>Fan & community monetization</li>
              <li>DJ relationship and insights</li>
              <li>DJ radio relationship and insights</li>
              <li>Partnerships & licensing</li>
              <li>Fundraising</li>
            </ul>

            <p>
              If any of this resonates, reach out. I&apos;d love to connect.
            </p>
          </div>

          <div className="mt-10 text-center">
            <a
              href="mailto:info@channel-app.com"
              className="inline-block bg-white text-black px-10 py-4 rounded-xl text-lg font-semibold hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(255,255,255,0.15)] transition-all"
            >
              Contact Us
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-6 bg-black">
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-sm text-gray-600 space-y-3">
            <p>
              <Link href="/privacy" className="text-gray-500 hover:text-white transition-colors">
                Privacy Policy
              </Link>
              <span className="text-gray-700 mx-3">·</span>
              <Link href="/terms" className="text-gray-500 hover:text-white transition-colors">
                Terms & Conditions
              </Link>
              <span className="text-gray-700 mx-3">·</span>
              <Link href="/guidelines" className="text-gray-500 hover:text-white transition-colors">
                Community Guidelines
              </Link>
            </p>
            <p>&copy; 2025 Channel Media, Inc. All rights reserved.</p>
          </div>
        </div>
      </footer>

    </div>
    </BPMProvider>
  );
}
