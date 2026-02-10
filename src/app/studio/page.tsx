import { Suspense } from "react";
import { StudioProfileClient } from "./StudioProfileClient";

export const metadata = {
  title: "Studio - Channel",
  description: "Manage your DJ profile and broadcast settings",
};

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
    </div>
  );
}

export default function StudioPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <StudioProfileClient />
    </Suspense>
  );
}
