import { Metadata } from "next";
import { getAdminDb } from "@/lib/firebase-admin";
import { DJPublicProfileClient } from "./DJPublicProfileClient";

// Force dynamic rendering so Admin SDK has access to env vars at runtime
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ username: string }>;
}

async function getDJDisplayName(username: string): Promise<string | null> {
  const adminDb = getAdminDb();
  if (!adminDb) {
    console.log("[DJ Metadata] Admin DB not available");
    return null;
  }

  try {
    const normalized = decodeURIComponent(username).replace(/[\s-]+/g, "").toLowerCase();
    console.log("[DJ Metadata] Looking up:", normalized);

    // Check pending-dj-profiles first (single where clause)
    const pendingSnapshot = await adminDb
      .collection("pending-dj-profiles")
      .where("chatUsernameNormalized", "==", normalized)
      .get();

    // Use first matching profile (no status filter - show page regardless of status)
    if (pendingSnapshot.docs.length > 0) {
      const doc = pendingSnapshot.docs[0];
      console.log("[DJ Metadata] Found pending profile:", doc.data().chatUsername);
      return doc.data().chatUsername || null;
    }

    // Check users collection (single where clause, filter roles client-side)
    const usersSnapshot = await adminDb
      .collection("users")
      .where("chatUsernameNormalized", "==", normalized)
      .get();

    for (const doc of usersSnapshot.docs) {
      const role = doc.data().role;
      if (role === "dj" || role === "broadcaster" || role === "admin") {
        console.log("[DJ Metadata] Found user profile:", doc.data().chatUsername);
        return doc.data().chatUsername || null;
      }
    }

    console.log("[DJ Metadata] No profile found for:", normalized);
    return null;
  } catch (error) {
    console.error("[DJ Metadata] Error:", error);
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const displayName = await getDJDisplayName(username);
  const name = displayName || username;
  const title = `Channel - ${name}`;
  const description = `Listen to ${name} live on Channel`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
    },
    twitter: {
      title,
      description,
    },
  };
}

export default async function DJPublicProfilePage({ params }: Props) {
  const { username } = await params;
  return <DJPublicProfileClient username={username} />;
}
