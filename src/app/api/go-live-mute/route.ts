import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";

// Per-DJ go-live mute, linked from every show-starting email footer.
// GET /api/go-live-mute?token=BASE64("uid:djUsername")
//
// One click adds djUsername to users/{uid}.goLiveMutes. The show-starting
// cron checks that array in every match path (favorite, watchlist,
// affiliated, engagement), so the user stops getting go-live emails for
// this DJ specifically — other DJs and other notification categories are
// untouched.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(
      new URL("/unsubscribe?status=invalid", request.url),
    );
  }

  let userId: string;
  let djUsername: string;
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const idx = decoded.indexOf(":");
    if (idx <= 0 || idx >= decoded.length - 1) throw new Error("malformed");
    userId = decoded.slice(0, idx);
    djUsername = decoded.slice(idx + 1);
    if (!userId || !djUsername) throw new Error("empty parts");
  } catch {
    return NextResponse.redirect(
      new URL("/unsubscribe?status=invalid", request.url),
    );
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.redirect(
      new URL("/unsubscribe?status=error", request.url),
    );
  }

  try {
    await db.collection("users").doc(userId).set(
      { goLiveMutes: FieldValue.arrayUnion(djUsername) },
      { merge: true },
    );

    const target = new URL("/unsubscribe", request.url);
    target.searchParams.set("status", "success");
    target.searchParams.set("category", "go-live");
    target.searchParams.set("dj", djUsername);
    return NextResponse.redirect(target);
  } catch (error) {
    console.error("Error muting go-live notifications:", error);
    return NextResponse.redirect(
      new URL("/unsubscribe?status=error", request.url),
    );
  }
}
