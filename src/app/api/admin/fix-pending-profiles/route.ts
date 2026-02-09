import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

// One-off fix: patch pending-dj-profiles that are missing chatUsername
// and ensure all profiles have a corresponding entry in the usernames collection.
// Protected by CRON_SECRET for easy one-shot invocation.

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const pendingSnapshot = await db.collection("pending-dj-profiles").get();

    const results = {
      total: pendingSnapshot.size,
      fixedChatUsername: 0,
      fixedNormalized: 0,
      usernamesCreated: 0,
      usernamesAlreadyExist: 0,
      usernamesConflict: [] as string[],
      errors: [] as string[],
    };

    for (const doc of pendingSnapshot.docs) {
      const data = doc.data();
      let chatUsername = data.chatUsername as string | undefined;
      let chatUsernameNormalized = data.chatUsernameNormalized as string | undefined;
      const djName = data.djName as string | undefined;

      // Fix missing chatUsername: derive from chatUsernameNormalized or djName or doc ID
      if (!chatUsername) {
        const fallback = djName || chatUsernameNormalized || doc.id;
        try {
          await doc.ref.update({ chatUsername: fallback });
          chatUsername = fallback;
          results.fixedChatUsername++;
          console.log(`[fix-pending] Set chatUsername="${fallback}" for doc ${doc.id}`);
        } catch (err) {
          results.errors.push(`${doc.id} chatUsername fix failed: ${err}`);
          continue;
        }
      }

      // Fix missing chatUsernameNormalized
      if (!chatUsernameNormalized && chatUsername) {
        const normalized = chatUsername.replace(/\s+/g, "").toLowerCase();
        try {
          await doc.ref.update({ chatUsernameNormalized: normalized });
          chatUsernameNormalized = normalized;
          results.fixedNormalized++;
          console.log(`[fix-pending] Set chatUsernameNormalized="${normalized}" for doc ${doc.id}`);
        } catch (err) {
          results.errors.push(`${doc.id} normalized fix failed: ${err}`);
          continue;
        }
      }

      if (!chatUsernameNormalized) {
        results.errors.push(`${doc.id} - still no normalized username after fixes`);
        continue;
      }

      // Ensure username reservation exists
      const usernameRef = db.collection("usernames").doc(chatUsernameNormalized);
      const usernameDoc = await usernameRef.get();

      if (usernameDoc.exists) {
        const existing = usernameDoc.data();
        if (existing?.isPending) {
          results.usernamesAlreadyExist++;
        } else {
          results.usernamesConflict.push(`${chatUsername} → ${chatUsernameNormalized} (taken by uid: ${existing?.uid})`);
        }
      } else {
        const email = data.email as string | undefined;
        try {
          await usernameRef.set({
            displayName: chatUsername,
            usernameHandle: chatUsernameNormalized,
            uid: email ? `pending:${email}` : `pending:${doc.id}`,
            reservedForEmail: email || null,
            isPending: true,
            claimedAt: FieldValue.serverTimestamp(),
          });
          results.usernamesCreated++;
        } catch (err) {
          results.errors.push(`${chatUsernameNormalized} username creation failed: ${err}`);
        }
      }
    }

    console.log("[fix-pending] Results:", results);
    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    console.error("[fix-pending] Error:", error);
    return NextResponse.json({ error: "Failed to fix pending profiles" }, { status: 500 });
  }
}
