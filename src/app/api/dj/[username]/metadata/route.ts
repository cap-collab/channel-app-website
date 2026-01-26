import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const adminDb = getAdminDb();

  if (!adminDb) {
    return NextResponse.json({ displayName: null });
  }

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
      return NextResponse.json({
        displayName: pendingSnapshot.docs[0].data().chatUsername || null,
      });
    }

    // Check users collection
    const usersSnapshot = await adminDb
      .collection("users")
      .where("chatUsernameNormalized", "==", normalized)
      .where("role", "in", ["dj", "broadcaster", "admin"])
      .limit(1)
      .get();

    if (!usersSnapshot.empty) {
      return NextResponse.json({
        displayName: usersSnapshot.docs[0].data().chatUsername || null,
      });
    }

    return NextResponse.json({ displayName: null });
  } catch (error) {
    console.error("Error fetching DJ display name:", error);
    return NextResponse.json({ displayName: null });
  }
}
