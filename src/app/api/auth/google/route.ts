import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/google-calendar";
import { getAdminAuth } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
  try {
    // Get the Firebase ID token from Authorization header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const idToken = authHeader.split("Bearer ")[1];
    const adminAuth = getAdminAuth();

    if (!adminAuth) {
      return NextResponse.json(
        { error: "Server not configured" },
        { status: 500 }
      );
    }

    // Verify the Firebase token
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // Generate Google OAuth URL with user ID as state
    const authUrl = getAuthUrl(userId);

    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error("Error generating auth URL:", error);
    return NextResponse.json(
      { error: "Failed to generate auth URL" },
      { status: 500 }
    );
  }
}
