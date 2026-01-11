import { NextRequest, NextResponse } from "next/server";
import { isRestApiConfigured } from "@/lib/firebase-rest";

// Firebase REST API configuration
const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// Auth token cache
let authToken: string | null = null;
let tokenExpiry: number = 0;

async function getAuthToken(): Promise<string | null> {
  if (authToken && Date.now() < tokenExpiry) {
    return authToken;
  }

  const email = process.env.CRON_SERVICE_EMAIL;
  const password = process.env.CRON_SERVICE_PASSWORD;

  if (!email || !password || !FIREBASE_API_KEY) {
    console.error("Missing auth credentials");
    return null;
  }

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );

    if (!response.ok) {
      console.error("Auth failed:", await response.text());
      return null;
    }

    const data = await response.json();
    authToken = data.idToken;
    tokenExpiry = Date.now() + (parseInt(data.expiresIn) - 300) * 1000;
    return authToken;
  } catch (error) {
    console.error("Auth error:", error);
    return null;
  }
}

// Verify request has proper authorization
function verifyRequest(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

interface Favorite {
  docId: string;
  term: string;
  type: string;
  stationId?: string;
}

export async function POST(request: NextRequest) {
  // Require authorization
  if (!verifyRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isRestApiConfigured()) {
    return NextResponse.json(
      { error: "Firebase REST API not configured" },
      { status: 500 }
    );
  }

  const token = await getAuthToken();
  if (!token) {
    return NextResponse.json(
      { error: "Failed to authenticate" },
      { status: 500 }
    );
  }

  try {
    // Get all users
    const usersResponse = await fetch(
      `${FIRESTORE_BASE_URL}/users?pageSize=1000`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!usersResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch users" },
        { status: 500 }
      );
    }

    const usersData = await usersResponse.json();
    const users = usersData.documents || [];

    let totalDeleted = 0;
    let usersProcessed = 0;
    const deletions: Array<{ userId: string; docId: string; term: string; error?: string }> = [];

    for (const userDoc of users) {
      // Extract userId from document path
      const pathParts = userDoc.name.split("/");
      const userId = pathParts[pathParts.length - 1];

      // Get user's favorites
      const favoritesResponse = await fetch(
        `${FIRESTORE_BASE_URL}/users/${userId}/favorites?pageSize=500`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!favoritesResponse.ok) {
        console.error(`Failed to fetch favorites for user ${userId}`);
        continue;
      }

      const favoritesData = await favoritesResponse.json();
      const favoriteDocs = favoritesData.documents || [];

      // Parse all favorites
      const favorites: Favorite[] = favoriteDocs.map((doc: { name: string; fields?: Record<string, { stringValue?: string }> }) => {
        const fields = doc.fields || {};
        const docPathParts = doc.name.split("/");
        return {
          docId: docPathParts[docPathParts.length - 1],
          term: (fields.term?.stringValue || "").toLowerCase().trim(),
          type: fields.type?.stringValue || "",
          stationId: fields.stationId?.stringValue,
        };
      });

      // Find show favorites (type="show" with stationId)
      const showTerms = new Set(
        favorites
          .filter((f) => f.type === "show" && f.stationId)
          .map((f) => f.term)
      );

      // Find watchlist items (type="search") that duplicate show favorites
      const duplicateWatchlist = favorites.filter(
        (f) => f.type === "search" && showTerms.has(f.term)
      );

      // Delete duplicates
      for (const dup of duplicateWatchlist) {
        const deleteResponse = await fetch(
          `${FIRESTORE_BASE_URL}/users/${userId}/favorites/${dup.docId}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (deleteResponse.ok) {
          totalDeleted++;
          deletions.push({ userId, docId: dup.docId, term: dup.term });
          console.log(`Deleted duplicate watchlist item for user ${userId}: "${dup.term}"`);
        } else {
          const errorText = await deleteResponse.text();
          console.error(`Failed to delete ${dup.docId} for user ${userId}: ${errorText}`);
          deletions.push({ userId, docId: dup.docId, term: dup.term, error: errorText });
        }
      }

      usersProcessed++;
    }

    return NextResponse.json({
      success: true,
      usersProcessed,
      totalDeleted,
      deletions,
    });
  } catch (error) {
    console.error("Dedup error:", error);
    return NextResponse.json(
      { error: "Dedup failed", details: String(error) },
      { status: 500 }
    );
  }
}

// GET endpoint for dry-run
export async function GET(request: NextRequest) {
  // Require authorization
  if (!verifyRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isRestApiConfigured()) {
    return NextResponse.json(
      { error: "Firebase REST API not configured" },
      { status: 500 }
    );
  }

  const token = await getAuthToken();
  if (!token) {
    return NextResponse.json(
      { error: "Failed to authenticate" },
      { status: 500 }
    );
  }

  try {
    // Get all users
    const usersResponse = await fetch(
      `${FIRESTORE_BASE_URL}/users?pageSize=1000`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!usersResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch users" },
        { status: 500 }
      );
    }

    const usersData = await usersResponse.json();
    const users = usersData.documents || [];

    let usersProcessed = 0;
    const duplicates: Array<{ userId: string; docId: string; watchlistTerm: string; matchingShowTerm: string }> = [];

    for (const userDoc of users) {
      // Extract userId from document path
      const pathParts = userDoc.name.split("/");
      const userId = pathParts[pathParts.length - 1];

      // Get user's favorites
      const favoritesResponse = await fetch(
        `${FIRESTORE_BASE_URL}/users/${userId}/favorites?pageSize=500`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!favoritesResponse.ok) {
        console.error(`Failed to fetch favorites for user ${userId}`);
        continue;
      }

      const favoritesData = await favoritesResponse.json();
      const favoriteDocs = favoritesData.documents || [];

      // Parse all favorites
      const favorites = favoriteDocs.map((doc: { name: string; fields?: Record<string, { stringValue?: string }> }) => {
        const fields = doc.fields || {};
        const docPathParts = doc.name.split("/");
        return {
          docId: docPathParts[docPathParts.length - 1],
          term: (fields.term?.stringValue || "").toLowerCase().trim(),
          originalTerm: fields.term?.stringValue || "",
          type: fields.type?.stringValue || "",
          stationId: fields.stationId?.stringValue,
        };
      });

      // Find show favorites (type="show" with stationId)
      const showFavorites = favorites.filter(
        (f: { type: string; stationId?: string }) => f.type === "show" && f.stationId
      );
      const showTerms = new Set(showFavorites.map((f: { term: string }) => f.term));

      // Find watchlist items (type="search") that duplicate show favorites
      const duplicateWatchlist = favorites.filter(
        (f: { type: string; term: string }) => f.type === "search" && showTerms.has(f.term)
      );

      for (const dup of duplicateWatchlist) {
        duplicates.push({
          userId,
          docId: dup.docId,
          watchlistTerm: dup.originalTerm,
          matchingShowTerm: showFavorites.find((s: { term: string }) => s.term === dup.term)?.originalTerm || dup.term,
        });
      }

      usersProcessed++;
    }

    return NextResponse.json({
      dryRun: true,
      usersProcessed,
      duplicateCount: duplicates.length,
      duplicates,
      message: "Use POST to delete these duplicate watchlist items",
    });
  } catch (error) {
    console.error("Dry-run error:", error);
    return NextResponse.json(
      { error: "Dry-run failed", details: String(error) },
      { status: 500 }
    );
  }
}
