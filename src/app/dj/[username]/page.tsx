import { Metadata } from "next";
import { getAdminDb } from "@/lib/firebase-admin";
import { DJPublicProfileClient } from "./DJPublicProfileClient";

interface Props {
  params: Promise<{ username: string }>;
}

async function getDJDisplayName(username: string): Promise<string | null> {
  const adminDb = getAdminDb();
  if (!adminDb) return null;

  try {
    const normalized = decodeURIComponent(username).replace(/[\s-]+/g, "").toLowerCase();

    // Check pending-dj-profiles first
    const pendingSnapshot = await adminDb
      .collection("pending-dj-profiles")
      .where("chatUsernameNormalized", "==", normalized)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (!pendingSnapshot.empty) {
      return pendingSnapshot.docs[0].data().chatUsername || null;
    }

    // Check users collection
    const usersSnapshot = await adminDb
      .collection("users")
      .where("chatUsernameNormalized", "==", normalized)
      .where("role", "in", ["dj", "broadcaster", "admin"])
      .limit(1)
      .get();

    if (!usersSnapshot.empty) {
      return usersSnapshot.docs[0].data().chatUsername || null;
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
