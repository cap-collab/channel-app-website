import { Metadata } from "next";
import { DJShowsClient } from "./DJShowsClient";

export const metadata: Metadata = {
  title: "Browse DJ Shows - Channel",
  description: "Browse DJ shows across multiple independent radio stations",
};

export default function DJShowsPage() {
  return <DJShowsClient />;
}
