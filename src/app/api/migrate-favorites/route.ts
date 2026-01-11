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

    let totalFixed = 0;
    let usersProcessed = 0;
    const changes: Array<{ userId: string; docId: string; term: string; error?: string }> = [];

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
      const favorites = favoritesData.documents || [];

      for (const favDoc of favorites) {
        const fields = favDoc.fields || {};
        const type = fields.type?.stringValue;
        const stationId = fields.stationId?.stringValue;
        const term = fields.term?.stringValue || "unknown";

        // Find favorites with type="show" but no stationId
        if (type === "show" && !stationId) {
          // Extract document ID
          const docPathParts = favDoc.name.split("/");
          const docId = docPathParts[docPathParts.length - 1];

          // Update to type="search" (proper watchlist type)
          const updateResponse = await fetch(
            `${FIRESTORE_BASE_URL}/users/${userId}/favorites/${docId}?updateMask.fieldPaths=type`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                fields: {
                  type: { stringValue: "search" },
                },
              }),
            }
          );

          if (updateResponse.ok) {
            totalFixed++;
            changes.push({ userId, docId, term });
            console.log(`Fixed favorite for user ${userId}: "${term}" -> type="search"`);
          } else {
            const errorText = await updateResponse.text();
            console.error(`Failed to update favorite ${docId} for user ${userId}: ${errorText}`);
            changes.push({ userId, docId, term, error: errorText });
          }
        }
      }

      usersProcessed++;
    }

    // Add debug info
    let totalFavorites = 0;
    let showTypeFavorites = 0;

    // Rescan to count for debugging
    for (const userDoc of users) {
      const pathParts = userDoc.name.split("/");
      const userId = pathParts[pathParts.length - 1];
      const favoritesResponse = await fetch(
        `${FIRESTORE_BASE_URL}/users/${userId}/favorites?pageSize=500`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (favoritesResponse.ok) {
        const favData = await favoritesResponse.json();
        const favs = favData.documents || [];
        totalFavorites += favs.length;
        for (const fav of favs) {
          if (fav.fields?.type?.stringValue === "show") {
            showTypeFavorites++;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      usersProcessed,
      totalFixed,
      changes,
      debug: { totalFavorites, showTypeFavorites },
    });
  } catch (error) {
    console.error("Migration error:", error);
    return NextResponse.json(
      { error: "Migration failed", details: String(error) },
      { status: 500 }
    );
  }
}

// GET endpoint for dry-run (just reports what would be fixed)
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
    const invalidFavorites: Array<{ userId: string; docId: string; term: string; type: string }> = [];

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
      const favorites = favoritesData.documents || [];

      for (const favDoc of favorites) {
        const fields = favDoc.fields || {};
        const type = fields.type?.stringValue;
        const stationId = fields.stationId?.stringValue;
        const term = fields.term?.stringValue || "unknown";

        // Find favorites with type="show" but no stationId
        if (type === "show" && !stationId) {
          const docPathParts = favDoc.name.split("/");
          const docId = docPathParts[docPathParts.length - 1];
          invalidFavorites.push({ userId, docId, term, type });
        }
      }

      usersProcessed++;
    }

    return NextResponse.json({
      dryRun: true,
      usersProcessed,
      invalidFavoritesCount: invalidFavorites.length,
      invalidFavorites,
      message: "Use POST to actually fix these entries",
    });
  } catch (error) {
    console.error("Dry-run error:", error);
    return NextResponse.json(
      { error: "Dry-run failed", details: String(error) },
      { status: 500 }
    );
  }
}
