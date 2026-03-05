"use client";

import { ReactNode } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { BPMProvider } from "@/contexts/BPMContext";
import { ScheduleProvider } from "@/contexts/ScheduleContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <BPMProvider>
        <ScheduleProvider>{children}</ScheduleProvider>
      </BPMProvider>
    </AuthProvider>
  );
}
