"use client";

import { ReactNode, useEffect } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider } from "@/contexts/AuthContext";
import { BPMProvider } from "@/contexts/BPMContext";
import { ScheduleProvider } from "@/contexts/ScheduleContext";
import { BroadcastStreamProvider } from "@/contexts/BroadcastStreamContext";
import { ArchivePlayerProvider } from "@/contexts/ArchivePlayerContext";
import { ArchiveRadioProvider } from "@/contexts/ArchiveRadioContext";
import { FilterProvider } from "@/contexts/FilterContext";
import { HeartNudgeProvider } from "@/contexts/HeartNudgeContext";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { initPostHog, identifyUser } from "@/lib/posthog";
import { useChunkErrorReload } from "@/hooks/useChunkErrorReload";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUserProfile";

// Ties the anonymous PostHog session to the logged-in user (email + chat
// username) so listener analytics can be attributed to real accounts. Lives
// inside AuthProvider so it can read auth context.
function PostHogIdentify() {
  const { user } = useAuthContext();
  const { chatUsername } = useUserProfile(user?.uid);

  useEffect(() => {
    if (user?.uid) {
      identifyUser(user.uid, { email: user.email, chatUsername });
    }
  }, [user, chatUsername]);

  return null;
}

// Stamps users/{uid}.lastSeenAt on app load for any logged-in user, on EVERY
// page. The interactive sign-in handlers already write lastSeenAt, but they only
// fire on an explicit sign-in — NOT when an existing session is silently
// restored on a return visit. This makes lastSeenAt a true "was on the site"
// signal, which the daily recs backfill uses to scope regeneration to active
// users. Throttled to ~once/day per device via localStorage so it's not a write
// per navigation. Runs inside AuthProvider (like PostHogIdentify) so it fires
// once when the logged-in user resolves, regardless of landing page. NOT placed
// in the raw onAuthStateChanged callback, which re-fires on tab focus / token
// refresh.
const LAST_SEEN_THROTTLE_MS = 20 * 60 * 60 * 1000; // ~once/day (< 24h so daily visitors always stamp)

function LastSeenStamp() {
  const { user } = useAuthContext();

  useEffect(() => {
    const uid = user?.uid;
    const firestore = db;
    if (!uid || !firestore) return;
    try {
      const key = `lastSeenStamp:${uid}`;
      const prev = Number(window.localStorage.getItem(key) || 0);
      const now = Date.now();
      if (prev && now - prev < LAST_SEEN_THROTTLE_MS) return;
      // Optimistically mark now so a fast re-render doesn't double-write; the
      // Firestore write is fire-and-forget (a failed write just means we retry
      // next load — no user-facing impact).
      window.localStorage.setItem(key, String(now));
      void setDoc(doc(firestore, "users", uid), { lastSeenAt: serverTimestamp() }, { merge: true }).catch(
        () => {
          // Revert the throttle marker on failure so the next load retries.
          try {
            window.localStorage.removeItem(key);
          } catch {
            /* ignore */
          }
        },
      );
    } catch {
      /* localStorage unavailable (private mode etc.) — skip stamping */
    }
  }, [user]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Recover from stale-deploy ChunkLoadErrors with a one-time reload. Runs on
  // every page (including the render-mix early-return below).
  useChunkErrorReload();
  // The /internal/render-mix page is loaded by a headless browser (the YouTube
  // render worker) and inside an admin preview iframe. It must NOT open
  // LiveKit / Firebase RTDB / auth subscriptions — those would create load on
  // the live broadcast plumbing and aren't needed for static visual rendering.
  const isRenderMix = pathname?.startsWith('/internal/render-mix');

  useEffect(() => {
    if (!isRenderMix) initPostHog();
  }, [isRenderMix]);

  if (isRenderMix) return <>{children}</>;

  return (
    <AuthProvider>
      <PostHogIdentify />
      <LastSeenStamp />
      <BPMProvider>
        <ScheduleProvider>
          <BroadcastStreamProvider>
            <ArchivePlayerProvider>
              <ArchiveRadioProvider enabled>
                <HeartNudgeProvider>
                  <FilterProvider>
                    {children}
                  </FilterProvider>
                </HeartNudgeProvider>
              </ArchiveRadioProvider>
            </ArchivePlayerProvider>
          </BroadcastStreamProvider>
        </ScheduleProvider>
      </BPMProvider>
    </AuthProvider>
  );
}
