import { Metadata } from "next";
import { ApplyClient } from "./ApplyClient";

export const metadata: Metadata = {
  title: "Feature Your Station - Channel",
  description: "Get your radio station featured on Channel",
};

export default function ApplyPage() {
  return <ApplyClient />;
}
