import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

// Valid chatUsername: letters, numbers, and spaces only (same as register-username)
function isValidChatUsername(name: string): boolean {
  return /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(name);
}

// One-off fix: patch pending-dj-profiles that have missing or invalid chatUsername
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
      fixedInvalidChatUsername: 0,
      fixedNormalized: 0,
      usernamesCreated: 0,
      usernamesFixed: 0,
      usernamesAlreadyExist: 0,
      usernamesConflict: [] as string[],
      errors: [] as string[],
    };

    for (const doc of pendingSnapshot.docs) {
      const data = doc.data();
      let chatUsername = data.chatUsername as string | undefined;
      let chatUsernameNormalized = data.chatUsernameNormalized as string | undefined;

      // Fix missing chatUsernameNormalized first (needed for everything else)
      if (!chatUsernameNormalized) {
        if (chatUsername) {
          chatUsernameNormalized = chatUsername.replace(/\s+/g, "").toLowerCase();
        } else {
          chatUsernameNormalized = doc.id;
        }
        try {
          await doc.ref.update({ chatUsernameNormalized });
          results.fixedNormalized++;
        } catch (err) {
          results.errors.push(`${doc.id} normalized fix failed: ${err}`);
          continue;
        }
      }

      // Fix missing or invalid chatUsername
      // chatUsername must be a valid display name (letters, numbers, spaces)
      // If it's invalid (e.g. "COPYPASTE w/ KLS.RDR"), replace with chatUsernameNormalized
      if (!chatUsername) {
        chatUsername = chatUsernameNormalized;
        try {
          await doc.ref.update({ chatUsername });
          results.fixedChatUsername++;
        } catch (err) {
          results.errors.push(`${doc.id} chatUsername fix failed: ${err}`);
          continue;
        }
      } else if (!isValidChatUsername(chatUsername)) {
        // chatUsername has invalid chars — replace with chatUsernameNormalized
        chatUsername = chatUsernameNormalized;
        try {
          await doc.ref.update({ chatUsername });
          results.fixedInvalidChatUsername++;
        } catch (err) {
          results.errors.push(`${doc.id} invalid chatUsername fix failed: ${err}`);
          continue;
        }
      }

      // Ensure username reservation exists and has correct displayName
      const usernameRef = db.collection("usernames").doc(chatUsernameNormalized);
      const usernameDoc = await usernameRef.get();

      if (usernameDoc.exists) {
        const existing = usernameDoc.data();
        if (existing?.isPending) {
          // Fix displayName if it doesn't match chatUsername
          if (existing.displayName !== chatUsername) {
            try {
              await usernameRef.update({ displayName: chatUsername });
              results.usernamesFixed++;
            } catch (err) {
              results.errors.push(`${chatUsernameNormalized} username displayName fix failed: ${err}`);
            }
          } else {
            results.usernamesAlreadyExist++;
          }
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
