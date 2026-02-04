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
import { Show, IRLShowData } from "@/types";
import { wordBoundaryMatch } from "@/lib/dj-matching";

// Helper to fetch enriched shows and IRL shows from API
async function fetchEnrichedShowsAndIRL(): Promise<{ shows: Show[]; irlShows: IRLShowData[] }> {
  try {
    const response = await fetch('/api/schedule');
    const data = await response.json();
    return { shows: data.shows || [], irlShows: data.irlShows || [] };
  } catch (error) {
    console.error("[fetchEnrichedShowsAndIRL] Error:", error);
    return { shows: [], irlShows: [] };
  }
}

// Helper to fetch enriched shows from API (includes DJ profile data)
async function fetchEnrichedShows(): Promise<Show[]> {
  const { shows } = await fetchEnrichedShowsAndIRL();
  return shows;
}

export interface Favorite {
  id: string;
  term: string;
  type: "show" | "dj" | "search" | "irl";
  showName?: string;
  djName?: string;
  stationId?: string;
  showType?: string; // "regular", "weekly", "biweekly", "monthly", "restream", "playlist"
  createdAt: Date;
  createdBy: "web" | "ios";
  // IRL event fields (type="irl")
  irlEventName?: string;
  irlLocation?: string;
  irlDate?: string; // ISO date string (YYYY-MM-DD)
  irlTicketUrl?: string;
  djUsername?: string;
  djPhotoUrl?: string;
}

// Helper to check if a favorite is for a recurring show
export function isRecurringFavorite(favorite: Favorite): boolean {
  const showType = favorite.showType?.toLowerCase();
  return showType === "regular" || showType === "weekly" || showType === "biweekly" || showType === "monthly";
}

