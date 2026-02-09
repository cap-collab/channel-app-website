"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  doc,
  onSnapshot,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { Header } from "@/components/Header";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUserRole, isDJ } from "@/hooks/useUserRole";
import { AuthModal } from "@/components/AuthModal";
import { SUPPORTED_CITIES } from "@/lib/city-detection";
import { SUPPORTED_GENRES } from "@/lib/genres";

interface NotificationSettings {
  showStarting: boolean;
  watchlistMatch: boolean;
  mentions: boolean;
  popularity: boolean;
  djOnline: boolean;
}

interface ActivityMessageSettings {
  showLoveMessages: boolean;
  showLockedInMessages: boolean;
  showFavoriteMessages: boolean;
}

export function SettingsClient() {
  const { user, isAuthenticated, loading: authLoading, signOut } = useAuthContext();
  const { role, loading: roleLoading } = useUserRole(user);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [notifications, setNotifications] = useState<NotificationSettings>({
    showStarting: false,
    watchlistMatch: false,
    mentions: false,
    popularity: false,
    djOnline: false,
  });
  const [activityMessages, setActivityMessages] = useState<ActivityMessageSettings>({
    showLoveMessages: true,
    showLockedInMessages: true,
    showFavoriteMessages: true,
  });
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Channel preferences state
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [selectedGenre, setSelectedGenre] = useState<string>("");
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [genreDropdownOpen, setGenreDropdownOpen] = useState(false);
  const cityDropdownRef = useRef<HTMLDivElement>(null);
  const genreDropdownRef = useRef<HTMLDivElement>(null);

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
          mentions: data.emailNotifications.mentions || false,
          popularity: data.emailNotifications.popularity || false,
          djOnline: data.emailNotifications.djOnline || false,
        });
      }
      // Activity messages default to true if not set
      if (data?.activityMessages !== undefined) {
        setActivityMessages({
          showLoveMessages: data.activityMessages.showLoveMessages ?? true,
          showLockedInMessages: data.activityMessages.showLockedInMessages ?? true,
          showFavoriteMessages: data.activityMessages.showFavoriteMessages ?? true,
        });
      }
      // Channel preferences
      if (data?.irlCity) setSelectedCity(data.irlCity);
      if (data?.preferredGenre) setSelectedGenre(data.preferredGenre);
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

  const handleActivityToggle = async (key: keyof ActivityMessageSettings) => {
    if (!user || !db) return;

    const newValue = !activityMessages[key];
    setSaving(true);

    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        [`activityMessages.${key}`]: newValue,
      });
      setActivityMessages((prev) => ({ ...prev, [key]: newValue }));
    } catch (error) {
      console.error("Error updating activity message setting:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleCityChange = async (city: string) => {
    if (!user || !db) return;
    setSelectedCity(city);
    setCityDropdownOpen(false);
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, { irlCity: city });
    } catch (error) {
      console.error("Error saving city preference:", error);
    }
  };

  const handleGenreChange = async (genre: string) => {
    if (!user || !db) return;
    setSelectedGenre(genre);
    setGenreDropdownOpen(false);
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, { preferredGenre: genre });
    } catch (error) {
      console.error("Error saving genre preference:", error);
    }
  };

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cityDropdownRef.current && !cityDropdownRef.current.contains(e.target as Node)) {
        setCityDropdownOpen(false);
      }
      if (genreDropdownRef.current && !genreDropdownRef.current.contains(e.target as Node)) {
        setGenreDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDeleteAccount = async () => {
    if (!user || !db) return;

    setDeleting(true);
    try {
      const batch = writeBatch(db);

      // 1. Delete all favorites (subcollection)
      const favoritesRef = collection(db, "users", user.uid, "favorites");
      const favoritesSnapshot = await getDocs(favoritesRef);
      favoritesSnapshot.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      // 2. Delete pending mention emails for this user
      const mentionsQuery = query(
        collection(db, "pendingMentionEmails"),
        where("userId", "==", user.uid)
      );
      const mentionsSnapshot = await getDocs(mentionsQuery);
      mentionsSnapshot.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      // 3. Delete pending popularity emails for this user
      const popularityQuery = query(
        collection(db, "pendingPopularityEmails"),
        where("userId", "==", user.uid)
      );
      const popularitySnapshot = await getDocs(popularityQuery);
      popularitySnapshot.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      // 4. Delete username reservation for this user
      const usernamesQuery = query(
        collection(db, "usernames"),
        where("uid", "==", user.uid)
      );
      const usernamesSnapshot = await getDocs(usernamesQuery);
      usernamesSnapshot.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      // 5. Delete user document
      const userRef = doc(db, "users", user.uid);
      batch.delete(userRef);

      // Commit all deletions
      await batch.commit();

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

  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <Header position="sticky" />

      <main className="max-w-xl mx-auto p-4">
        {!isAuthenticated ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-6">
              Sign in to manage your notification preferences
            </p>
            <button
              onClick={() => setShowAuthModal(true)}
              className="bg-white text-black px-6 py-3 rounded font-medium hover:bg-gray-100 transition-colors"
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
              <div className="bg-[#1a1a1a] rounded p-4">
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

            {/* Channel preferences section */}
            <section>
              <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                Channel Preferences
              </h2>
              <div className="bg-[#1a1a1a] rounded divide-y divide-gray-800">
                {/* City preference */}
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">City</p>
                    <p className="text-gray-500 text-sm">
                      Filter shows and DJs near you
                    </p>
                  </div>
                  <div className="relative" ref={cityDropdownRef}>
                    <button
                      onClick={() => {
                        setCityDropdownOpen(!cityDropdownOpen);
                        setGenreDropdownOpen(false);
                      }}
                      className="px-3 py-1.5 rounded text-sm font-mono bg-white/5 text-white hover:bg-white/10 transition-colors flex items-center gap-1.5"
                    >
                      <span className="truncate max-w-[140px]">{selectedCity || "Not set"}</span>
                      <svg
                        className={`w-3 h-3 flex-shrink-0 transition-transform ${cityDropdownOpen ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {cityDropdownOpen && (
                      <div className="absolute right-0 mt-1 w-48 bg-[#111] border border-white/10 rounded shadow-xl z-20 py-1 max-h-60 overflow-y-auto">
                        <button
                          onClick={() => handleCityChange("Anywhere")}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors font-mono ${
                            selectedCity === "Anywhere"
                              ? "bg-white/10 text-white"
                              : "text-gray-300 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          Anywhere
                        </button>
                        <div className="border-t border-white/10 my-1" />
                        {SUPPORTED_CITIES.map((city) => (
                          <button
                            key={city}
                            onClick={() => handleCityChange(city)}
                            className={`w-full text-left px-3 py-2 text-sm transition-colors font-mono ${
                              selectedCity === city
                                ? "bg-white/10 text-white"
                                : "text-gray-300 hover:bg-white/5 hover:text-white"
                            }`}
                          >
                            {city}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Genre preference */}
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">Genre</p>
                    <p className="text-gray-500 text-sm">
                      Your preferred music genre
                    </p>
                  </div>
                  <div className="relative" ref={genreDropdownRef}>
                    <button
                      onClick={() => {
                        setGenreDropdownOpen(!genreDropdownOpen);
                        setCityDropdownOpen(false);
                      }}
                      className="px-3 py-1.5 rounded text-sm font-mono bg-white/5 text-white hover:bg-white/10 transition-colors flex items-center gap-1.5"
                    >
                      <span className="truncate max-w-[140px]">{selectedGenre || "Not set"}</span>
                      <svg
                        className={`w-3 h-3 flex-shrink-0 transition-transform ${genreDropdownOpen ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {genreDropdownOpen && (
                      <div className="absolute right-0 mt-1 w-48 bg-[#111] border border-white/10 rounded shadow-xl z-20 py-1 max-h-60 overflow-y-auto">
                        {SUPPORTED_GENRES.map((genre) => (
                          <button
                            key={genre}
                            onClick={() => handleGenreChange(genre)}
                            className={`w-full text-left px-3 py-2 text-sm transition-colors font-mono ${
                              selectedGenre === genre
                                ? "bg-white/10 text-white"
                                : "text-gray-300 hover:bg-white/5 hover:text-white"
                            }`}
                          >
                            {genre}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-gray-600 text-xs mt-2 px-1">
                These preferences are used to personalize your Channel feed
              </p>
            </section>

            {/* Upgrade to DJ section - only show for non-DJ users */}
            {!isDJ(role) && (
              <section>
                <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                  Broadcast on Channel
                </h2>
                <div className="bg-[#1a1a1a] rounded p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">Upgrade to DJ</p>
                      <p className="text-gray-500 text-sm">
                        Start broadcasting your own shows on Channel
                      </p>
                    </div>
                    <Link
                      href="/studio/join"
                      className="px-4 py-2 rounded text-sm font-medium bg-white text-black hover:bg-gray-100 transition-colors"
                    >
                      Upgrade
                    </Link>
                  </div>
                </div>
              </section>
            )}

            {/* Email notifications section */}
            <section>
              <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                Email Notifications
              </h2>
              <div className="bg-[#1a1a1a] rounded divide-y divide-gray-800">
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">Show going live</p>
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
                    <p className="text-white font-medium">DJ show match</p>
                    <p className="text-gray-500 text-sm">
                      Daily email when new shows match your watchlist
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
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">Chat mentions</p>
                    <p className="text-gray-500 text-sm">
                      Email when someone @mentions you in chat
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggle("mentions")}
                    disabled={saving}
                    className={`w-12 h-7 rounded-full transition-colors ${
                      notifications.mentions ? "bg-white" : "bg-gray-700"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-black transition-transform mx-1 ${
                        notifications.mentions ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">Popularity alerts</p>
                    <p className="text-gray-500 text-sm">
                      Email when shows get lots of hearts or chat activity
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggle("popularity")}
                    disabled={saving}
                    className={`w-12 h-7 rounded-full transition-colors ${
                      notifications.popularity ? "bg-white" : "bg-gray-700"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-black transition-transform mx-1 ${
                        notifications.popularity ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">DJ online</p>
                    <p className="text-gray-500 text-sm">
                      Email when DJs you follow are active in chat
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggle("djOnline")}
                    disabled={saving}
                    className={`w-12 h-7 rounded-full transition-colors ${
                      notifications.djOnline ? "bg-white" : "bg-gray-700"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-black transition-transform mx-1 ${
                        notifications.djOnline ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>
              </div>
              <p className="text-gray-600 text-xs mt-2 px-1">
                Push notifications can be managed in the Channel app
              </p>
            </section>

            {/* Activity messages section */}
            <section>
              <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                Chat Activity Messages
              </h2>
              <div className="bg-[#1a1a1a] rounded divide-y divide-gray-800">
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">Love reactions</p>
                    <p className="text-gray-500 text-sm">
                      Post a message in chat when you send love
                    </p>
                  </div>
                  <button
                    onClick={() => handleActivityToggle("showLoveMessages")}
                    disabled={saving}
                    className={`w-12 h-7 rounded-full transition-colors ${
                      activityMessages.showLoveMessages ? "bg-white" : "bg-gray-700"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-black transition-transform mx-1 ${
                        activityMessages.showLoveMessages ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">Locked in</p>
                    <p className="text-gray-500 text-sm">
                      Post a message when you&apos;re locked in listening
                    </p>
                  </div>
                  <button
                    onClick={() => handleActivityToggle("showLockedInMessages")}
                    disabled={saving}
                    className={`w-12 h-7 rounded-full transition-colors ${
                      activityMessages.showLockedInMessages ? "bg-white" : "bg-gray-700"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-black transition-transform mx-1 ${
                        activityMessages.showLockedInMessages ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">Favorites</p>
                    <p className="text-gray-500 text-sm">
                      Post a message when you favorite a show or DJ
                    </p>
                  </div>
                  <button
                    onClick={() => handleActivityToggle("showFavoriteMessages")}
                    disabled={saving}
                    className={`w-12 h-7 rounded-full transition-colors ${
                      activityMessages.showFavoriteMessages ? "bg-white" : "bg-gray-700"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-black transition-transform mx-1 ${
                        activityMessages.showFavoriteMessages ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>
              </div>
              <p className="text-gray-600 text-xs mt-2 px-1">
                These messages are visible to other users in chat
              </p>
            </section>

            {/* Delete account section */}
            <section>
              <h2 className="text-gray-500 text-xs uppercase tracking-wide mb-3">
                Danger Zone
              </h2>
              <div className="bg-[#1a1a1a] rounded p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">Delete my account</p>
                    <p className="text-gray-500 text-sm">
                      Permanently delete your account and all data
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="px-4 py-2 rounded text-sm font-medium bg-red-900/50 text-red-400 hover:bg-red-900 hover:text-red-300 transition-colors"
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
          <div className="bg-[#1a1a1a] rounded max-w-md w-full p-6">
            <h3 className="text-xl font-semibold text-white mb-2">
              Delete your account?
            </h3>
            <p className="text-gray-400 mb-6">
              This will permanently delete your account and associated data,
              including your favorites, watchlist, saved searches, notification
              preferences, and username reservation. Chat messages you posted
              will remain but can be removed upon request. This action cannot be
              undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 px-4 py-3 rounded font-medium bg-gray-800 text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="flex-1 px-4 py-3 rounded font-medium bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
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
