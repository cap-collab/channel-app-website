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

    const favoritesRef = collection(db, "users", user.uid, "favorites");
    const unsubscribe = onSnapshot(
      favoritesRef,
      (snapshot) => {
        const favs: Favorite[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate() || new Date(),
        })) as Favorite[];
        setFavorites(favs);
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

  return {
    favorites,
    loading,
    isShowFavorited,
    addFavorite,
    removeFavorite,
    toggleFavorite,
  };
}
