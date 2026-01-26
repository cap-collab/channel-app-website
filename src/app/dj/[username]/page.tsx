import { Metadata } from "next";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DJPublicProfileClient } from "./DJPublicProfileClient";

interface Props {
  params: Promise<{ username: string }>;
}

async function getDJDisplayName(username: string): Promise<string | null> {
  if (!db) return null;

  try {
    const normalized = decodeURIComponent(username).replace(/[\s-]+/g, "").toLowerCase();

    // Check pending-dj-profiles first
    const pendingRef = collection(db, "pending-dj-profiles");
    const pendingQ = query(
      pendingRef,
      where("chatUsernameNormalized", "==", normalized)
    );
    const pendingSnapshot = await getDocs(pendingQ);
    const pendingDoc = pendingSnapshot.docs.find(
      (doc) => doc.data().status === "pending"
    );

    if (pendingDoc) {
      return pendingDoc.data().chatUsername || null;
    }

    // Check users collection
    const usersRef = collection(db, "users");
    const q = query(
      usersRef,
      where("chatUsernameNormalized", "==", normalized),
      where("role", "in", ["dj", "broadcaster", "admin"])
    );
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      return snapshot.docs[0].data().chatUsername || null;
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
