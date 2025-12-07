"use client";

import { useState, useEffect, useCallback } from "react";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { Show } from "@/types";

interface CalendarState {
  isConnected: boolean;
  loading: boolean;
  error: string | null;
}

interface CalendarData {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  calendarId: string;
}

export function useCalendarSync() {
  const { user } = useAuthContext();
  const [state, setState] = useState<CalendarState>({
    isConnected: false,
    loading: true,
    error: null,
  });

  // Handle calendar data from URL hash (after OAuth callback)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const hash = window.location.hash;
    if (hash.startsWith("#calendar_data=")) {
      const dataStr = decodeURIComponent(hash.replace("#calendar_data=", ""));
      try {
        const data: CalendarData = JSON.parse(dataStr);

        // Verify this is for the current user
        if (user && data.userId === user.uid && db) {
          // Store tokens in Firestore
          const userRef = doc(db, "users", user.uid);
          setDoc(
            userRef,
            {
              googleCalendar: {
                accessToken: data.accessToken,
                refreshToken: data.refreshToken,
                expiresAt: new Date(data.expiresAt),
                calendarId: data.calendarId,
                connectedAt: serverTimestamp(),
              },
            },
            { merge: true }
          ).then(() => {
            // Clear the hash from URL
            window.history.replaceState(null, "", window.location.pathname);
            setState({ isConnected: true, loading: false, error: null });
          });
        }
      } catch (e) {
        console.error("Error parsing calendar data:", e);
      }
      // Clear hash regardless
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [user]);

  // Listen for calendar connection status
  useEffect(() => {
    if (!user || !db) {
      setState({ isConnected: false, loading: false, error: null });
      return;
    }

    const userRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        const data = snapshot.data();
        const isConnected = !!data?.googleCalendar?.calendarId;
        setState({ isConnected, loading: false, error: null });
      },
      (error) => {
        console.error("Error checking calendar status:", error);
        setState({ isConnected: false, loading: false, error: error.message });
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Connect Google Calendar
  const connectCalendar = useCallback(async () => {
    if (!auth?.currentUser) {
      setState((prev) => ({
        ...prev,
        error: "Please sign in first",
      }));
      return;
    }

    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      const userId = auth.currentUser.uid;

      const response = await fetch(`/api/auth/google?userId=${encodeURIComponent(userId)}`);

      if (!response.ok) {
        throw new Error("Failed to get auth URL");
      }

      const { authUrl } = await response.json();

      // Redirect to Google OAuth (will redirect back to /settings with data)
      window.location.href = authUrl;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to connect calendar";
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, []);

  // Disconnect calendar
  const disconnectCalendar = useCallback(async () => {
    if (!auth?.currentUser || !db) return;

    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      // Remove Google Calendar data from user document client-side
      const userRef = doc(db, "users", auth.currentUser.uid);
      await setDoc(
        userRef,
        {
          googleCalendar: null,
        },
        { merge: true }
      );

      setState({ isConnected: false, loading: false, error: null });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to disconnect";
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, []);

  // Add show to calendar
  const addToCalendar = useCallback(
    async (show: Show, stationName: string, stationUrl?: string) => {
      if (!auth?.currentUser) return false;

      try {
        const idToken = await auth.currentUser.getIdToken();

        const response = await fetch("/api/calendar/events", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            show: {
              id: show.id,
              name: show.name,
              dj: show.dj,
              description: show.description,
              stationName,
              stationUrl,
              startTime: show.startTime,
              endTime: show.endTime,
            },
          }),
        });

        return response.ok;
      } catch (error) {
        console.error("Error adding to calendar:", error);
        return false;
      }
    },
    []
  );

  // Remove show from calendar
  const removeFromCalendar = useCallback(async (showId: string) => {
    if (!auth?.currentUser) return false;

    try {
      const idToken = await auth.currentUser.getIdToken();

      const response = await fetch(`/api/calendar/events?showId=${showId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      return response.ok;
    } catch (error) {
      console.error("Error removing from calendar:", error);
      return false;
    }
  }, []);

  return {
    isConnected: state.isConnected,
    loading: state.loading,
    error: state.error,
    connectCalendar,
    disconnectCalendar,
    addToCalendar,
    removeFromCalendar,
  };
}
