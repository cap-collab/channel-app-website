import { SettingsClient } from "./SettingsClient";

export const metadata = {
  title: "Settings - Channel",
  description: "Manage your notification preferences",
};

export default function SettingsPage() {
  return <SettingsClient />;
}
