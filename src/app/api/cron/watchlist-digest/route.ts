import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { sendWatchlistDigestEmail } from "@/lib/email";
import { FieldValue } from "firebase-admin/firestore";

// Verify cron secret for security
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return false;
  }
  return true;
}

interface Show {
  id: string;
  name: string;
  dj?: string;
  startTime: string;
  endTime: string;
  stationId: string;
}

interface StationMetadata {
  shows: Show[];
}

interface Metadata {
  [stationKey: string]: StationMetadata;
}

const STATION_NAMES: Record<string, string> = {
  nts1: "NTS 1",
  nts2: "NTS 2",
  rinse: "Rinse FM",
  rinsefr: "Rinse FR",
  dublab: "dublab",
  subtle: "Subtle Radio",
};

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminDb = getAdminDb();
  if (!adminDb) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 500 }
    );
  }

  try {
    // Fetch current metadata
    const metadataResponse = await fetch(
      "https://cap-collab.github.io/channel-metadata/metadata.json",
      { next: { revalidate: 0 } }
    );

    if (!metadataResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch metadata" },
        { status: 500 }
      );
    }

    const metadata: Metadata = await metadataResponse.json();

    // Get all shows from all stations
    const allShows: Array<Show & { stationName: string }> = [];
    for (const [stationKey, stationData] of Object.entries(metadata)) {
      if (stationData.shows) {
        for (const show of stationData.shows) {
          allShows.push({
            ...show,
            stationId: stationKey,
            stationName: STATION_NAMES[stationKey] || stationKey,
          });
        }
      }
    }

    // Get all users with watchlist notifications enabled
    const usersSnapshot = await adminDb
      .collection("users")
      .where("emailNotifications.watchlistMatch", "==", true)
      .get();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let emailsSent = 0;
    let usersProcessed = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const userId = userDoc.id;

      // Check if we already sent a digest today
      const lastEmailAt = userData.lastWatchlistEmailAt?.toDate();
      if (lastEmailAt && lastEmailAt >= today) {
        continue; // Already sent today
      }

      // Get user's watchlist (search type favorites)
      const favoritesSnapshot = await adminDb
        .collection("users")
        .doc(userId)
        .collection("favorites")
        .where("type", "==", "search")
        .get();

      const watchlistTerms = favoritesSnapshot.docs.map(
        (doc) => doc.data().term
      );

      if (watchlistTerms.length === 0) {
        continue;
      }

      // Find matching shows
      const since = userData.lastWatchlistEmailAt?.toDate() || new Date(0);
      const matches: Array<{
        showName: string;
        djName?: string;
        stationName: string;
        startTime: Date;
        searchTerm: string;
      }> = [];

      for (const show of allShows) {
        const showStart = new Date(show.startTime);

        // Only include future shows or shows from since last email
        if (showStart < since) continue;

        for (const term of watchlistTerms) {
          const termLower = term.toLowerCase();
          if (
            show.name.toLowerCase().includes(termLower) ||
            show.dj?.toLowerCase().includes(termLower)
          ) {
            matches.push({
              showName: show.name,
              djName: show.dj,
              stationName: show.stationName,
              startTime: showStart,
              searchTerm: term,
            });
            break; // Don't add same show multiple times
          }
        }
      }

      if (matches.length > 0) {
        // Sort by start time
        matches.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

        // Send digest email (max 10 matches)
        const success = await sendWatchlistDigestEmail({
          to: userData.email,
          matches: matches.slice(0, 10),
        });

        if (success) {
          await userDoc.ref.update({
            lastWatchlistEmailAt: FieldValue.serverTimestamp(),
          });
          emailsSent++;
        }
      }

      usersProcessed++;
    }

    return NextResponse.json({
      usersProcessed,
      emailsSent,
    });
  } catch (error) {
    console.error("Error in watchlist-digest cron:", error);
    return NextResponse.json(
      { error: "Failed to process watchlist digest" },
      { status: 500 }
    );
  }
}
