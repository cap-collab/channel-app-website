import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, OAuthProvider, Auth } from "firebase/auth";
import { initializeFirestore, getFirestore, Firestore } from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebasestorage.app`,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Check if Firebase is configured
const isConfigured = Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);

// Initialize Firebase (prevent multiple instances)
let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let googleProvider: GoogleAuthProvider | null = null;
let appleProvider: OAuthProvider | null = null;

if (isConfigured) {
  const isFresh = getApps().length === 0;
  app = isFresh ? initializeApp(firebaseConfig) : getApps()[0];
  auth = getAuth(app);
  // Auto-detect long-polling. Default WebChannel transport silently hangs on
  // some mobile networks / carrier proxies (handshake never completes, the
  // promise never settles, sections below the hero never render). With this
  // flag the SDK probes and falls back to long-polling when WebChannel is
  // blocked. Must run on first init only — calling initializeFirestore after
  // getFirestore on the same app throws "already initialized".
  db = isFresh
    ? initializeFirestore(app, { experimentalAutoDetectLongPolling: true })
    : getFirestore(app);
  storage = getStorage(app);
  googleProvider = new GoogleAuthProvider();
  appleProvider = new OAuthProvider("apple.com");
  appleProvider.addScope("email");
  appleProvider.addScope("name");
}

export { auth, db, storage, googleProvider, appleProvider };
export default app;
