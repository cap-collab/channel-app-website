"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { STATIONS } from "@/lib/stations";
import { getCurrentShows } from "@/lib/metadata";
import { Show } from "@/types";

interface BrowsingModePopupProps {
  onClose: () => void;
}

// Confetti particle type
interface ConfettiParticle {
  id: number;
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  size: number;
}

// Station logo mapping
function getLogoUrl(stationId: string): string {
  switch (stationId) {
    case "subtle":
      return "/stations/subtle-logo.png";
    case "dublab":
      return "/stations/dublab-logo.png";
    case "rinse-fm":
      return "/stations/rinsefm-logo.png";
    case "rinse-fr":
      return "/stations/rinsefr-logo.png";
    case "nts-1":
    case "nts-2":
      return "/stations/nts-logo.png";
    default:
      return "/stations/subtle-logo.png";
  }
}

export function BrowsingModePopup({ onClose }: BrowsingModePopupProps) {
  // State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [, setIsLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [currentShows, setCurrentShows] = useState<Show[]>([]);
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [logoScale, setLogoScale] = useState(1);
  const [cardScale, setCardScale] = useState(0.8);
  const [cardOpacity, setCardOpacity] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [confettiParticles, setConfettiParticles] = useState<ConfettiParticle[]>([]);

  // Refs
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownDuration = 3;
  const timerInterval = 50; // ms

  // Current station based on index
  const currentStation = STATIONS[currentIndex];

  // Current show for the station
  const currentShow = currentShows.find(
    (show) => show.stationId === currentStation?.id
  );

  // Preload all station streams
  const preloadStreams = useCallback(async () => {
    const totalStations = STATIONS.length;
    let loadedCount = 0;

    const loadPromises = STATIONS.map((station) => {
      return new Promise<void>((resolve) => {
        const audio = new Audio();
        audio.preload = "auto";
        audio.crossOrigin = "anonymous";
        audio.volume = 1;

        const handleCanPlay = () => {
          loadedCount++;
          setLoadProgress(loadedCount / totalStations);
          audioRefs.current.set(station.id, audio);
          resolve();
        };

        const handleError = () => {
          // Still count as loaded even if it fails
          loadedCount++;
          setLoadProgress(loadedCount / totalStations);
          resolve();
        };

        audio.addEventListener("canplay", handleCanPlay, { once: true });
        audio.addEventListener("error", handleError, { once: true });

        // Set timeout to not wait forever
        setTimeout(() => {
          if (!audioRefs.current.has(station.id)) {
            loadedCount++;
            setLoadProgress(loadedCount / totalStations);
            audioRefs.current.set(station.id, audio);
            resolve();
          }
        }, 5000);

        audio.src = station.streamUrl;
        audio.load();
      });
    });

    await Promise.all(loadPromises);
    return true;
  }, []);

  // Play a specific station
  const playStation = useCallback((stationId: string) => {
    // Pause all other stations
    audioRefs.current.forEach((audio, id) => {
      if (id !== stationId) {
        audio.pause();
      }
    });

    // Play the selected station
    const audio = audioRefs.current.get(stationId);
    if (audio) {
      audio.play().catch((err) => {
        console.error("Failed to play station:", err);
      });
    }
  }, []);

  // Pause all stations (used by cleanup)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const pauseAll = useCallback(() => {
    audioRefs.current.forEach((audio) => {
      audio.pause();
    });
  }, []);

  // Cleanup all audio elements
  const cleanup = useCallback(() => {
    audioRefs.current.forEach((audio) => {
      audio.pause();
      audio.src = "";
    });
    audioRefs.current.clear();
  }, []);

  // Logo bounce animation
  const animateLogo = useCallback(() => {
    setLogoScale(1.15);
    setTimeout(() => {
      setLogoScale(1);
    }, 150);
  }, []);

  // Advance to next station
  const advanceToNextStation = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % STATIONS.length);
    setCountdown(countdownDuration);
    animateLogo();

    // Play new station
    const nextIndex = (currentIndex + 1) % STATIONS.length;
    playStation(STATIONS[nextIndex].id);
  }, [currentIndex, animateLogo, playStation]);

  // Skip to next station
  const skipToNext = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    advanceToNextStation();
    // Restart timer
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= timerInterval / 1000) {
          advanceToNextStation();
          return countdownDuration;
        }
        return prev - timerInterval / 1000;
      });
    }, timerInterval);
  }, [advanceToNextStation]);

  // Skip to previous station
  const skipToPrevious = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    const prevIndex = (currentIndex - 1 + STATIONS.length) % STATIONS.length;
    setCurrentIndex(prevIndex);
    setCountdown(countdownDuration);
    animateLogo();
    playStation(STATIONS[prevIndex].id);

    // Restart timer
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= timerInterval / 1000) {
          advanceToNextStation();
          return countdownDuration;
        }
        return prev - timerInterval / 1000;
      });
    }, timerInterval);
  }, [currentIndex, animateLogo, playStation, advanceToNextStation]);

  // Spawn confetti
  const spawnConfetti = useCallback(() => {
    const colors = ["#FFEB3B", "#E91E63", "#00BCD4", "#FF9800", "#4CAF50", "#9C27B0"];
    const particles: ConfettiParticle[] = [];

    for (let i = 0; i < 20; i++) {
      particles.push({
        id: i,
        color: colors[Math.floor(Math.random() * colors.length)],
        x: Math.random() * 300 - 150,
        y: 0,
        vx: Math.random() * 200 - 100,
        vy: -(Math.random() * 200 + 200),
        rotation: Math.random() * 360,
        size: Math.random() * 6 + 8,
      });
    }

    setConfettiParticles(particles);
    setShowConfetti(true);

    // Remove confetti after animation
    setTimeout(() => {
      setShowConfetti(false);
      setConfettiParticles([]);
    }, 1600);
  }, []);

  // Pick this station
  const pickThis = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    // Spawn confetti
    spawnConfetti();

    // Open station in new tab after a brief delay
    setTimeout(() => {
      const station = STATIONS[currentIndex];
      window.open(station.websiteUrl, "_blank");
    }, 800);

    // Close popup after confetti
    setTimeout(() => {
      setCardScale(0.9);
      setCardOpacity(0);
      setTimeout(() => {
        cleanup();
        onClose();
      }, 200);
    }, 1000);
  }, [currentIndex, onClose, cleanup, spawnConfetti]);

  // Dismiss and close
  const dismissAndClose = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setCardScale(0.9);
    setCardOpacity(0);
    setTimeout(() => {
      cleanup();
      onClose();
    }, 200);
  }, [onClose, cleanup]);

  // Initialize
  useEffect(() => {
    // Entry animation
    requestAnimationFrame(() => {
      setCardScale(1);
      setCardOpacity(1);
    });

    // Load current shows
    getCurrentShows().then(setCurrentShows).catch(console.error);

    // Start preloading streams
    preloadStreams().then(() => {
      setIsLoading(false);
      // Wait a moment then start playing
      setTimeout(() => {
        setIsStreamReady(true);
        playStation(STATIONS[0].id);
        animateLogo();

        // Start countdown timer
        timerRef.current = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= timerInterval / 1000) {
              advanceToNextStation();
              return countdownDuration;
            }
            return prev - timerInterval / 1000;
          });
        }, timerInterval);
      }, 300);
    });

    // Cleanup on unmount
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle background click
  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && isStreamReady) {
      dismissAndClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={handleBackgroundClick}
    >
      {/* Blurred background */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Floating card */}
      <div
        className="relative w-[300px] rounded-3xl overflow-hidden transition-all duration-300 ease-out"
        style={{
          transform: `scale(${cardScale})`,
          opacity: cardOpacity,
          background: "rgb(26, 26, 26)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Gradient overlay for glass effect */}
        <div
          className="absolute inset-0 pointer-events-none rounded-3xl"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 50%, rgba(0,0,0,0.1) 100%)",
          }}
        />
        <div className="absolute inset-0 pointer-events-none rounded-3xl border border-white/10" />

        {/* Close button */}
        <div className="flex justify-end px-4 pt-4">
          <button
            onClick={dismissAndClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-white/60 hover:text-white hover:bg-white/20 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 pb-6">
          {!isStreamReady ? (
            // Loading state
            <div className="flex flex-col items-center py-12">
              <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin mb-4" />
              <p className="text-white/70 text-sm mb-4">Loading stations...</p>

              {/* Progress bar */}
              <div className="w-full px-8">
                <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/80 rounded-full transition-all duration-200"
                    style={{ width: `${loadProgress * 100}%` }}
                  />
                </div>
              </div>
              <p className="text-white/50 text-xs mt-2">
                {Math.round(loadProgress * STATIONS.length)}/{STATIONS.length}
              </p>
            </div>
          ) : (
            // Main browsing UI
            <>
              {/* Station logo */}
              <div className="flex justify-center mt-2 mb-5">
                <div
                  className="w-[100px] h-[100px] rounded-2xl overflow-hidden transition-transform duration-150"
                  style={{ transform: `scale(${logoScale})` }}
                >
                  <Image
                    src={getLogoUrl(currentStation.id)}
                    alt={currentStation.name}
                    width={100}
                    height={100}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>

              {/* Station info */}
              <div className="text-center mb-6">
                <h2 className="text-xl font-bold text-white">{currentStation.name}</h2>
                {currentShow ? (
                  <>
                    <p className="text-white/80 text-sm mt-1">{currentShow.name}</p>
                    {currentShow.dj && (
                      <p className="text-white/50 text-xs mt-0.5">{currentShow.dj}</p>
                    )}
                  </>
                ) : (
                  <p className="text-white/50 text-sm mt-1">Live</p>
                )}
              </div>

              {/* Countdown bar */}
              <div className="px-6 mb-8">
                <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/80 rounded-full transition-all"
                    style={{
                      width: `${((countdownDuration - countdown) / countdownDuration) * 100}%`,
                      transition: "width 50ms linear",
                    }}
                  />
                </div>
              </div>

              {/* PICK THIS button */}
              <button
                onClick={pickThis}
                className="w-full py-3.5 bg-white text-black font-semibold rounded-xl hover:bg-gray-100 transition-colors mb-3"
              >
                PICK THIS
              </button>

              {/* PREV and NEXT buttons */}
              <div className="flex gap-3">
                <button
                  onClick={skipToPrevious}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/15 text-white border border-white/30 hover:bg-white/25 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  <span className="text-sm font-medium">PREV</span>
                </button>
                <button
                  onClick={skipToNext}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/15 text-white border border-white/30 hover:bg-white/25 transition-colors"
                >
                  <span className="text-sm font-medium">NEXT</span>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              {/* Station dots */}
              <div className="flex justify-center gap-2 mt-6">
                {STATIONS.map((_, index) => (
                  <div
                    key={index}
                    className={`w-2 h-2 rounded-full transition-all duration-200 ${
                      index === currentIndex
                        ? "bg-white scale-125"
                        : "bg-white/30"
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Confetti overlay */}
        {showConfetti && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {confettiParticles.map((particle) => (
              <div
                key={particle.id}
                className="absolute left-1/2 top-1/2 animate-confetti"
                style={{
                  width: particle.size,
                  height: particle.size * 0.6,
                  backgroundColor: particle.color,
                  borderRadius: 2,
                  transform: `translate(${particle.x}px, ${particle.y}px) rotate(${particle.rotation}deg)`,
                  "--vx": `${particle.vx}px`,
                  "--vy": `${particle.vy}px`,
                } as React.CSSProperties}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
