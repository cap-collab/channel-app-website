import { makeOG } from "@/lib/og";
import { ApplyClient } from "./ApplyClient";

export const metadata = makeOG();

export default function ApplyPage() {
  return <ApplyClient />;
}
