import { Metadata } from "next";
import { UnsubscribeClient } from "./UnsubscribeClient";

export const metadata: Metadata = {
  title: "Unsubscribe - Channel",
  description: "Manage your email preferences",
};

export default function UnsubscribePage() {
  return <UnsubscribeClient />;
}
