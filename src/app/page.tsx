import { redirect } from "next/navigation";

// Known scene slugs that can appear as bare query keys (e.g. /?spiral).
// Matches the scene IDs rendered by SceneGlyph and seeded in Firestore.
const SCENE_SLUGS = new Set(["spiral", "diamond", "grid"]);

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // Support both /?scene=spiral and the shorter /?spiral
  let scene: string | null = null;
  const sceneParam = params.scene;
  if (typeof sceneParam === "string" && SCENE_SLUGS.has(sceneParam)) {
    scene = sceneParam;
  } else {
    for (const key of Object.keys(params)) {
      if (SCENE_SLUGS.has(key)) {
        scene = key;
        break;
      }
    }
  }

  redirect(scene ? `/radio?scene=${scene}` : "/radio");
}
