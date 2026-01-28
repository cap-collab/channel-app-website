import { NextRequest, NextResponse } from "next/server";
import {
  queryUsersWhere,
  getUserFavorites,
  addUserFavorite,
  isRestApiConfigured,
} from "@/lib/firebase-rest";

// Contains matching for DJ/show names (bidirectional - either contains the other)
function containsMatch(text: string, term: string): boolean {
  const textLower = text.toLowerCase();
  const termLower = term.toLowerCase();
  return textLower.includes(termLower) || termLower.includes(textLower);
}

interface ProcessWatchlistRequest {
  showName: string;
  djName?: string | null;
  djUserId?: string | null;
  djEmail?: string | null;
  startTime: number; // milliseconds
  stationId?: string;
}

/**
 * POST /api/broadcast/process-watchlist
 *
 * Called after a new broadcast slot is created to immediately check
 * all users' watchlists and add the show to their favorites if it matches.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify internal call (from our own API endpoints)
    const internalSecret = request.headers.get("x-internal-secret");
    if (internalSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isRestApiConfigured()) {
      return NextResponse.json(
        { error: "Firebase REST API not configured" },
        { status: 500 }
      );
    }

    const body: ProcessWatchlistRequest = await request.json();
    const { showName, djName, djUserId, djEmail, stationId = "broadcast" } = body;

    if (!showName) {
      return NextResponse.json(
        { error: "Missing required field: showName" },
        { status: 400 }
      );
    }

    console.log(`[process-watchlist] Processing new show: "${showName}" by ${djName || "unknown"}`);

    // Get all users (we need to check their watchlists)
    const allUsers = await queryUsersWhere("createdAt", "GREATER_THAN", new Date(0));
    console.log(`[process-watchlist] Checking ${allUsers.length} users`);

    let usersMatched = 0;
    let showsAddedToFavorites = 0;

    for (const user of allUsers) {
      const userId = user.id;
      const userEmail = user.data.email as string | undefined;

      // Get user's watchlist (search type favorites)
      const watchlistFavorites = await getUserFavorites(userId, "search");

      if (watchlistFavorites.length === 0) {
        continue;
      }

      let matched = false;
      let matchedTerm = "";

      // Check each watchlist term
      for (const watchlistDoc of watchlistFavorites) {
        const term = watchlistDoc.data.term as string;
        const termLower = term.toLowerCase();

        // Word boundary matching: "stu" matches "Stu's Show" but NOT "Stuart"
        if (
          containsMatch(showName, termLower) ||
          (djName && containsMatch(djName, termLower))
        ) {
          matched = true;
          matchedTerm = term;
          break;
        }
      }

      // Also check if user's ID or email matches the DJ (their own broadcast)
      if (!matched) {
        if (
          (djUserId && djUserId === userId) ||
          (djEmail && userEmail && djEmail.toLowerCase() === userEmail.toLowerCase())
        ) {
          matched = true;
          matchedTerm = "your broadcast";
        }
      }

      if (matched) {
        usersMatched++;

        // Check if show already favorited
        const existingFavorites = await getUserFavorites(userId, "show");
        const alreadyFavorited = existingFavorites.some(
          (f) =>
            (f.data.term as string)?.toLowerCase() === showName.toLowerCase() &&
            (f.data.stationId as string) === stationId
        );

        if (!alreadyFavorited) {
          await addUserFavorite(userId, {
            term: showName.toLowerCase(),
            type: "show",
            showName: showName,
            djName: djName || null,
            stationId: stationId,
            createdAt: new Date(),
            createdBy: "system",
            matchedFromWatchlist: matchedTerm,
          });
          showsAddedToFavorites++;
          console.log(`[process-watchlist] Added "${showName}" to favorites for user ${userId} (matched: "${matchedTerm}")`);
        }
      }
    }

    console.log(`[process-watchlist] Done: ${usersMatched} users matched, ${showsAddedToFavorites} favorites added`);

    return NextResponse.json({
      success: true,
      usersMatched,
      showsAddedToFavorites,
    });
  } catch (error) {
    console.error("Error in process-watchlist:", error);
    return NextResponse.json(
      { error: "Failed to process watchlist matches" },
      { status: 500 }
    );
  }
}
