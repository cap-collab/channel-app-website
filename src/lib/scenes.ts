import { getAdminDb } from '@/lib/firebase-admin';
import type { Scene, SceneSerialized } from '@/types/scenes';

export const SCENES_COLLECTION = 'scenes';

export const DEFAULT_SCENE_PILL_ACTIVE =
  'bg-gray-700 text-gray-100 border-gray-500';
export const DEFAULT_SCENE_PILL_INACTIVE =
  'bg-gray-800/50 text-gray-500 border-gray-700 hover:text-gray-300';

type SceneSource = { sceneIds?: string[] };
type ContentWithOverride = { sceneIdsOverride?: string[] | null };

/**
 * Resolve the effective scenes for a piece of content (archive/event/slot).
 *
 * - Override set (array, possibly empty) → use override verbatim.
 * - Override null/undefined → union of sceneIds from all sources (DJs + collectives).
 */
export function resolveScenes(
  item: ContentWithOverride,
  sources: SceneSource[]
): string[] {
  if (item.sceneIdsOverride !== undefined && item.sceneIdsOverride !== null) {
    return item.sceneIdsOverride;
  }
  const merged = new Set<string>();
  for (const src of sources) {
    for (const id of src.sceneIds ?? []) merged.add(id);
  }
  return Array.from(merged);
}

function toMillis(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'toMillis' in v && typeof (v as { toMillis: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function serializeScene(id: string, data: Record<string, unknown>): SceneSerialized {
  return {
    id,
    name: String(data.name ?? ''),
    emoji: String(data.emoji ?? ''),
    color: String(data.color ?? DEFAULT_SCENE_PILL_ACTIVE),
    order: typeof data.order === 'number' ? data.order : 0,
    description: typeof data.description === 'string' ? data.description : undefined,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

/** Server-side: fetch all scenes sorted by order. Returns [] if Firestore unavailable. */
export async function fetchAllScenesServer(): Promise<SceneSerialized[]> {
  const db = getAdminDb();
  if (!db) return [];
  const snap = await db.collection(SCENES_COLLECTION).get();
  const scenes: SceneSerialized[] = [];
  snap.forEach((doc) => scenes.push(serializeScene(doc.id, doc.data())));
  scenes.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return scenes;
}

/** Server-side: fetch a scene by its id/slug. */
export async function fetchSceneBySlugServer(slug: string): Promise<SceneSerialized | null> {
  const db = getAdminDb();
  if (!db) return null;
  const doc = await db.collection(SCENES_COLLECTION).doc(slug).get();
  if (!doc.exists) return null;
  return serializeScene(doc.id, doc.data() ?? {});
}

export type { Scene };
