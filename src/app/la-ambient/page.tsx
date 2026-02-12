import { Metadata } from "next";
import { Suspense } from "react";
import { LAmbientClient } from "./LAmbientClient";

export const metadata: Metadata = {
  title: "LA – Ambient | Channel",
  description:
    "A map of the selectors and spaces shaping LA's ambient electronic scene.",
  openGraph: {
    title: "LA – Ambient | Channel",
    description:
      "A map of the selectors and spaces shaping LA's ambient electronic scene.",
  },
  twitter: {
    title: "LA – Ambient | Channel",
    description:
      "A map of the selectors and spaces shaping LA's ambient electronic scene.",
  },
};

export default function LAmbientPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <LAmbientClient />
    </Suspense>
  );
}
