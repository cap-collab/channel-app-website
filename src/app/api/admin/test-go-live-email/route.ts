import { NextRequest, NextResponse } from "next/server";
import { sendShowStartingEmail } from "@/lib/email";
import { queryUsersWhere } from "@/lib/firebase-rest";

// One-shot test send for the go-live email template.
// GET /api/admin/test-go-live-email?secret=$CRON_SECRET&to=cap@channel-app.com
//   &dj=somedj&showName=Optional&station=broadcast
//   &reason=engaged|favorite|watchlist   ← which footer line to preview
//                                           (default: engaged; ignored if ?bridge set)
//   &bundle=1   ← include a sample "Also coming up later today" section
//
// Resolves the recipient's UID by email so the per-DJ unsubscribe link
// in the footer is wired correctly. Always uses Channel Radio as the
// station unless overridden. Skips the cron's dedup / opt-in checks
// because this is a manual probe.
//
// Auth: accepts ?secret=CRON_SECRET OR the Vercel-cron header (matches the
// main cron's auth so an admin can manually probe in prod even when
// CRON_SECRET is unset).
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const secret = url.searchParams.get("secret");
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const secretOk = process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
  if (!isVercelCron && !secretOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = url.searchParams.get("to");
  const dj = url.searchParams.get("dj") || "channelbroadcast";
  const showName =
    url.searchParams.get("showName") || `${dj} is going live (test)`;
  const stationId = url.searchParams.get("station") || "broadcast";
  const stationName =
    stationId === "broadcast" ? "Channel Radio" : stationId;
  // Optional bridge DJ — renders the listener-side affiliation caption above
  // the card: "From the same world as {bridge}." for crew (default), or
  // "If you like {bridge}." when ?bridgeKind=borrow (audience-borrow). The
  // footer is "You're getting this from Channel." either way. Without ?bridge,
  // the footer is chosen by ?reason: "engaged" (default), "favorite" (saved
  // show), or "watchlist" (saved search term).
  const bridge = url.searchParams.get("bridge") || undefined;
  const bridgeKind =
    bridge && url.searchParams.get("bridgeKind") === "borrow"
      ? ("borrow" as const)
      : bridge
      ? ("crew" as const)
      : undefined;
  const reason = url.searchParams.get("reason") || "engaged";
  const engagementReason =
    bridge || reason !== "engaged" ? undefined : ("engaged" as const);
  const savedReason =
    !bridge && (reason === "favorite" || reason === "watchlist")
      ? (reason as "favorite" | "watchlist")
      : undefined;
  const includeBundle = url.searchParams.get("bundle") === "1";
  // ?restream=1 → subject + headline say "airing" instead of "is live".
  const isRestream = url.searchParams.get("restream") === "1";

  if (!to) {
    return NextResponse.json(
      { error: "Missing required ?to=<email>" },
      { status: 400 },
    );
  }

  // Look up the recipient's UID so the per-DJ mute link in the footer
  // can be minted. If we can't find them, send anyway with a global
  // unsubscribe link so the template still renders for inspection.
  let recipientUserId: string | undefined;
  try {
    const matches = await queryUsersWhere("email", "EQUAL", to.toLowerCase());
    recipientUserId = matches[0]?.id;
  } catch {
    // ignore — fall through with no recipientUserId
  }

  // Sample "later today" rows when ?bundle=1 — three shows starting at
  // +1h / +3h / +5h, mixing Channel + an external station so the visual
  // covers both the proxy-photo path and the fallback color path.
  const nowMs = Date.now();
  const laterToday = includeBundle
    ? [
        {
          showId: "test-bundle-1",
          showName: "Soft Tissue Sessions",
          djName: "softtissue",
          djUsername: "softtissue",
          stationName: "Channel Radio",
          stationId: "broadcast",
          startTime: new Date(nowMs + 60 * 60 * 1000).toISOString(),
        },
        {
          showId: "test-bundle-2",
          showName: "Late Bloomer",
          djName: "lateBloomer",
          djUsername: "latebloomer",
          stationName: "dublab",
          stationId: "dublab",
          startTime: new Date(nowMs + 3 * 60 * 60 * 1000).toISOString(),
        },
        {
          showId: "test-bundle-3",
          showName: "Closer Listening",
          djName: "closerlistening",
          djUsername: "closerlistening",
          stationName: "Channel Radio",
          stationId: "broadcast",
          startTime: new Date(nowMs + 5 * 60 * 60 * 1000).toISOString(),
        },
      ]
    : undefined;

  const ok = await sendShowStartingEmail({
    to,
    recipientUserId,
    showName,
    djName: dj,
    djUsername: dj,
    stationName,
    stationId,
    engagementReason,
    savedReason,
    isAffiliated: !!bridge,
    affiliationBridgeDj: bridge,
    bridgeKind,
    isRestream,
    laterToday,
    userTimezone: "America/Los_Angeles",
  });

  return NextResponse.json({
    sent: ok,
    to,
    dj,
    stationId,
    engagementReason,
    savedReason: savedReason ?? null,
    bridge: bridge ?? null,
    bridgeKind: bridgeKind ?? null,
    recipientUserId: recipientUserId ?? null,
    bundle: includeBundle ? laterToday?.length ?? 0 : 0,
    note: recipientUserId
      ? "Per-DJ unsubscribe link wired."
      : "Recipient UID not found — sent with global unsubscribe link.",
  });
}
