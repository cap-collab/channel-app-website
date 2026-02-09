import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;

  if (!username) {
    return new NextResponse(null, { status: 400 });
  }

  const adminDb = getAdminDb();
  if (!adminDb) {
    return new NextResponse(null, { status: 503 });
  }

  // Look up DJ photo URL from Firestore
  let photoUrl: string | undefined;

  try {
    // Try users collection first (claimed profiles)
    const usersSnapshot = await adminDb
      .collection("users")
      .where("chatUsernameNormalized", "==", username)
      .limit(1)
      .get();

    if (!usersSnapshot.empty) {
      const djProfile = usersSnapshot.docs[0].data()?.djProfile;
      photoUrl = djProfile?.photoUrl || undefined;
    }

    // Fall back to pending-dj-profiles
    if (!photoUrl) {
      const pendingSnapshot = await adminDb
        .collection("pending-dj-profiles")
        .where("chatUsernameNormalized", "==", username)
        .limit(1)
        .get();

      if (!pendingSnapshot.empty) {
        const djProfile = pendingSnapshot.docs[0].data()?.djProfile;
        photoUrl = djProfile?.photoUrl || undefined;
      }
    }
  } catch (error) {
    console.error(`[dj-photo] Firestore lookup failed for ${username}:`, error);
    return new NextResponse(null, { status: 500 });
  }

  if (!photoUrl) {
    return new NextResponse(null, { status: 404 });
  }

  // Fetch the image from the source URL and proxy it
  try {
    const imageResponse = await fetch(photoUrl);

    if (!imageResponse.ok) {
      return new NextResponse(null, { status: 404 });
    }

    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    const imageBuffer = await imageResponse.arrayBuffer();

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error(`[dj-photo] Failed to fetch image for ${username}:`, error);
    return new NextResponse(null, { status: 502 });
  }
}