// Word boundary matching for DJ/show names
// e.g. "PAC" matches "PAC" or "Night PAC" but NOT "pace" or "space"
function containsMatch(text: string, term: string): boolean {
  return wordBoundaryMatch(text, term);
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
      console.log(`[addFavorite] Called with show:`, { name: show.name, dj: show.dj, stationId: show.stationId });
      if (!user || !db) {
        console.log(`[addFavorite] No user or db, returning false`);
        return false;
      }

      try {
        const favoritesRef = collection(db, "users", user.uid, "favorites");

        // Check if already exists - query by term only, then filter by stationId in memory
        // (Firestore requires composite index for multiple where clauses on different fields)
        const q = query(
          favoritesRef,
          where("term", "==", show.name.toLowerCase())
        );
        const existing = await getDocs(q);
        const alreadyFavorited = existing.docs.some(
          (doc) => doc.data().stationId === show.stationId
        );
        if (alreadyFavorited) {
          console.log(`[addFavorite] Show already favorited, skipping`);
          return true;
        }

        // If show doesn't have DJ profile data, try to look it up
        let djUsername = show.djUsername || null;
        let djPhotoUrl = show.djPhotoUrl || null;

        if (show.dj && (!djUsername || !djPhotoUrl)) {
          const normalized = show.dj.replace(/[\s-]+/g, "").toLowerCase();
          console.log(`[addFavorite] Looking up DJ profile for "${show.dj}" (normalized: ${normalized})`);

          try {
            // Check pending-dj-profiles first (has public read access)
            const pendingRef = collection(db, "pending-dj-profiles");
            const pendingQ = query(
              pendingRef,
              where("chatUsernameNormalized", "==", normalized)
            );
            const pendingSnapshot = await getDocs(pendingQ);

            if (!pendingSnapshot.empty) {
              const data = pendingSnapshot.docs[0].data();
              djUsername = djUsername || data.chatUsername || null;
              djPhotoUrl = djPhotoUrl || data.djProfile?.photoUrl || null;
              console.log(`[addFavorite] Found DJ in pending-dj-profiles: ${djUsername}, photo: ${djPhotoUrl ? 'yes' : 'no'}`);
            } else {
              // Fall back to users collection
              const usersRef = collection(db, "users");
              const usersQ = query(
                usersRef,
                where("chatUsernameNormalized", "==", normalized),
                where("role", "in", ["dj", "broadcaster", "admin"])
              );
              const usersSnapshot = await getDocs(usersQ);

              if (!usersSnapshot.empty) {
                const data = usersSnapshot.docs[0].data();
                djUsername = djUsername || data.chatUsername || null;
                djPhotoUrl = djPhotoUrl || data.djProfile?.photoUrl || null;
                console.log(`[addFavorite] Found DJ in users: ${djUsername}, photo: ${djPhotoUrl ? 'yes' : 'no'}`);
              }
            }
          } catch (lookupError) {
            console.warn(`[addFavorite] Could not look up DJ profile:`, lookupError);
          }
        }

        await addDoc(favoritesRef, {
          term: show.name.toLowerCase(),
          type: "show",
          showName: show.name,
          djName: show.dj || null,
          djUsername,
          djPhotoUrl,
          stationId: show.stationId,
          createdAt: serverTimestamp(),
          createdBy: "web",
        });

        console.log(`[addFavorite] Added show "${show.name}" (${show.stationId}) to favorites with djUsername=${djUsername}, djPhotoUrl=${djPhotoUrl ? 'yes' : 'no'}`);
        return true;
      } catch (error) {
        console.error("[addFavorite] Error:", error);
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
        // Query by term only, then filter by stationId in memory
        // (Firestore requires composite index for multiple where clauses on different fields)
        const q = query(
          favoritesRef,
          where("term", "==", show.name.toLowerCase())
        );
        const snapshot = await getDocs(q);

        for (const d of snapshot.docs) {
          const docStationId = d.data().stationId;
          // Match stationId - treat null, undefined, and "" as equivalent (no station)
          const showStationId = show.stationId || null;
          const docStationIdNormalized = docStationId || null;
          if (docStationIdNormalized === showStationId) {
            await deleteDoc(doc(db, "users", user.uid, "favorites", d.id));
          }
        }

        console.log(`[removeFavorite] Removed show "${show.name}" (${show.stationId}) from favorites`);
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
      console.log(`[toggleFavorite] Called for show:`, { name: show.name, dj: show.dj, stationId: show.stationId });
      const isFavorited = isShowFavorited(show);
      console.log(`[toggleFavorite] isShowFavorited:`, isFavorited);
      if (isFavorited) {
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
      console.log(`[addToWatchlist] Called with term="${term}", djUserId=${djUserId}, djEmail=${djEmail}`);
      if (!user || !db) {
        console.log(`[addToWatchlist] No user or db, returning false`);
        return false;
      }

      try {
        const favoritesRef = collection(db, "users", user.uid, "favorites");

        // Check if already exists - query by term, filter by type in memory
        // (Firestore requires composite index for multiple where clauses on different fields)
        const q = query(
          favoritesRef,
          where("term", "==", term.toLowerCase())
        );
        const existing = await getDocs(q);
        const alreadyInWatchlist = existing.docs.some(
          (doc) => doc.data().type === "search"
        );
        if (alreadyInWatchlist) {
          console.log(`[addToWatchlist] DJ "${term}" already in watchlist, skipping`);
          return true;
        }

        // Look up DJ profile first to get djUsername and djPhotoUrl
        const normalizedSearchTerm = term.replace(/[\s-]+/g, "").toLowerCase();
        let djUsername: string | null = null;
        let djPhotoUrl: string | null = null;
        let resolvedDjUserId = djUserId;
        let resolvedDjEmail = djEmail;

        try {
          // Check pending-dj-profiles first (has public read access)
          const pendingRef = collection(db, "pending-dj-profiles");
          const pendingQ = query(
            pendingRef,
            where("chatUsernameNormalized", "==", normalizedSearchTerm)
          );
          const pendingSnapshot = await getDocs(pendingQ);

          if (!pendingSnapshot.empty) {
            const data = pendingSnapshot.docs[0].data();
            djUsername = data.chatUsername || null;
            djPhotoUrl = data.djProfile?.photoUrl || null;
            console.log(`[addToWatchlist] Found DJ in pending-dj-profiles: ${djUsername}, photo: ${djPhotoUrl ? 'yes' : 'no'}`);
          } else {
            // Fall back to users collection
            const usersRef = collection(db, "users");
            const usersQ = query(
              usersRef,
              where("chatUsernameNormalized", "==", normalizedSearchTerm),
              where("role", "in", ["dj", "broadcaster", "admin"])
            );
            const usersSnapshot = await getDocs(usersQ);

            if (!usersSnapshot.empty) {
              const data = usersSnapshot.docs[0].data();
              djUsername = data.chatUsername || null;
              djPhotoUrl = data.djProfile?.photoUrl || null;
              resolvedDjUserId = resolvedDjUserId || usersSnapshot.docs[0].id;
              resolvedDjEmail = resolvedDjEmail || (data.email as string | undefined);
              console.log(`[addToWatchlist] Found DJ in users: ${djUsername}, photo: ${djPhotoUrl ? 'yes' : 'no'}`);
            }
          }
        } catch (lookupError) {
          console.warn(`[addToWatchlist] Could not look up DJ profile:`, lookupError);
        }

        // Add the watchlist term with DJ profile data
        await addDoc(favoritesRef, {
          term: term.toLowerCase(),
          type: "search",
          showName: null,
          djName: djUsername || term,
          djUsername,
          djPhotoUrl,
          stationId: null,
          createdAt: serverTimestamp(),
          createdBy: "web",
        });
        console.log(`[addToWatchlist] Added "${term}" to watchlist with djUsername=${djUsername}, djPhotoUrl=${djPhotoUrl ? 'yes' : 'no'}`);

        // Also find and add matching shows and IRL events to favorites
        console.log(`[addToWatchlist] Searching for shows matching "${term}"${resolvedDjUserId ? `, userId: ${resolvedDjUserId}` : ""}${resolvedDjEmail ? `, email: ${resolvedDjEmail}` : ""}`);
        const { shows: allShows, irlShows: allIRLShows } = await fetchEnrichedShowsAndIRL();

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
          // Also match NTS format "HOST w/ GUEST" in show name
          const wMatch = show.name.match(/^(.+?)\s+w\/\s+/i);
          if (wMatch) {
            const hostPart = wMatch[1].trim();
            if (hostPart.split(/\s+/).length <= 2 && containsMatch(hostPart, term)) return true;
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
          // Check if already favorited - query by term, filter by stationId in memory
          const existingFav = query(
            favoritesRef,
            where("term", "==", show.name.toLowerCase())
          );
          const favDocs = await getDocs(existingFav);
          const alreadyFavorited = favDocs.docs.some(
            (doc) => doc.data().stationId === show.stationId
          );
          if (!alreadyFavorited) {
            // If show doesn't have DJ profile data, try to look it up
            let djUsername = show.djUsername || null;
            let djPhotoUrl = show.djPhotoUrl || null;

            if (show.dj && (!djUsername || !djPhotoUrl)) {
              const djNormalized = show.dj.replace(/[\s-]+/g, "").toLowerCase();
              try {
                // Check pending-dj-profiles first
                const pendingRef = collection(db, "pending-dj-profiles");
                const pendingQ = query(
                  pendingRef,
                  where("chatUsernameNormalized", "==", djNormalized)
                );
                const pendingSnapshot = await getDocs(pendingQ);

                if (!pendingSnapshot.empty) {
                  const data = pendingSnapshot.docs[0].data();
                  djUsername = djUsername || data.chatUsername || null;
                  djPhotoUrl = djPhotoUrl || data.djProfile?.photoUrl || null;
                } else {
                  // Fall back to users collection
                  const usersRef = collection(db, "users");
                  const usersQ = query(
                    usersRef,
                    where("chatUsernameNormalized", "==", djNormalized),
                    where("role", "in", ["dj", "broadcaster", "admin"])
                  );
                  const usersSnapshot = await getDocs(usersQ);

                  if (!usersSnapshot.empty) {
                    const data = usersSnapshot.docs[0].data();
                    djUsername = djUsername || data.chatUsername || null;
                    djPhotoUrl = djPhotoUrl || data.djProfile?.photoUrl || null;
                  }
                }
              } catch (lookupError) {
                console.warn(`[addToWatchlist] Could not look up DJ profile for ${show.dj}:`, lookupError);
              }
            }

            console.log(`[addToWatchlist] Auto-adding show to favorites: ${show.name} (${show.stationId}) with djUsername=${djUsername}`);
            await addDoc(favoritesRef, {
              term: show.name.toLowerCase(),
              type: "show",
              showName: show.name,
              djName: show.dj || null,
              djUsername,
              djPhotoUrl,
              stationId: show.stationId,
              createdAt: serverTimestamp(),
              createdBy: "web",
            });
            addedCount++;
          }
        }
        console.log(`[addToWatchlist] Auto-added ${addedCount} shows to favorites`);

        // Also find and add matching IRL events to favorites
        // Match by DJ name or djUsername
        const normalizedTerm = term.replace(/[\s-]+/g, "").toLowerCase();
        const matchingIRLShows = allIRLShows.filter((irlShow) => {
          // Match by djName (contains match)
          if (irlShow.djName && containsMatch(irlShow.djName, term)) return true;
          // Match by djUsername (normalized exact match)
          if (irlShow.djUsername && irlShow.djUsername.toLowerCase() === normalizedTerm) return true;
          return false;
        });
        console.log(`[addToWatchlist] Found ${matchingIRLShows.length} IRL events matching DJ "${term}"`);

        // Add each matching IRL event to favorites
        let addedIRLCount = 0;
        for (const irlShow of matchingIRLShows) {
          // Create unique key for IRL event: djUsername + date + location
          const irlKey = `irl-${irlShow.djUsername}-${irlShow.date}-${irlShow.location}`.toLowerCase();

          // Check if already favorited
          const existingIRLFav = query(
            favoritesRef,
            where("term", "==", irlKey)
          );
          const irlFavDocs = await getDocs(existingIRLFav);
          const alreadyFavoritedIRL = irlFavDocs.docs.some(
            (doc) => doc.data().type === "irl"
          );

          if (!alreadyFavoritedIRL) {
            console.log(`[addToWatchlist] Auto-adding IRL event to favorites: ${irlShow.eventName} (${irlShow.location})`);
            await addDoc(favoritesRef, {
              term: irlKey,
              type: "irl",
              showName: irlShow.eventName,
              djName: irlShow.djName,
              stationId: null,
              irlEventName: irlShow.eventName,
              irlLocation: irlShow.location,
              irlDate: irlShow.date,
              irlTicketUrl: irlShow.ticketUrl,
              djUsername: irlShow.djUsername,
              djPhotoUrl: irlShow.djPhotoUrl || null,
              createdAt: serverTimestamp(),
              createdBy: "web",
            });
            addedIRLCount++;
          }
        }
        console.log(`[addToWatchlist] Auto-added ${addedIRLCount} IRL events to favorites`);

        return true;
      } catch (error) {
        console.error("Error adding to watchlist:", error);
        return false;
      }
    },
    [user]
  );

  // Remove a term from watchlist (only removes type="search", preserves show favorites)
  // Also removes associated IRL events for the DJ
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
          // Only delete watchlist entries (type="search"), not show favorites
          if (d.data().type === "search") {
            await deleteDoc(doc(db, "users", user.uid, "favorites", d.id));
          }
        }

        // Also remove IRL events for this DJ
        // IRL events are stored with djName field matching the DJ name
        const irlQuery = query(
          favoritesRef,
          where("type", "==", "irl")
        );
        const irlSnapshot = await getDocs(irlQuery);

        for (const d of irlSnapshot.docs) {
          const data = d.data();
          // Match by djName or djUsername (word boundary match)
          const matches = (data.djName && wordBoundaryMatch(data.djName, term)) ||
            (data.djUsername && wordBoundaryMatch(data.djUsername, term));

          if (matches) {
            await deleteDoc(doc(db, "users", user.uid, "favorites", d.id));
            console.log(`[removeFromWatchlist] Removed IRL event: ${data.irlEventName}`);
          }
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
  // Uses word boundary match - "PAC" matches "PAC" but NOT "pace"
  const isInWatchlist = useCallback(
    (term: string): boolean => {
      return favorites.some(
        (fav) =>
          fav.type === "search" &&
          wordBoundaryMatch(term, fav.term)
      );
    },
    [favorites]
  );

  // Check if a term is exactly in watchlist (exact match only)
  // Use this for displaying watchlist status of search queries to avoid false positives
  // e.g. "skee" should NOT show as in watchlist just because "skee mask" is in watchlist
  const isExactlyInWatchlist = useCallback(
    (term: string): boolean => {
      const termLower = term.toLowerCase();
      return favorites.some(
        (fav) => fav.type === "search" && fav.term.toLowerCase() === termLower
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
        // Also match NTS format "HOST w/ GUEST" in show name
        const wMatch = show.name.match(/^(.+?)\s+w\/\s+/i);
        if (wMatch) {
          const hostPart = wMatch[1].trim();
          if (hostPart.split(/\s+/).length <= 2 && containsMatch(hostPart, djName)) return true;
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
          // Query by term only, filter by stationId in memory
          const q = query(
            favoritesRef,
            where("term", "==", show.name.toLowerCase())
          );
          const existingDocs = await getDocs(q);
          const existsInFirebase = existingDocs.docs.some(
            (doc) => doc.data().stationId === show.stationId
          );
          if (!existsInFirebase) {
            // If show doesn't have DJ profile data, try to look it up
            let djUsername = show.djUsername || null;
            let djPhotoUrl = show.djPhotoUrl || null;

            if (show.dj && (!djUsername || !djPhotoUrl)) {
              const djNormalized = show.dj.replace(/[\s-]+/g, "").toLowerCase();
              try {
                // Check pending-dj-profiles first
                const pendingRef = collection(db, "pending-dj-profiles");
                const pendingQ = query(
                  pendingRef,
                  where("chatUsernameNormalized", "==", djNormalized)
                );
                const pendingSnapshot = await getDocs(pendingQ);

                if (!pendingSnapshot.empty) {
                  const data = pendingSnapshot.docs[0].data();
                  djUsername = djUsername || data.chatUsername || null;
                  djPhotoUrl = djPhotoUrl || data.djProfile?.photoUrl || null;
                } else {
                  // Fall back to users collection
                  const usersRef = collection(db, "users");
                  const usersQ = query(
                    usersRef,
                    where("chatUsernameNormalized", "==", djNormalized),
                    where("role", "in", ["dj", "broadcaster", "admin"])
                  );
                  const usersSnapshot = await getDocs(usersQ);

                  if (!usersSnapshot.empty) {
                    const data = usersSnapshot.docs[0].data();
                    djUsername = djUsername || data.chatUsername || null;
                    djPhotoUrl = djPhotoUrl || data.djProfile?.photoUrl || null;
                  }
                }
              } catch (lookupError) {
                console.warn(`[addDJShowsToFavorites] Could not look up DJ profile for ${show.dj}:`, lookupError);
              }
            }

            console.log(`[addDJShowsToFavorites] Adding show to favorites: ${show.name} (${show.stationId}) with djUsername=${djUsername}`);
            await addDoc(favoritesRef, {
              term: show.name.toLowerCase(),
              type: "show",
              showName: show.name,
              djName: show.dj || null,
              djUsername,
              djPhotoUrl,
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
    isExactlyInWatchlist,
    followDJ,
    addDJShowsToFavorites,
  };
}
