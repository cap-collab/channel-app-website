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
