"use client";

import { useState, useEffect, useCallback } from "react";
import {
  collection,
  query,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  where,
  getDocs,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { Show } from "@/types";
// Helper to fetch enriched shows from API (includes DJ profile data)
async function fetchEnrichedShows(): Promise<Show[]> {
  try {
    const response = await fetch('/api/schedule');
    const data = await response.json();
    return data.shows || [];
  } catch (error) {
    console.error("[fetchEnrichedShows] Error:", error);
    return [];
  }
}

export interface Favorite {
  id: string;
  term: string;
  type: "show" | "dj" | "search";
  showName?: string;
  djName?: string;
  stationId?: string;
  showType?: string; // "regular", "weekly", "biweekly", "monthly", "restream", "playlist"
  createdAt: Date;
  createdBy: "web" | "ios";
}

// Helper to check if a favorite is for a recurring show
export function isRecurringFavorite(favorite: Favorite): boolean {
  const showType = favorite.showType?.toLowerCase();
  return showType === "regular" || showType === "weekly" || showType === "biweekly" || showType === "monthly";
}

// Contains matching for DJ/show names (bidirectional - either contains the other)
function containsMatch(text: string, term: string): boolean {
  const textLower = text.toLowerCase();
  const termLower = term.toLowerCase();
  return textLower.includes(termLower) || termLower.includes(textLower);
}

export function useFavorites() {
  const { user } = useAuthContext();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);

  // Subscribe to favorites when user is logged in
  useEffect(() => {
    if (!user || !db) {
      setFavorites([]);
      setLoading(false);
      return;
    }

    // Store non-null reference for use in callback
    const firestore = db;
    const userId = user.uid;

    const favoritesRef = collection(firestore, "users", userId, "favorites");
    const unsubscribe = onSnapshot(
      favoritesRef,
      async (snapshot) => {
        const favs: Favorite[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate() || new Date(),
        })) as Favorite[];

        // Deduplicate: find and remove duplicate entries in Firebase
        const seen = new Map<string, Favorite>();
        const duplicateIds: string[] = [];

        for (const fav of favs) {
          const key = `${fav.term.toLowerCase()}-${fav.stationId || ""}`;
          if (seen.has(key)) {
            // Keep the older one (by createdAt), delete the newer one
            const existing = seen.get(key)!;
            if (fav.createdAt > existing.createdAt) {
              duplicateIds.push(fav.id);
            } else {
              duplicateIds.push(existing.id);
              seen.set(key, fav);
            }
          } else {
            seen.set(key, fav);
          }
        }

        // Delete duplicates from Firebase (async, don't block)
        if (duplicateIds.length > 0) {
          console.log(`Removing ${duplicateIds.length} duplicate favorites`);
          for (const id of duplicateIds) {
            deleteDoc(doc(firestore, "users", userId, "favorites", id)).catch(console.error);
          }
        }

        // Set deduplicated favorites
        const dedupedFavs = favs.filter((f) => !duplicateIds.includes(f.id));
        setFavorites(dedupedFavs);
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching favorites:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Check if a show is favorited (exact match on show name + same station)
  const isShowFavorited = useCallback(
    (show: Show): boolean => {
      return favorites.some(
        (fav) =>
          // Only match station-scoped favorites (not watchlist)
          fav.stationId &&
          // Exact match on show name only
          fav.term.toLowerCase() === show.name.toLowerCase() &&
          // Same station
          fav.stationId === show.stationId
      );
    },
    [favorites]
  );

  // Add a show to favorites
  const addFavorite = useCallback(
    async (show: Show): Promise<boolean> => {
      if (!user || !db) return false;

      try {
        const favoritesRef = collection(db, "users", user.uid, "favorites");

        // Check if already exists
        const q = query(
          favoritesRef,
          where("term", "==", show.name.toLowerCase())
        );
        const existing = await getDocs(q);
        if (!existing.empty) return true;

        await addDoc(favoritesRef, {
          term: show.name.toLowerCase(),
          type: "show",
          showName: show.name,
          djName: show.dj || null,
          stationId: show.stationId,
          createdAt: serverTimestamp(),
          createdBy: "web",
        });

        return true;
      } catch (error) {
        console.error("Error adding favorite:", error);
        return false;
      }
    },
    [user]
  );

  // Remove a show from favorites
  const removeFavorite = useCallback(
    async (show: Show): Promise<boolean> => {
      if (!user || !db) return false;

      try {
        const favoritesRef = collection(db, "users", user.uid, "favorites");
        const q = query(
          favoritesRef,
          where("term", "==", show.name.toLowerCase())
        );
        const snapshot = await getDocs(q);

        for (const d of snapshot.docs) {
          await deleteDoc(doc(db, "users", user.uid, "favorites", d.id));
        }

        return true;
      } catch (error) {
        console.error("Error removing favorite:", error);
        return false;
      }
    },
    [user]
  );

  // Toggle favorite status
  const toggleFavorite = useCallback(
    async (show: Show): Promise<boolean> => {
      if (isShowFavorited(show)) {
        return removeFavorite(show);
      } else {
        return addFavorite(show);
      }
    },
    [isShowFavorited, addFavorite, removeFavorite]
  );

  // Add a search term to watchlist and auto-add matching shows to favorites
  // Optional djUserId/djEmail for more reliable matching of broadcast shows
  // If not provided, will try to look up a DJ by normalized username matching the term
  const addToWatchlist = useCallback(
    async (term: string, djUserId?: string, djEmail?: string): Promise<boolean> => {
      if (!user || !db) return false;

      try {
        const favoritesRef = collection(db, "users", user.uid, "favorites");

        // Check if already exists
        const q = query(
          favoritesRef,
          where("term", "==", term.toLowerCase()),
          where("type", "==", "search")
        );
        const existing = await getDocs(q);
        if (!existing.empty) return true;

        // Add the watchlist term
        await addDoc(favoritesRef, {
          term: term.toLowerCase(),
          type: "search",
          showName: null,
          djName: null,
          stationId: null,
          createdAt: serverTimestamp(),
          createdBy: "web",
        });

        // If no djUserId/djEmail provided, try to find a DJ by normalized username
        let resolvedDjUserId = djUserId;
        let resolvedDjEmail = djEmail;
        if (!djUserId && !djEmail) {
          // Normalize the search term the same way as chatUsernameNormalized
          const normalizedTerm = term.replace(/[\s-]+/g, "").toLowerCase();
          const usersRef = collection(db, "users");
          const djQuery = query(
            usersRef,
            where("chatUsernameNormalized", "==", normalizedTerm)
          );
          const djSnapshot = await getDocs(djQuery);
          if (!djSnapshot.empty) {
            const djDoc = djSnapshot.docs[0];
            resolvedDjUserId = djDoc.id;
            resolvedDjEmail = djDoc.data().email as string | undefined;
            console.log(`[addToWatchlist] Found DJ by username "${term}": userId=${resolvedDjUserId}, email=${resolvedDjEmail}`);
          }
        }

        // Also find and add matching shows to favorites
        console.log(`[addToWatchlist] Searching for shows matching "${term}"${resolvedDjUserId ? `, userId: ${resolvedDjUserId}` : ""}${resolvedDjEmail ? `, email: ${resolvedDjEmail}` : ""}`);
        const allShows = await fetchEnrichedShows();

        // Find shows where DJ name matches the term (word boundary match)
        // Also check show name for dublab format "DJ Name - Show Name"
        const matchingShows = allShows.filter((show) => {
          // Match enriched DJ name
          if (show.dj && containsMatch(show.dj, term)) return true;
          // Also match dublab format "DJ Name - Show Name" in show name
          if (show.name.includes(' - ')) {
            const djPart = show.name.split(' - ')[0].trim();
            if (containsMatch(djPart, term)) return true;
          }
          return false;
        });
        console.log(`[addToWatchlist] Found ${matchingShows.length} shows matching DJ "${term}"`);

        // Also find shows where show name matches
        const nameMatches = allShows.filter((show) => {
          return containsMatch(show.name, term);
        });
        console.log(`[addToWatchlist] Found ${nameMatches.length} shows matching show name "${term}"`);

        // If djUserId or djEmail available (passed or resolved), also match broadcast-slots by userId/email
        const broadcastMatches: Show[] = [];
        if (resolvedDjUserId || resolvedDjEmail) {
          const now = new Date();
          const slotsRef = collection(db, "broadcast-slots");
          const slotsQuery = query(
            slotsRef,
            where("endTime", ">", Timestamp.fromDate(now)),
            orderBy("endTime", "asc")
          );

          const snapshot = await getDocs(slotsQuery);
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const status = data.status as string;
            if (status === "cancelled") return;

            // Check if this slot belongs to the DJ by userId or email
            const slotDjUserId = data.djUserId as string | undefined;
            const slotDjEmail = data.djEmail as string | undefined;
            const slotLiveDjUserId = data.liveDjUserId as string | undefined;

            const matchesUserId = resolvedDjUserId && (slotDjUserId === resolvedDjUserId || slotLiveDjUserId === resolvedDjUserId);
            const matchesEmail = resolvedDjEmail && slotDjEmail?.toLowerCase() === resolvedDjEmail.toLowerCase();

            // Also check djSlots for venue broadcasts
            const djSlots = data.djSlots as Array<{
              djUserId?: string;
              djEmail?: string;
              liveDjUserId?: string;
              djName?: string;
              startTime: number;
              endTime: number;
              // B3B support: multiple DJ profiles per slot
              djProfiles?: Array<{
                userId?: string;
                email?: string;
              }>;
            }> | undefined;

            let matchInSlots = false;
            if (djSlots && djSlots.length > 0) {
              matchInSlots = djSlots.some((slot) => {
                // Check legacy single-DJ fields
                const slotMatchUserId = resolvedDjUserId && (slot.djUserId === resolvedDjUserId || slot.liveDjUserId === resolvedDjUserId);
                const slotMatchEmail = resolvedDjEmail && slot.djEmail?.toLowerCase() === resolvedDjEmail.toLowerCase();

                if (slotMatchUserId || slotMatchEmail) return true;

                // Check djProfiles array for B3B support
                if (slot.djProfiles && slot.djProfiles.length > 0) {
                  return slot.djProfiles.some(profile => {
                    const profileMatchUserId = resolvedDjUserId && profile.userId === resolvedDjUserId;
                    const profileMatchEmail = resolvedDjEmail && profile.email?.toLowerCase() === resolvedDjEmail.toLowerCase();
                    return profileMatchUserId || profileMatchEmail;
                  });
                }

                return false;
              });
            }

            if (matchesUserId || matchesEmail || matchInSlots) {
              const startTime = (data.startTime as Timestamp).toDate().toISOString();
              const endTime = (data.endTime as Timestamp).toDate().toISOString();
              console.log(`[addToWatchlist] Found broadcast match by userId/email: ${data.showName}`);
              broadcastMatches.push({
                id: `broadcast-${docSnap.id}`,
                name: data.showName as string,
                dj: data.djName as string | undefined,
                startTime,
                endTime,
                stationId: "broadcast",
              });
            }
          });
          console.log(`[addToWatchlist] Found ${broadcastMatches.length} broadcast slots matching userId/email`);
        }

        // Combine and dedupe all matches
        const allMatches = [...matchingShows, ...nameMatches, ...broadcastMatches];
        const seen = new Set<string>();
        const uniqueShows = allMatches.filter((show) => {
          const key = `${show.name.toLowerCase()}-${show.stationId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Add each matching show to favorites
        let addedCount = 0;
        for (const show of uniqueShows) {
          // Check if already favorited
          const existingFav = query(
            favoritesRef,
            where("term", "==", show.name.toLowerCase()),
            where("stationId", "==", show.stationId)
          );
          const favExists = await getDocs(existingFav);
          if (favExists.empty) {
            console.log(`[addToWatchlist] Auto-adding show to favorites: ${show.name} (${show.stationId})`);
            await addDoc(favoritesRef, {
              term: show.name.toLowerCase(),
              type: "show",
              showName: show.name,
              djName: show.dj || null,
              stationId: show.stationId,
              createdAt: serverTimestamp(),
              createdBy: "web",
            });
            addedCount++;
          }
        }
        console.log(`[addToWatchlist] Auto-added ${addedCount} shows to favorites`);

        return true;
      } catch (error) {
        console.error("Error adding to watchlist:", error);
        return false;
      }
    },
    [user]
  );

  // Remove a term from watchlist
  const removeFromWatchlist = useCallback(
    async (term: string): Promise<boolean> => {
      if (!user || !db) return false;

      try {
        const favoritesRef = collection(db, "users", user.uid, "favorites");
        const q = query(
          favoritesRef,
          where("term", "==", term.toLowerCase())
        );
        const snapshot = await getDocs(q);

        for (const d of snapshot.docs) {
          await deleteDoc(doc(db, "users", user.uid, "favorites", d.id));
        }

        return true;
      } catch (error) {
        console.error("Error removing from watchlist:", error);
        return false;
      }
    },
    [user]
  );

  // Check if a term is in watchlist (must be type="search", not show favorites)
  const isInWatchlist = useCallback(
    (term: string): boolean => {
      return favorites.some(
        (fav) =>
          fav.type === "search" &&
          fav.term.toLowerCase() === term.toLowerCase()
      );
    },
    [favorites]
  );

  // Follow a DJ - adds to watchlist and optionally adds specific show to favorites
  // This is the unified function that all components should use for consistency
  const followDJ = useCallback(
    async (
      djName: string,
      djUserId?: string,
      djEmail?: string,
      currentShow?: Show
    ): Promise<boolean> => {
      // 1. Add DJ to watchlist (auto-adds matching shows)
      const success = await addToWatchlist(djName, djUserId, djEmail);

      // 2. Also add the specific show if provided
      // Always call addFavorite directly to ensure it's added (don't rely on state which may be stale)
      if (success && currentShow) {
        await addFavorite(currentShow);
      }

      return success;
    },
    [addToWatchlist, addFavorite]
  );

  // Add all shows for a DJ to favorites (called when subscribing to a DJ)
  // Matches by: DJ name in metadata, djUserId/djEmail in broadcast-slots
  const addDJShowsToFavorites = useCallback(
    async (djName: string, djUserId?: string, djEmail?: string): Promise<number> => {
      if (!user || !db) {
        console.log("[addDJShowsToFavorites] No user or db");
        return 0;
      }

      console.log(`[addDJShowsToFavorites] Starting for DJ: ${djName}, userId: ${djUserId}, email: ${djEmail}`);

      let addedCount = 0;
      const favoritesRef = collection(db, "users", user.uid, "favorites");

      // 1. Get all shows from API (includes enriched DJ profile data)
      let allShows: Show[] = [];
      try {
        allShows = await fetchEnrichedShows();
        console.log(`[addDJShowsToFavorites] Fetched ${allShows.length} total shows from API`);
      } catch (error) {
        console.error("[addDJShowsToFavorites] Error fetching shows from API:", error);
      }

      // Filter shows that match the DJ name
      // Also check show name for dublab format "DJ Name - Show Name"
      const matchingShowsByName = allShows.filter((show) => {
        // Match enriched DJ name
        if (show.dj && containsMatch(show.dj, djName)) return true;
        // Also match dublab format "DJ Name - Show Name" in show name
        if (show.name.includes(' - ')) {
          const djPart = show.name.split(' - ')[0].trim();
          if (containsMatch(djPart, djName)) return true;
        }
        return false;
      });
      console.log(`[addDJShowsToFavorites] Found ${matchingShowsByName.length} shows matching DJ name "${djName}"`);

      // 2. Get broadcast slots that match by djUserId or djEmail (more reliable than name match)
      const broadcastMatches: Show[] = [];
      if (djUserId || djEmail) {
        const now = new Date();
        const slotsRef = collection(db, "broadcast-slots");
        const q = query(
          slotsRef,
          where("endTime", ">", Timestamp.fromDate(now)),
          orderBy("endTime", "asc")
        );

        const snapshot = await getDocs(q);
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const status = data.status as string;
          if (status === "cancelled") return;

          // Check if this slot belongs to the DJ by userId or email
          const slotDjUserId = data.djUserId as string | undefined;
          const slotDjEmail = data.djEmail as string | undefined;
          const slotLiveDjUserId = data.liveDjUserId as string | undefined;

          const matchesUserId = djUserId && (slotDjUserId === djUserId || slotLiveDjUserId === djUserId);
          const matchesEmail = djEmail && slotDjEmail === djEmail;

          // Also check djSlots for venue broadcasts
          const djSlots = data.djSlots as Array<{
            djUserId?: string;
            djEmail?: string;
            liveDjUserId?: string;
            djName?: string;
            startTime: number;
            endTime: number;
          }> | undefined;

          let matchInSlots = false;
          if (djSlots && djSlots.length > 0) {
            matchInSlots = djSlots.some((slot) => {
              const slotMatchUserId = djUserId && (slot.djUserId === djUserId || slot.liveDjUserId === djUserId);
              const slotMatchEmail = djEmail && slot.djEmail === djEmail;
              return slotMatchUserId || slotMatchEmail;
            });
          }

          if (matchesUserId || matchesEmail || matchInSlots) {
            const startTime = (data.startTime as Timestamp).toDate().toISOString();
            const endTime = (data.endTime as Timestamp).toDate().toISOString();
            console.log(`[addDJShowsToFavorites] Found broadcast match: ${data.showName}`);
            broadcastMatches.push({
              id: `broadcast-${docSnap.id}`,
              name: data.showName as string,
              dj: data.djName as string | undefined,
              startTime,
              endTime,
              stationId: "broadcast",
            });
          }
        });
      }
      console.log(`[addDJShowsToFavorites] Found ${broadcastMatches.length} broadcast slots matching userId/email`);

      // Combine and deduplicate shows (by name + stationId)
      const allMatchingShows = [...matchingShowsByName, ...broadcastMatches];
      const seen = new Set<string>();
      const uniqueShows = allMatchingShows.filter((show) => {
        const key = `${show.name.toLowerCase()}-${show.stationId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      console.log(`[addDJShowsToFavorites] ${uniqueShows.length} unique shows to potentially add`);

      // Add each show to favorites if not already favorited
      for (const show of uniqueShows) {
        // Check if already favorited (same name + station)
        const isAlreadyFavorited = favorites.some(
          (fav) =>
            fav.stationId === show.stationId &&
            fav.term.toLowerCase() === show.name.toLowerCase()
        );

        if (!isAlreadyFavorited) {
          // Also check Firebase to avoid race conditions
          const q = query(
            favoritesRef,
            where("term", "==", show.name.toLowerCase()),
            where("stationId", "==", show.stationId)
          );
          const existing = await getDocs(q);
          if (existing.empty) {
            console.log(`[addDJShowsToFavorites] Adding show to favorites: ${show.name} (${show.stationId})`);
            await addDoc(favoritesRef, {
              term: show.name.toLowerCase(),
              type: "show",
              showName: show.name,
              djName: show.dj || null,
              stationId: show.stationId,
              createdAt: serverTimestamp(),
              createdBy: "web",
            });
            addedCount++;
          } else {
            console.log(`[addDJShowsToFavorites] Show already in Firebase: ${show.name}`);
          }
        } else {
          console.log(`[addDJShowsToFavorites] Show already in local favorites: ${show.name}`);
        }
      }

      console.log(`[addDJShowsToFavorites] Done! Added ${addedCount} shows to favorites`);
      return addedCount;
    },
    [user, favorites]
  );

  return {
    favorites,
    loading,
    isShowFavorited,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    addToWatchlist,
    removeFromWatchlist,
    isInWatchlist,
    followDJ,
    addDJShowsToFavorites,
  };
}
