import { Metadata } from "next";
import { headers } from "next/headers";
import { DJPublicProfileClient } from "./DJPublicProfileClient";

interface Props {
  params: Promise<{ username: string }>;
}

async function getDJDisplayName(username: string): Promise<string | null> {
  try {
    // Get the host from headers to build absolute URL
    const headersList = await headers();
    const host = headersList.get("host") || "channel-app.com";
    const protocol = host.includes("localhost") ? "http" : "https";

    const res = await fetch(`${protocol}://${host}/api/dj/${encodeURIComponent(username)}/metadata`, {
      cache: "no-store",
    });

    if (res.ok) {
      const data = await res.json();
      return data.displayName || null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const displayName = await getDJDisplayName(username);
  const name = displayName || username;

  return {
    title: `Channel - ${name}`,
    description: `Listen to ${name} live on Channel`,
  };
}

export default async function DJPublicProfilePage({ params }: Props) {
  const { username } = await params;
  return <DJPublicProfileClient username={username} />;
}
