import { Metadata } from "next";
import { Suspense } from "react";
import { LAmbientClient } from "./LAmbientClient";

export const metadata: Metadata = {
  title: "LA Scene — Ambient x Techno | Channel",
  description:
    "A map of the selectors and spaces shaping LA's ambient and techno scene.",
  openGraph: {
    title: "LA Scene — Ambient x Techno | Channel",
    description:
      "A map of the selectors and spaces shaping LA's ambient and techno scene.",
  },
  twitter: {
    title: "LA Scene — Ambient x Techno | Channel",
    description:
      "A map of the selectors and spaces shaping LA's ambient and techno scene.",
  },
};

export default function LAmbientPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <LAmbientClient />
    </Suspense>
  );
}
