"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { doc, onSnapshot, updateDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { useCalendarSync } from "@/hooks/useCalendarSync";
import { AuthModal } from "@/components/AuthModal";

interface NotificationSettings {
  showStarting: boolean;
  watchlistMatch: boolean;
}

export function SettingsClient() {
  const { user, isAuthenticated, loading: authLoading, signOut } = useAuthContext();
  const {
    isConnected: isCalendarConnected,
    loading: calendarLoading,
    connectCalendar,
    disconnectCalendar,
  } = useCalendarSync();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [notifications, setNotifications] = useState<NotificationSettings>({
    showStarting: false,
    watchlistMatch: false,
  });
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Load user's notification settings
  useEffect(() => {
    if (!user || !db) return;

    const userRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      const data = snapshot.data();
      if (data?.emailNotifications) {
        setNotifications({
          showStarting: data.emailNotifications.showStarting || false,
          watchlistMatch: data.emailNotifications.watchlistMatch || false,
        });
      }
    });

    return () => unsubscribe();
  }, [user]);

  const handleToggle = async (key: keyof NotificationSettings) => {
    if (!user || !db) return;

    const newValue = !notifications[key];
    setSaving(true);

    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`emailNotifications.${key}`]: newValue,
      });
      setNotifications((prev) => ({ ...prev, [key]: newValue }));
    } catch (error) {
      console.error("Error updating notification setting:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user || !db) return;

    setDeleting(true);
    try {
      // Delete user document from Firestore
      const userRef = doc(db, "users", user.uid);
      await deleteDoc(userRef);

      // Sign out the user
      await signOut();

      // Redirect to home
      window.location.href = "/";
    } catch (error) {
      console.error("Error deleting account:", error);
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="p-4 border-b border-gray-900">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <Link
            href="/djshows"
            className="text-gray-600 hover:text-white text-sm transition-colors"
          >
            ← Back
          </Link>
          <h1 className="text-lg font-medium text-white">Settings</h1>
          <div className="w-10" />
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4">
        {!isAuthenticated ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-6">
              Sign in to manage your notification preferences
            </p>
            <button
              onClick={() => setShowAuthModal(true)}
              className="bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors"
            >
              Sign In
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Account section */}
            <section>
              <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                Account
              </h2>
              <div className="bg-gray-900/50 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  {user?.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt=""
                      className="w-10 h-10 rounded-full"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-white font-medium">
                      {user?.displayName?.charAt(0) || "?"}
                    </div>
                  )}
                  <div>
                    <p className="text-white font-medium">{user?.displayName}</p>
                    <p className="text-gray-500 text-sm">{user?.email}</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Calendar section */}
            <section>
              <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                Calendar Sync
              </h2>
              <div className="bg-gray-900/50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">Google Calendar</p>
                    <p className="text-gray-500 text-sm">
                      {isCalendarConnected
                        ? "Connected - shows sync to \"Channel Shows\" calendar"
                        : "Add shows to your Google Calendar"}
                    </p>
                  </div>
                  <button
                    onClick={isCalendarConnected ? disconnectCalendar : connectCalendar}
                    disabled={calendarLoading}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isCalendarConnected
                        ? "bg-gray-800 text-gray-400 hover:text-white"
                        : "bg-white text-black hover:bg-gray-100"
                    } disabled:opacity-50`}
                  >
                    {calendarLoading
                      ? "..."
                      : isCalendarConnected
                        ? "Disconnect"
                        : "Connect"}
                  </button>
                </div>
              </div>
            </section>

            {/* Email notifications section */}
            <section>
              <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                Email Notifications
              </h2>
              <div className="bg-gray-900/50 rounded-lg divide-y divide-gray-800">
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">Show starting alerts</p>
                    <p className="text-gray-500 text-sm">
                      Email when your saved shows go live
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggle("showStarting")}
                    disabled={saving}
                    className={`w-12 h-7 rounded-full transition-colors ${
                      notifications.showStarting ? "bg-white" : "bg-gray-700"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-black transition-transform mx-1 ${
                        notifications.showStarting ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">Watchlist digest</p>
                    <p className="text-gray-500 text-sm">
                      Daily email when new shows match your searches
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggle("watchlistMatch")}
                    disabled={saving}
                    className={`w-12 h-7 rounded-full transition-colors ${
                      notifications.watchlistMatch ? "bg-white" : "bg-gray-700"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-black transition-transform mx-1 ${
                        notifications.watchlistMatch ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>
              </div>
            </section>

            {/* My Shows link */}
            <section>
              <Link
                href="/my-shows"
                className="block bg-gray-900/50 rounded-lg p-4 hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">My Shows</p>
                    <p className="text-gray-500 text-sm">
                      View your saved shows and watchlist
                    </p>
                  </div>
                  <svg
                    className="w-5 h-5 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </Link>
            </section>

            {/* Delete account section */}
            <section>
              <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                Danger Zone
              </h2>
              <div className="bg-gray-900/50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">Delete my account</p>
                    <p className="text-gray-500 text-sm">
                      Permanently delete your account and all data
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-900/50 text-red-400 hover:bg-red-900 hover:text-red-300 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-xl max-w-md w-full p-6">
            <h3 className="text-xl font-semibold text-white mb-2">
              Delete your account?
            </h3>
            <p className="text-gray-400 mb-6">
              This will permanently delete your account and all associated data,
              including your email, favorites, watchlist, saved searches, and
              calendar sync settings. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 px-4 py-3 rounded-lg font-medium bg-gray-800 text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="flex-1 px-4 py-3 rounded-lg font-medium bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete Account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
