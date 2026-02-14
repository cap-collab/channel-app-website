import { NextRequest, NextResponse } from "next/server";
import {
  queryUsersWhere,
  getUserFavorites,
  addUserFavorite,
  updateDocument,
  deleteDocument,
  isRestApiConfigured,
} from "@/lib/firebase-rest";
import { wordBoundaryMatch } from "@/lib/dj-matching";

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
  previousIrlShows?: IrlShow[];
  previousRadioShows?: RadioShow[];
}

function irlShowKey(djUsername: string, show: IrlShow): string {
  return `irl-${djUsername}-${show.date}-${show.location}`.toLowerCase();
}

function radioShowKey(show: RadioShow): string {
  return `${show.name}-${show.radioName}-${show.date}`.toLowerCase();
}

function isIrlShowEmpty(show: IrlShow): boolean {
  return !show.name && !show.date && !show.location && !show.url;
}

function isRadioShowEmpty(show: RadioShow): boolean {
  return !show.name && !show.date && !show.radioName && !show.url;
}

/**
 * POST /api/dj/sync-shows-to-followers
 *
 * Called when a DJ saves IRL or radio shows on /studio.
 * Syncs the shows to all users who follow this DJ (have them in their watchlist).
 * Handles adds, updates, and deletes by diffing previous vs current shows by position.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isRestApiConfigured()) {
      console.log("[sync-shows-to-followers] Firebase REST API not configured, skipping sync");
      return NextResponse.json({ success: true, skipped: true });
    }

    const body: SyncRequest = await request.json();
    const {
      djUserId, djUsername, djName, djPhotoUrl,
      irlShows, radioShows,
      previousIrlShows = [], previousRadioShows = [],
    } = body;

    if (!djUserId || !djUsername) {
      return NextResponse.json(
        { error: "Missing required fields: djUserId, djUsername" },
        { status: 400 }
      );
    }

    console.log(`[sync-shows-to-followers] Syncing shows for DJ: ${djName} (${djUsername})`);
    console.log(`[sync-shows-to-followers] IRL: ${irlShows.length} current, ${previousIrlShows.length} previous`);
    console.log(`[sync-shows-to-followers] Radio: ${radioShows.length} current, ${previousRadioShows.length} previous`);

    const today = new Date().toISOString().split("T")[0];

    // Diff IRL shows by position
    const irlDiffs: Array<{ action: 'add' | 'update' | 'delete'; current?: IrlShow; previous?: IrlShow }> = [];
    const maxIrl = Math.max(irlShows.length, previousIrlShows.length);
    for (let i = 0; i < maxIrl; i++) {
      const prev = previousIrlShows[i];
      const curr = irlShows[i];
      const prevEmpty = !prev || isIrlShowEmpty(prev);
      const currEmpty = !curr || isIrlShowEmpty(curr);

      if (prevEmpty && currEmpty) continue;
      if (prevEmpty && !currEmpty) {
        // New show added
        if (curr.date >= today) irlDiffs.push({ action: 'add', current: curr });
      } else if (!prevEmpty && currEmpty) {
        // Show deleted
        irlDiffs.push({ action: 'delete', previous: prev });
      } else {
        // Show may have been updated
        const prevKey = irlShowKey(djUsername, prev!);
        const currKey = irlShowKey(djUsername, curr!);
        if (prevKey !== currKey || prev!.name !== curr!.name || prev!.url !== curr!.url) {
          if (curr!.date >= today) {
            irlDiffs.push({ action: 'update', current: curr, previous: prev });
          } else {
            // Updated to a past date — treat as delete
            irlDiffs.push({ action: 'delete', previous: prev });
          }
        }
        // If nothing changed, skip
      }
    }

    // Diff radio shows by position
    const radioDiffs: Array<{ action: 'add' | 'update' | 'delete'; current?: RadioShow; previous?: RadioShow }> = [];
    const maxRadio = Math.max(radioShows.length, previousRadioShows.length);
    for (let i = 0; i < maxRadio; i++) {
      const prev = previousRadioShows[i];
      const curr = radioShows[i];
      const prevEmpty = !prev || isRadioShowEmpty(prev);
      const currEmpty = !curr || isRadioShowEmpty(curr);

      if (prevEmpty && currEmpty) continue;
      if (prevEmpty && !currEmpty) {
        if (curr.date >= today) radioDiffs.push({ action: 'add', current: curr });
      } else if (!prevEmpty && currEmpty) {
        radioDiffs.push({ action: 'delete', previous: prev });
      } else {
        const prevKey = radioShowKey(prev!);
        const currKey = radioShowKey(curr!);
        if (prevKey !== currKey || prev!.url !== curr!.url || prev!.time !== curr!.time || prev!.duration !== curr!.duration) {
          if (curr!.date >= today) {
            radioDiffs.push({ action: 'update', current: curr, previous: prev });
          } else {
            radioDiffs.push({ action: 'delete', previous: prev });
          }
        }
      }
    }

    const hasChanges = irlDiffs.length > 0 || radioDiffs.length > 0;
    if (!hasChanges) {
      console.log("[sync-shows-to-followers] No changes detected");
      return NextResponse.json({ success: true, usersMatched: 0, changes: 0 });
    }

    console.log(`[sync-shows-to-followers] Diffs: ${irlDiffs.length} IRL, ${radioDiffs.length} radio`);

    // Get all users
    const allUsers = await queryUsersWhere("createdAt", "GREATER_THAN", new Date(0));
    console.log(`[sync-shows-to-followers] Checking ${allUsers.length} users`);

    let usersMatched = 0;
    let irlShowsAdded = 0;
    let irlShowsUpdated = 0;
    let irlShowsDeleted = 0;
    let radioShowsAdded = 0;
    let radioShowsUpdated = 0;
    let radioShowsDeleted = 0;

    for (const user of allUsers) {
      // Skip the DJ themselves
      if (user.id === djUserId) continue;

      // Check if user follows this DJ (has them in watchlist)
      const watchlist = await getUserFavorites(user.id, "search");

      if (watchlist.length === 0) continue;

      const followsDJ = watchlist.some(w => {
        const term = ((w.data.term as string) || "");

        // Match by username or DJ name (word boundary match)
        if (wordBoundaryMatch(djUsername, term)) return true;
        if (djName && wordBoundaryMatch(djName, term)) return true;

        return false;
      });

      if (!followsDJ) continue;

      usersMatched++;

      // Get existing favorites for diffing
      const existingIrl = await getUserFavorites(user.id, "irl");
      const existingShows = await getUserFavorites(user.id, "show");
      const favCollection = `users/${user.id}/favorites`;

      // Process IRL diffs
      for (const diff of irlDiffs) {
        if (diff.action === 'add' && diff.current) {
          const key = irlShowKey(djUsername, diff.current);
          const alreadyExists = existingIrl.some(f => (f.data.term as string) === key);
          if (!alreadyExists) {
            await addUserFavorite(user.id, {
              term: key,
              type: "irl",
              showName: diff.current.name,
              djName: djName,
              stationId: null,
              irlEventName: diff.current.name,
              irlLocation: diff.current.location,
              irlDate: diff.current.date,
              irlTicketUrl: diff.current.url,
              djUsername: djUsername,
              djPhotoUrl: djPhotoUrl || null,
              createdAt: new Date(),
              createdBy: "system",
            });
            irlShowsAdded++;
          }
        } else if (diff.action === 'delete' && diff.previous) {
          const oldKey = irlShowKey(djUsername, diff.previous);
          const existing = existingIrl.find(f => (f.data.term as string) === oldKey);
          if (existing) {
            await deleteDocument(favCollection, existing.id);
            irlShowsDeleted++;
            console.log(`[sync-shows-to-followers] Deleted IRL favorite "${diff.previous.name}" for user ${user.id}`);
          }
        } else if (diff.action === 'update' && diff.previous && diff.current) {
          const oldKey = irlShowKey(djUsername, diff.previous);
          const newKey = irlShowKey(djUsername, diff.current);
          const existing = existingIrl.find(f => (f.data.term as string) === oldKey);
          if (existing) {
            await updateDocument(favCollection, existing.id, {
              term: newKey,
              showName: diff.current.name,
              irlEventName: diff.current.name,
              irlLocation: diff.current.location,
              irlDate: diff.current.date,
              irlTicketUrl: diff.current.url,
            });
            irlShowsUpdated++;
            console.log(`[sync-shows-to-followers] Updated IRL favorite "${diff.previous.name}" → "${diff.current.name}" for user ${user.id}`);
          } else {
            // Previous favorite not found — add as new
            const alreadyExists = existingIrl.some(f => (f.data.term as string) === newKey);
            if (!alreadyExists) {
              await addUserFavorite(user.id, {
                term: newKey,
                type: "irl",
                showName: diff.current.name,
                djName: djName,
                stationId: null,
                irlEventName: diff.current.name,
                irlLocation: diff.current.location,
                irlDate: diff.current.date,
                irlTicketUrl: diff.current.url,
                djUsername: djUsername,
                djPhotoUrl: djPhotoUrl || null,
                createdAt: new Date(),
                createdBy: "system",
              });
              irlShowsAdded++;
            }
          }
        }
      }

      // Process radio diffs
      for (const diff of radioDiffs) {
        if (diff.action === 'add' && diff.current) {
          if (!diff.current.name || !diff.current.date || !diff.current.radioName) continue;
          const key = radioShowKey(diff.current);
          const alreadyExists = existingShows.some(f =>
            (f.data.term as string) === key ||
            (
              ((f.data.showName as string) || "").toLowerCase() === diff.current!.name.toLowerCase() &&
              ((f.data.stationId as string) || "") === diff.current!.radioName.toLowerCase() &&
              (f.data.radioShowDate as string) === diff.current!.date
            )
          );
          if (!alreadyExists) {
            await addUserFavorite(user.id, {
              term: key,
              type: "show",
              showName: diff.current.name,
              djName: djName,
              stationId: diff.current.radioName.toLowerCase(),
              radioShowDate: diff.current.date,
              radioShowTime: diff.current.time,
              radioShowDuration: diff.current.duration,
              radioShowUrl: diff.current.url,
              djUsername: djUsername,
              djPhotoUrl: djPhotoUrl || null,
              createdAt: new Date(),
              createdBy: "system",
            });
            radioShowsAdded++;
          }
        } else if (diff.action === 'delete' && diff.previous) {
          const oldKey = radioShowKey(diff.previous);
          const existing = existingShows.find(f =>
            (f.data.term as string) === oldKey ||
            (
              ((f.data.showName as string) || "").toLowerCase() === diff.previous!.name.toLowerCase() &&
              ((f.data.stationId as string) || "") === diff.previous!.radioName.toLowerCase() &&
              (f.data.radioShowDate as string) === diff.previous!.date
            )
          );
          if (existing) {
            await deleteDocument(favCollection, existing.id);
            radioShowsDeleted++;
            console.log(`[sync-shows-to-followers] Deleted radio favorite "${diff.previous.name}" for user ${user.id}`);
          }
        } else if (diff.action === 'update' && diff.previous && diff.current) {
          if (!diff.current.name || !diff.current.date || !diff.current.radioName) continue;
          const oldKey = radioShowKey(diff.previous);
          const newKey = radioShowKey(diff.current);
          const existing = existingShows.find(f =>
            (f.data.term as string) === oldKey ||
            (
              ((f.data.showName as string) || "").toLowerCase() === diff.previous!.name.toLowerCase() &&
              ((f.data.stationId as string) || "") === diff.previous!.radioName.toLowerCase() &&
              (f.data.radioShowDate as string) === diff.previous!.date
            )
          );
          if (existing) {
            await updateDocument(favCollection, existing.id, {
              term: newKey,
              showName: diff.current.name,
              stationId: diff.current.radioName.toLowerCase(),
              radioShowDate: diff.current.date,
              radioShowTime: diff.current.time,
              radioShowDuration: diff.current.duration,
              radioShowUrl: diff.current.url,
            });
            radioShowsUpdated++;
            console.log(`[sync-shows-to-followers] Updated radio favorite "${diff.previous.name}" → "${diff.current.name}" for user ${user.id}`);
          } else {
            // Previous favorite not found — add as new
            const alreadyExists = existingShows.some(f => (f.data.term as string) === newKey);
            if (!alreadyExists) {
              await addUserFavorite(user.id, {
                term: newKey,
                type: "show",
                showName: diff.current.name,
                djName: djName,
                stationId: diff.current.radioName.toLowerCase(),
                radioShowDate: diff.current.date,
                radioShowTime: diff.current.time,
                radioShowDuration: diff.current.duration,
                radioShowUrl: diff.current.url,
                djUsername: djUsername,
                djPhotoUrl: djPhotoUrl || null,
                createdAt: new Date(),
                createdBy: "system",
              });
              radioShowsAdded++;
            }
          }
        }
      }
    }

    console.log(`[sync-shows-to-followers] Done: ${usersMatched} users matched`);
    console.log(`[sync-shows-to-followers] IRL: +${irlShowsAdded} added, ~${irlShowsUpdated} updated, -${irlShowsDeleted} deleted`);
    console.log(`[sync-shows-to-followers] Radio: +${radioShowsAdded} added, ~${radioShowsUpdated} updated, -${radioShowsDeleted} deleted`);

    return NextResponse.json({
      success: true,
      usersMatched,
      irlShowsAdded,
      irlShowsUpdated,
      irlShowsDeleted,
      radioShowsAdded,
      radioShowsUpdated,
      radioShowsDeleted,
    });
  } catch (error) {
    console.error("[sync-shows-to-followers] Error:", error);
    return NextResponse.json(
      { error: "Failed to sync shows to followers" },
      { status: 500 }
    );
  }
}
