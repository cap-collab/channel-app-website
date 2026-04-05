import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

// Token-based unsubscribe for non-account users (e.g. radio-notify-waitlist)
// GET /api/unsubscribe?token=BASE64(email)&list=waitlist
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const list = request.nextUrl.searchParams.get("list");

  if (!token || !list) {
    return NextResponse.redirect(new URL("/unsubscribe?status=invalid", request.url));
  }

  let email: string;
  try {
    email = Buffer.from(token, "base64").toString("utf-8").trim().toLowerCase();
    if (!email || !email.includes("@")) throw new Error("Invalid email");
  } catch {
    return NextResponse.redirect(new URL("/unsubscribe?status=invalid", request.url));
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.redirect(new URL("/unsubscribe?status=error", request.url));
  }

  try {
    if (list === "waitlist") {
      // Find the waitlist doc(s) for this email and mark as unsubscribed
      const snapshot = await db
        .collection("radio-notify-waitlist")
        .where("email", "==", email)
        .get();

      if (snapshot.empty) {
        return NextResponse.redirect(new URL("/unsubscribe?status=not_found", request.url));
      }

      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.update(doc.ref, { unsubscribed: true, unsubscribedAt: new Date() });
      });
      await batch.commit();

      return NextResponse.redirect(new URL("/unsubscribe?status=success", request.url));
    }

    return NextResponse.redirect(new URL("/unsubscribe?status=invalid", request.url));
  } catch (error) {
    console.error("Error processing unsubscribe:", error);
    return NextResponse.redirect(new URL("/unsubscribe?status=error", request.url));
  }
}
