"use client";

import { ReactNode, useEffect } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider } from "@/contexts/AuthContext";
import { BPMProvider } from "@/contexts/BPMContext";
import { ScheduleProvider } from "@/contexts/ScheduleContext";
import { BroadcastStreamProvider } from "@/contexts/BroadcastStreamContext";
import { ArchivePlayerProvider } from "@/contexts/ArchivePlayerContext";
import { FilterProvider } from "@/contexts/FilterContext";
import { HeartNudgeProvider } from "@/contexts/HeartNudgeContext";
import { initPostHog } from "@/lib/posthog";

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
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
      <BPMProvider>
        <ScheduleProvider>
          <BroadcastStreamProvider>
            <ArchivePlayerProvider>
              <HeartNudgeProvider>
                <FilterProvider>
                  {children}
                </FilterProvider>
              </HeartNudgeProvider>
            </ArchivePlayerProvider>
          </BroadcastStreamProvider>
        </ScheduleProvider>
      </BPMProvider>
    </AuthProvider>
  );
}
