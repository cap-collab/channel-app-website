"use client";

import { ReactNode } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { BPMProvider } from "@/contexts/BPMContext";
import { ScheduleProvider } from "@/contexts/ScheduleContext";
import { GlobalBroadcastBar } from "@/components/GlobalBroadcastBar";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <BPMProvider>
        <ScheduleProvider>
          {children}
          <GlobalBroadcastBar />
        </ScheduleProvider>
      </BPMProvider>
    </AuthProvider>
  );
}
