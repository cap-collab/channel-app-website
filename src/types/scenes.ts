import type { Timestamp } from 'firebase/firestore';

// Scene document in Firestore (collection: 'scenes')
// Doc id is used as the slug (e.g. 'spiral', 'star', 'grid').
export interface Scene {
  id: string;
  name: string;
  emoji: string;
  color: string; // Tailwind class trio, e.g. 'bg-amber-900/40 text-amber-300 border-amber-800'
  order: number;
  description?: string;
  createdAt: Timestamp | number;
  updatedAt: Timestamp | number;
}

// Serialized for API/SSR (timestamps as numbers)
export interface SceneSerialized {
  id: string;
  name: string;
  emoji: string;
  color: string;
  order: number;
  description?: string;
  createdAt: number;
  updatedAt: number;
}
