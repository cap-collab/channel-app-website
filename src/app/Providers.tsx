"use client";

import { ReactNode } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { BPMProvider } from "@/contexts/BPMContext";
import { ScheduleProvider } from "@/contexts/ScheduleContext";
import { BroadcastStreamProvider } from "@/contexts/BroadcastStreamContext";
import { ArchivePlayerProvider } from "@/contexts/ArchivePlayerContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <BPMProvider>
        <ScheduleProvider>
          <BroadcastStreamProvider>
            <ArchivePlayerProvider>
              {children}
            </ArchivePlayerProvider>
          </BroadcastStreamProvider>
        </ScheduleProvider>
      </BPMProvider>
    </AuthProvider>
  );
}
