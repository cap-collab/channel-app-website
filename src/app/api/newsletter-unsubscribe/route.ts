import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

// Category-based one-click unsubscribe for channel-wide newsletter.
//
// Token format: base64(email) — the category is passed as a separate
// query param so the same token can be reused across cohorts if we
// ever change a recipient's role.
//
// Handles:
//   GET  /api/newsletter-unsubscribe?token=...&c=dj|marketing
//   POST /api/newsletter-unsubscribe                   (Gmail One-Click)
//        body: List-Unsubscribe=One-Click  (RFC 8058)
//        — same query string on the URL

type Category = "dj" | "marketing";

function decodeToken(token: string): string | null {
  try {
    const email = Buffer.from(token, "base64").toString("utf-8").trim().toLowerCase();
    if (!email || !email.includes("@")) return null;
    return email;
  } catch {
    return null;
  }
}

async function applyUnsubscribe(email: string, category: Category): Promise<"updated" | "not_found"> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured");

  let touched = false;

  // 1) users collection — authenticated accounts.
  const usersSnap = await db.collection("users").where("email", "==", email).get();
  if (!usersSnap.empty) {
    const batch = db.batch();
    for (const doc of usersSnap.docs) {
      if (category === "dj") {
        batch.update(doc.ref, {
          "emailNotifications.djInsiders": false,
          "emailNotifications.marketing": false,
        });
      } else {
        batch.update(doc.ref, {
          "emailNotifications.marketing": false,
        });
      }
    }
    await batch.commit();
    touched = true;
  }

  // 2) pending-dj-profiles — DJs without an account yet.
  const pendingSnap = await db
    .collection("pending-dj-profiles")
    .where("email", "==", email)
    .get();
  if (!pendingSnap.empty) {
    const batch = db.batch();
    pendingSnap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        unsubscribed: true,
        unsubscribedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    touched = true;
  }

  // 3) radio-notify-waitlist — accountless listeners.
  const waitlistSnap = await db
    .collection("radio-notify-waitlist")
    .where("email", "==", email)
    .get();
  if (!waitlistSnap.empty) {
    const batch = db.batch();
    waitlistSnap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        unsubscribed: true,
        unsubscribedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    touched = true;
  }

  return touched ? "updated" : "not_found";
}

function parseRequest(request: NextRequest): { email: string | null; category: Category } {
  const token = request.nextUrl.searchParams.get("token");
  const cParam = request.nextUrl.searchParams.get("c");
  const category: Category = cParam === "dj" ? "dj" : "marketing";
  const email = token ? decodeToken(token) : null;
  return { email, category };
}

export async function GET(request: NextRequest) {
  const { email, category } = parseRequest(request);
  if (!email) {
    return NextResponse.redirect(new URL("/unsubscribe?status=invalid", request.url));
  }
  try {
    const result = await applyUnsubscribe(email, category);
    const status = result === "updated" ? "success" : "not_found";
    return NextResponse.redirect(
      new URL(`/unsubscribe?status=${status}&category=${category}`, request.url),
    );
  } catch (err) {
    console.error("newsletter-unsubscribe GET:", err);
    return NextResponse.redirect(new URL("/unsubscribe?status=error", request.url));
  }
}

// Gmail / Apple Mail One-Click (RFC 8058).
// Body is form-encoded `List-Unsubscribe=One-Click`; we ignore the body
// and trust the token/category query params.
export async function POST(request: NextRequest) {
  const { email, category } = parseRequest(request);
  if (!email) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }
  try {
    await applyUnsubscribe(email, category);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("newsletter-unsubscribe POST:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
