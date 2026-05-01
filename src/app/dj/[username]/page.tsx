import { Metadata } from "next";
import { getAdminDb } from "@/lib/firebase-admin";
import { makeOG } from "@/lib/og";
import { DJPublicProfileClient } from "./DJPublicProfileClient";

// Force dynamic rendering so Admin SDK has access to env vars at runtime
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ username: string }>;
}

async function getDJData(username: string): Promise<{ name: string; photoUrl: string | null } | null> {
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

    if (pendingSnapshot.docs.length > 0) {
      const data = pendingSnapshot.docs[0].data();
      console.log("[DJ Metadata] Found pending profile:", data.chatUsername);
      return {
        name: data.chatUsername || username,
        photoUrl: data.djProfile?.photoUrl || null,
      };
    }

    // Check users collection (single where clause, filter roles client-side)
    const usersSnapshot = await adminDb
      .collection("users")
      .where("chatUsernameNormalized", "==", normalized)
      .get();

    for (const doc of usersSnapshot.docs) {
      const data = doc.data();
      const role = data.role;
      if (role === "dj" || role === "broadcaster" || role === "admin") {
        console.log("[DJ Metadata] Found user profile:", data.chatUsername);
        return {
          name: data.chatUsername || username,
          photoUrl: data.djProfile?.photoUrl || null,
        };
      }
    }

    // Final fallback: collective by slug (collectives share the /dj/<slug> namespace)
    const collectivesSnapshot = await adminDb
      .collection("collectives")
      .where("slug", "==", normalized)
      .limit(1)
      .get();

    if (!collectivesSnapshot.empty) {
      const data = collectivesSnapshot.docs[0].data();
      console.log("[DJ Metadata] Found collective:", data.name);
      return {
        name: data.name || username,
        photoUrl: data.photo || null,
      };
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
  const dj = await getDJData(username);
  const name = dj?.name || username;
  return makeOG({
    title: `Channel - ${name}`,
    image: dj?.photoUrl || undefined,
  });
}

export default async function DJPublicProfilePage({ params }: Props) {
  const { username } = await params;
  const seed = await getDJData(username);
  return (
    <DJPublicProfileClient
      username={username}
      initialName={seed?.name ?? null}
      initialPhotoUrl={seed?.photoUrl ?? null}
    />
  );
}
