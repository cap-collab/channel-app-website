import { SettingsClient } from "./SettingsClient";

export const metadata = {
  title: "Settings",
  description: "Manage your notification preferences.",
};

export default function SettingsPage() {
  return <SettingsClient />;
}
