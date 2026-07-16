import type { User } from "firebase/auth";
import { auth } from "@/lib/firebase";

/**
 * Capture the CURRENT anonymous session's identity so it can be merged into a
 * real account after sign-in. Call this at the TOP of a sign-in handler, BEFORE
 * any sign-in or account-creation call, afterward `auth.currentUser` is the real
 * account and the anon uid + token are unrecoverable.
 *
 * Returns null when there's no anonymous session to merge from (already a real
 * account, or no session).
 */
export async function captureAnon(): Promise<{ uid: string; idToken: string } | null> {
  const cur = auth?.currentUser;
  if (!cur?.isAnonymous) return null;
  try {
    const idToken = await cur.getIdToken();
    return { uid: cur.uid, idToken };
  } catch {
    return null;
  }
}

/**
 * Fold a captured anon session's history into the real account `toUser` just
 * signed into. Best-effort and NON-FATAL by contract: any failure is swallowed
 * so it can NEVER block or derail the sign-in. Safe to call when `anon` is null
 * (no-op) or when uid === toUser.uid (server guards it as a self-merge no-op).
 */
export async function mergeAnonHistory(
  anon: { uid: string; idToken: string } | null,
  toUser: User,
): Promise<void> {
  if (!anon || anon.uid === toUser.uid) return;
  try {
    const toIdToken = await toUser.getIdToken();
    await fetch("/api/users/merge-anon-history", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${toIdToken}` },
      body: JSON.stringify({ fromUid: anon.uid, fromIdToken: anon.idToken }),
    });
  } catch (err) {
    console.error("[merge-anon-history] non-fatal:", err); // never rethrow
  }
}
