import { NextRequest, NextResponse } from "next/server";
import { sendWatchlistDigestEmail } from "@/lib/email";
import {
  queryUsersWhere,
  getUserFavorites,
  getUser,
  updateUser,
  addUserFavorite,
  isRestApiConfigured,
} from "@/lib/firebase-rest";

// Verify request is from Vercel Cron
function verifyCronRequest(request: NextRequest): boolean {
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const authHeader = request.headers.get("authorization");
  const hasValidSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  return isVercelCron || hasValidSecret;
}

// Metadata uses short keys
interface MetadataShow {
  n: string;
  s: string;
  e: string;
  j?: string | null;
}

interface Metadata {
  v: number;
  updated: string;
  stations: {
    [stationKey: string]: MetadataShow[];
  };
}

interface Show {
  name: string;
  dj?: string;
  startTime: string;
  stationId: string;
  stationName: string;
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
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isRestApiConfigured()) {
    return NextResponse.json(
      { error: "Firebase REST API not configured" },
      { status: 500 }
    );
  }

  try {
    // Fetch current metadata
    const metadataResponse = await fetch(
      "https://cap-collab.github.io/channel-metadata/metadata.json",
      { cache: "no-store" }
    );

    if (!metadataResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch metadata" },
        { status: 500 }
      );
    }

    const metadata: Metadata = await metadataResponse.json();

    // Get all shows from all stations
    const allShows: Show[] = [];
    for (const [stationKey, shows] of Object.entries(metadata.stations)) {
      if (Array.isArray(shows)) {
        for (const show of shows) {
          allShows.push({
            name: show.n,
            dj: show.j || undefined,
            startTime: show.s,
            stationId: stationKey,
            stationName: STATION_NAMES[stationKey] || stationKey,
          });
        }
      }
    }

    // Get all users with watchlist notifications enabled
    const users = await queryUsersWhere("emailNotifications.watchlistMatch", "EQUAL", true);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let emailsSent = 0;
    let usersProcessed = 0;

    for (const user of users) {
      const userData = await getUser(user.id);
      if (!userData) continue;

      // Check if we already sent a digest today
      const lastEmailAt = userData.lastWatchlistEmailAt as Date | string | undefined;
      if (lastEmailAt && new Date(lastEmailAt) >= today) {
        continue; // Already sent today
      }

      // Get user's watchlist (search type favorites)
      const favorites = await getUserFavorites(user.id, "search");
      const watchlistDocs = favorites.map((doc) => ({
        id: doc.id,
        term: doc.data.term as string,
      }));

      if (watchlistDocs.length === 0) {
        continue;
      }

      // Find matching shows
      const since = lastEmailAt ? new Date(lastEmailAt) : new Date(0);
      const matches: Array<{
        showName: string;
        djName?: string;
        stationName: string;
        stationId: string;
        startTime: Date;
        searchTerm: string;
        watchlistDocId: string;
      }> = [];

      for (const show of allShows) {
        const showStart = new Date(show.startTime);

        // Only include future shows or shows from since last email
        if (showStart < since) continue;

        for (const watchlistDoc of watchlistDocs) {
          const termLower = watchlistDoc.term.toLowerCase();
          if (
            show.name.toLowerCase().includes(termLower) ||
            show.dj?.toLowerCase().includes(termLower)
          ) {
            matches.push({
              showName: show.name,
              djName: show.dj,
              stationName: show.stationName,
              stationId: show.stationId,
              startTime: showStart,
              searchTerm: watchlistDoc.term,
              watchlistDocId: watchlistDoc.id,
            });
            break; // Don't add same show multiple times
          }
        }
      }

      if (matches.length > 0) {
        // Sort by start time
        matches.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

        // Deduplicate shows by name (keep first occurrence)
        const uniqueMatches = matches.filter(
          (match, index, self) =>
            index === self.findIndex((m) => m.showName.toLowerCase() === match.showName.toLowerCase())
        );

        // Add matched shows to favorites (as type "show")
        for (const match of uniqueMatches) {
          // Check if show already favorited
          const existingFavorites = await getUserFavorites(user.id, "show");
          const alreadyFavorited = existingFavorites.some(
            (f) => (f.data.term as string)?.toLowerCase() === match.showName.toLowerCase()
          );

          if (!alreadyFavorited) {
            await addUserFavorite(user.id, {
              term: match.showName.toLowerCase(),
              type: "show",
              showName: match.showName,
              djName: match.djName || null,
              stationId: match.stationId,
              createdAt: new Date(),
              createdBy: "system",
              matchedFromWatchlist: match.searchTerm,
            });
          }
        }

        // Send digest email (max 10 matches)
        const success = await sendWatchlistDigestEmail({
          to: userData.email as string,
          matches: uniqueMatches.slice(0, 10),
        });

        if (success) {
          await updateUser(user.id, {
            lastWatchlistEmailAt: new Date(),
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
