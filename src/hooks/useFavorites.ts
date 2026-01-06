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
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { Show } from "@/types";

export interface Favorite {
  id: string;
  term: string;
  type: "show" | "dj" | "search";
  showName?: string;
  djName?: string;
  stationId?: string;
  createdAt: Date;
  createdBy: "web" | "ios";
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

  // Check if a show is favorited
  const isShowFavorited = useCallback(
    (show: Show): boolean => {
      return favorites.some(
        (fav) =>
          fav.term.toLowerCase() === show.name.toLowerCase() ||
          (show.dj && fav.term.toLowerCase() === show.dj.toLowerCase())
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

  // Add a search term to watchlist
  const addToWatchlist = useCallback(
    async (term: string): Promise<boolean> => {
      if (!user || !db) return false;

      try {
        const favoritesRef = collection(db, "users", user.uid, "favorites");

        // Check if already exists
        const q = query(
          favoritesRef,
          where("term", "==", term.toLowerCase())
        );
        const existing = await getDocs(q);
        if (!existing.empty) return true;

        await addDoc(favoritesRef, {
          term: term.toLowerCase(),
          type: "search",
          showName: null,
          djName: null,
          stationId: null,
          createdAt: serverTimestamp(),
          createdBy: "web",
        });

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

  // Check if a term is in watchlist
  const isInWatchlist = useCallback(
    (term: string): boolean => {
      return favorites.some(
        (fav) => fav.term.toLowerCase() === term.toLowerCase()
      );
    },
    [favorites]
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
  };
}
