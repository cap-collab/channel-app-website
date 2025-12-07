"use client";

import { useState, useEffect, useCallback } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";

interface UserPreferences {
  emailNotifications: {
    showStarting: boolean;
    watchlistMatch: boolean;
  };
}

const defaultPreferences: UserPreferences = {
  emailNotifications: {
    showStarting: false,
    watchlistMatch: false,
  },
};

export function useUserPreferences() {
  const { user } = useAuthContext();
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPreferences);
  const [loading, setLoading] = useState(true);

  // Subscribe to user preferences
  useEffect(() => {
    if (!user || !db) {
      setPreferences(defaultPreferences);
      setLoading(false);
      return;
    }

    const userRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setPreferences({
            emailNotifications: data.emailNotifications || defaultPreferences.emailNotifications,
          });
        }
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching user preferences:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Check if notifications are enabled
  const hasNotificationsEnabled = preferences.emailNotifications.showStarting ||
    preferences.emailNotifications.watchlistMatch;

  // Enable email notifications
  const enableNotifications = useCallback(async (): Promise<boolean> => {
    if (!user || !db) return false;

    try {
      const userRef = doc(db, "users", user.uid);
      await setDoc(
        userRef,
        {
          emailNotifications: {
            showStarting: true,
            watchlistMatch: true,
          },
        },
        { merge: true }
      );
      return true;
    } catch (error) {
      console.error("Error enabling notifications:", error);
      return false;
    }
  }, [user]);

  // Disable email notifications
  const disableNotifications = useCallback(async (): Promise<boolean> => {
    if (!user || !db) return false;

    try {
      const userRef = doc(db, "users", user.uid);
      await setDoc(
        userRef,
        {
          emailNotifications: {
            showStarting: false,
            watchlistMatch: false,
          },
        },
        { merge: true }
      );
      return true;
    } catch (error) {
      console.error("Error disabling notifications:", error);
      return false;
    }
  }, [user]);

  return {
    preferences,
    loading,
    hasNotificationsEnabled,
    enableNotifications,
    disableNotifications,
  };
}
