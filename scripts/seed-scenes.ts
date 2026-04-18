/**
 * Seed the three initial scenes: Spiral, Diamond, Grid.
 *
 * Run with:
 *   set -a && source .env.production && set +a && \
 *   npx ts-node -O '{"module":"commonjs"}' --skip-project scripts/seed-scenes.ts
 *
 * Reads FIREBASE_ADMIN_PRIVATE_KEY, FIREBASE_ADMIN_CLIENT_EMAIL, and
 * NEXT_PUBLIC_FIREBASE_PROJECT_ID from the environment.
 * Safe to re-run — will skip any scene whose doc id already exists.
 */

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

if (!admin.apps.length) {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'Missing credentials. Need NEXT_PUBLIC_FIREBASE_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY.'
    );
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

const db = admin.firestore();

interface SeedScene {
  id: string;
  name: string;
  emoji: string;
  color: string;
  order: number;
  description: string;
}

const SCENES: SeedScene[] = [
  {
    id: 'spiral',
    name: 'Spiral',
    emoji: '🌀',
    color: 'bg-amber-900/40 text-amber-300 border-amber-800',
    order: 0,
    description: '',
  },
  {
    id: 'diamond',
    name: 'Diamond',
    emoji: '💎',
    color: 'bg-fuchsia-900/40 text-fuchsia-300 border-fuchsia-800',
    order: 1,
    description: '',
  },
  {
    id: 'grid',
    name: 'Grid',
    emoji: '▦',
    color: 'bg-black text-gray-200 border-gray-700',
    order: 2,
    description: '',
  },
];

async function seedScenes() {
  for (const scene of SCENES) {
    const ref = db.collection('scenes').doc(scene.id);
    const existing = await ref.get();
    if (existing.exists) {
      console.log(`[skip] scene "${scene.id}" already exists`);
      continue;
    }
    await ref.set({
      name: scene.name,
      emoji: scene.emoji,
      color: scene.color,
      order: scene.order,
      description: scene.description,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`[created] ${scene.emoji} ${scene.name} (id: ${scene.id})`);
  }
}

seedScenes()
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Failed to seed scenes:', err);
    process.exit(1);
  });
