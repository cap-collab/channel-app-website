import { NextRequest, NextResponse } from "next/server";
import { sendShowStartingEmail } from "@/lib/email";
import { queryUsersWhere } from "@/lib/firebase-rest";

// One-shot test send for the go-live email template.
// GET /api/admin/test-go-live-email?secret=$CRON_SECRET&to=cap@channel-app.com
//   &dj=somedj&showName=Optional&station=broadcast&reason=hearted|lockedin
//
// Resolves the recipient's UID by email so the per-DJ unsubscribe link
// in the footer is wired correctly. Always uses Channel Radio as the
// station unless overridden. Skips the cron's dedup / opt-in checks
// because this is a manual probe.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const secret = url.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = url.searchParams.get("to");
  const dj = url.searchParams.get("dj") || "channelbroadcast";
  const showName =
    url.searchParams.get("showName") || `${dj} is going live (test)`;
  const stationId = url.searchParams.get("station") || "broadcast";
  const stationName =
    stationId === "broadcast" ? "Channel Radio" : stationId;
  const reasonRaw = url.searchParams.get("reason");
  const engagementReason =
    reasonRaw === "hearted" || reasonRaw === "lockedin" ? reasonRaw : "hearted";

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

  const ok = await sendShowStartingEmail({
    to,
    recipientUserId,
    showName,
    djName: dj,
    djUsername: dj,
    stationName,
    stationId,
    engagementReason,
  });

  return NextResponse.json({
    sent: ok,
    to,
    dj,
    stationId,
    engagementReason,
    recipientUserId: recipientUserId ?? null,
    note: recipientUserId
      ? "Per-DJ unsubscribe link wired."
      : "Recipient UID not found — sent with global unsubscribe link.",
  });
}
