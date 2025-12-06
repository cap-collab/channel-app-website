import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth, Auth } from "firebase-admin/auth";

let adminApp: App | null = null;
let adminDb: Firestore | null = null;
let adminAuth: Auth | null = null;

function initializeAdminApp() {
  if (adminApp) return adminApp;

  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;

  if (!privateKey || !projectId || !clientEmail) {
    console.warn("Firebase Admin SDK not configured");
    return null;
  }

  if (getApps().length === 0) {
    adminApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    });
  } else {
    adminApp = getApps()[0];
  }

  return adminApp;
}

export function getAdminDb(): Firestore | null {
  if (adminDb) return adminDb;
  const app = initializeAdminApp();
  if (!app) return null;
  adminDb = getFirestore(app);
  return adminDb;
}

export function getAdminAuth(): Auth | null {
  if (adminAuth) return adminAuth;
  const app = initializeAdminApp();
  if (!app) return null;
  adminAuth = getAuth(app);
  return adminAuth;
}
