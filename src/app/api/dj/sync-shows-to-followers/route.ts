import { NextRequest, NextResponse } from "next/server";
import {
  queryUsersWhere,
  getUserFavorites,
  addUserFavorite,
  isRestApiConfigured,
} from "@/lib/firebase-rest";

interface IrlShow {
  name: string;
  location: string;
  url: string;
  date: string;
}

interface RadioShow {
  name: string;
  radioName: string;
  url: string;
  date: string;
  time: string;
  duration: string;
}

interface SyncRequest {
  djUserId: string;
  djUsername: string;
  djName: string;
  djPhotoUrl?: string;
  irlShows: IrlShow[];
  radioShows: RadioShow[];
}

/**
 * POST /api/dj/sync-shows-to-followers
 *
 * Called when a DJ saves IRL or radio shows on /studio.
 * Syncs the shows to all users who follow this DJ (have them in their watchlist).
 */
export async function POST(request: NextRequest) {
  try {
    if (!isRestApiConfigured()) {
      console.log("[sync-shows-to-followers] Firebase REST API not configured, skipping sync");
      return NextResponse.json({ success: true, skipped: true });
    }

    const body: SyncRequest = await request.json();
    const { djUserId, djUsername, djName, djPhotoUrl, irlShows, radioShows } = body;

    if (!djUserId || !djUsername) {
      return NextResponse.json(
        { error: "Missing required fields: djUserId, djUsername" },
        { status: 400 }
      );
    }

    console.log(`[sync-shows-to-followers] Syncing shows for DJ: ${djName} (${djUsername})`);
    console.log(`[sync-shows-to-followers] IRL shows: ${irlShows.length}, Radio shows: ${radioShows.length}`);

    const today = new Date().toISOString().split("T")[0];

    // Filter to only future shows
    const futureIrlShows = irlShows.filter(show => show.date >= today);
    const futureRadioShows = radioShows.filter(show => show.date >= today);

    if (futureIrlShows.length === 0 && futureRadioShows.length === 0) {
      console.log("[sync-shows-to-followers] No future shows to sync");
      return NextResponse.json({ success: true, usersMatched: 0, showsAdded: 0 });
    }

    // Get all users
    const allUsers = await queryUsersWhere("createdAt", "GREATER_THAN", new Date(0));
    console.log(`[sync-shows-to-followers] Checking ${allUsers.length} users`);

    let usersMatched = 0;
    let irlShowsAdded = 0;
    let radioShowsAdded = 0;

    // Normalize DJ username for matching
    const normalizedDjUsername = djUsername.replace(/[\s-]+/g, "").toLowerCase();
    const djNameLower = djName?.toLowerCase() || "";

    for (const user of allUsers) {
      // Skip the DJ themselves
      if (user.id === djUserId) continue;

      // Check if user follows this DJ (has them in watchlist)
      const watchlist = await getUserFavorites(user.id, "search");

      if (watchlist.length === 0) continue;

      const followsDJ = watchlist.some(w => {
        const term = ((w.data.term as string) || "").toLowerCase();
        const normalizedTerm = term.replace(/[\s-]+/g, "");

        // Match by normalized username
        if (normalizedTerm === normalizedDjUsername) return true;

        // Match by DJ name (contains)
        if (djNameLower && (djNameLower.includes(term) || term.includes(djNameLower))) return true;

        return false;
      });

      if (!followsDJ) continue;

      usersMatched++;
      console.log(`[sync-shows-to-followers] User ${user.id} follows ${djName}`);

      // Get existing favorites to avoid duplicates
      const existingIrl = await getUserFavorites(user.id, "irl");
      const existingShows = await getUserFavorites(user.id, "show");

      // Sync IRL shows
      for (const show of futureIrlShows) {
        if (!show.name || !show.date) continue;

        const irlKey = `irl-${djUsername}-${show.date}-${show.location}`.toLowerCase();
        const alreadyExists = existingIrl.some(f => (f.data.term as string) === irlKey);

        if (!alreadyExists) {
          await addUserFavorite(user.id, {
            term: irlKey,
            type: "irl",
            showName: show.name,
            djName: djName,
            stationId: null,
            irlEventName: show.name,
            irlLocation: show.location,
            irlDate: show.date,
            irlTicketUrl: show.url,
            djUsername: djUsername,
            djPhotoUrl: djPhotoUrl || null,
            createdAt: new Date(),
            createdBy: "system",
          });
          irlShowsAdded++;
          console.log(`[sync-shows-to-followers] Added IRL show "${show.name}" to user ${user.id}`);
        }
      }

      // Sync radio shows
      for (const show of futureRadioShows) {
        if (!show.name || !show.date || !show.radioName) continue;

        const showKey = `${show.name}-${show.radioName}-${show.date}`.toLowerCase();
        const alreadyExists = existingShows.some(f =>
          (f.data.term as string) === showKey ||
          (
            ((f.data.showName as string) || "").toLowerCase() === show.name.toLowerCase() &&
            ((f.data.stationId as string) || "") === show.radioName.toLowerCase() &&
            (f.data.radioShowDate as string) === show.date
          )
        );

        if (!alreadyExists) {
          await addUserFavorite(user.id, {
            term: showKey,
            type: "show",
            showName: show.name,
            djName: djName,
            stationId: show.radioName.toLowerCase(),
            radioShowDate: show.date,
            radioShowTime: show.time,
            radioShowDuration: show.duration,
            radioShowUrl: show.url,
            djUsername: djUsername,
            djPhotoUrl: djPhotoUrl || null,
            createdAt: new Date(),
            createdBy: "system",
          });
          radioShowsAdded++;
          console.log(`[sync-shows-to-followers] Added radio show "${show.name}" to user ${user.id}`);
        }
      }
    }

    console.log(`[sync-shows-to-followers] Done: ${usersMatched} users matched, ${irlShowsAdded} IRL + ${radioShowsAdded} radio shows added`);

    return NextResponse.json({
      success: true,
      usersMatched,
      irlShowsAdded,
      radioShowsAdded,
    });
  } catch (error) {
    console.error("[sync-shows-to-followers] Error:", error);
    return NextResponse.json(
      { error: "Failed to sync shows to followers" },
      { status: 500 }
    );
  }
}
