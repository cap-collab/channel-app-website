"use client";

import { useState, useEffect, useCallback } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { Show } from "@/types";

interface CalendarState {
  isConnected: boolean;
  loading: boolean;
  error: string | null;
}

export function useCalendarSync() {
  const { user } = useAuthContext();
  const [state, setState] = useState<CalendarState>({
    isConnected: false,
    loading: true,
    error: null,
  });

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

      const idToken = await auth.currentUser.getIdToken();

      const response = await fetch("/api/auth/google", {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to get auth URL");
      }

      const { authUrl } = await response.json();

      // Open Google OAuth in a popup
      const popup = window.open(authUrl, "Google Calendar", "width=500,height=600");

      // Poll for popup close
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          setState((prev) => ({ ...prev, loading: false }));
        }
      }, 500);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to connect calendar";
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, []);

  // Disconnect calendar
  const disconnectCalendar = useCallback(async () => {
    if (!auth?.currentUser) return;

    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      const idToken = await auth.currentUser.getIdToken();

      const response = await fetch("/api/calendar/disconnect", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to disconnect calendar");
      }

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
