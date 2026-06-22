import type { Firestore } from "firebase-admin/firestore";
import { normalizeUsername } from "@/lib/dj-matching";
import type { ArchiveDJ } from "@/types/broadcast";

// Resolve an archive's scene slugs from its DJs' profiles. The scene of a show
// lives on the DJ profile (djProfile.sceneIds), so a newly-created archive
// should inherit the union of its DJs' scenes. Looks up `users` first, then
// `pending-dj-profiles`, by chatUsernameNormalized (and by userId for users).
//
// Server-only (firebase-admin). Used by the archive-creation paths so every new
// archive carries sceneSlugs, and by the one-off backfill for existing archives.
export async function resolveSceneSlugsForArchive(
  db: Firestore,
  djs: ArchiveDJ[],
): Promise<string[]> {
  const scenes = new Set<string>();

  for (const dj of djs) {
    let sceneIds: string[] | undefined;

    // Prefer a direct userId lookup in `users`.
    if (dj.userId) {
      const u = await db.collection("users").doc(dj.userId).get();
      if (u.exists) {
        sceneIds = (u.data()?.djProfile as Record<string, unknown> | undefined)?.sceneIds as
          | string[]
          | undefined;
      }
    }

    // Else resolve by normalized chatUsername in users → pending-dj-profiles.
    if ((!sceneIds || sceneIds.length === 0) && dj.username) {
      const norm = normalizeUsername(dj.username);
      for (const coll of ["users", "pending-dj-profiles"]) {
        const q = await db
          .collection(coll)
          .where("chatUsernameNormalized", "==", norm)
          .limit(1)
          .get();
        if (!q.empty) {
          sceneIds = (q.docs[0].data()?.djProfile as Record<string, unknown> | undefined)?.sceneIds as
            | string[]
            | undefined;
          if (sceneIds && sceneIds.length > 0) break;
        }
      }
    }

    for (const s of sceneIds ?? []) if (typeof s === "string") scenes.add(s);
  }

  return Array.from(scenes);
}
