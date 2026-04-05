import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminDb } from "@/lib/firebase-admin";
import { getUnsubscribeHeaders } from "@/lib/email";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = "Cap from Channel <cap@channel-app.com>";
const LOGO_URL = "https://channel-app.com/logo-black.png";
const APP_URL = "https://channel-app.com";
const SUBJECT = "Starting week 2";

// ── This week's DJ lineup ──────────────────────────────────────────
const THIS_WEEK_DJS = [
  { name: "shroomie", profileUrl: `${APP_URL}/dj/shroomie` },
  { name: "SPF 50", profileUrl: `${APP_URL}/dj/spf50` },
  { name: "Spillman", profileUrl: `${APP_URL}/dj/spillman` },
  { name: "Celebrity Bitcrush", profileUrl: `${APP_URL}/dj/celebritybitcrush` },
  { name: "Pretty Gay Friendly", profileUrl: `${APP_URL}/dj/prettygayfriendly` },
  { name: "Dani Moon", profileUrl: `${APP_URL}/dj/danimoon` },
];

// ── Email HTML builder ─────────────────────────────────────────────

function minifyHtml(html: string): string {
  return html.replace(/\n\s+/g, "\n").replace(/\n+/g, "\n").trim();
}

function buildDjLineup(): string {
  return THIS_WEEK_DJS.map((dj) => {
    if (dj.profileUrl) {
      return `<a href="${dj.profileUrl}" style="color: #1a1a1a; text-decoration: underline;">${dj.name}</a>`;
    }
    return dj.name;
  }).join(", ");
}

function buildEmailHtml(name: string): string {
  const settingsUrl = `${APP_URL}/settings?unsubscribe=dj`;

  return minifyHtml(`
    <!DOCTYPE html>
    <html style="background-color: #ffffff;" bgcolor="#ffffff">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="light only">
      <meta name="supported-color-schemes" content="light only">
      <style>
        :root { color-scheme: light only; }
        body, .body-bg { background-color: #ffffff !important; }
        u + .body-bg { background-color: #ffffff !important; }
      </style>
    </head>
    <body class="body-bg" bgcolor="#ffffff" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #ffffff; color: #1a1a1a; margin: 0; padding: 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color: #ffffff;">
        <tr>
          <td align="center" style="padding: 40px 20px;" bgcolor="#ffffff">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px;">
              <tr>
                <td align="center" style="padding-bottom: 32px;" bgcolor="#ffffff">
                  <img src="${LOGO_URL}" alt="Channel" width="120" style="width: 120px; height: auto;" />
                </td>
              </tr>
              <tr>
                <td bgcolor="#ffffff" style="font-size: 15px; line-height: 1.6; color: #1a1a1a;">
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Hi ${name},</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Quick note to start the week :)</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Last week was honestly so much fun. Really grateful for all of you — the music, the energy, the vote of confidence, and everything I learned from it.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;"><strong>We had 280 new streams on launch day</strong>, which was amazing to see. It also pushed the setup a bit, so I've since improved the streaming capacity to make things smoother and support more listeners.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">I've also made a few improvements on the product — improved the live player design, enabled a filter on the archives so people can find sets by genre, cleaned up the menu for easier navigation.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">This week is shaping up nicely, with a few new shows coming in:<br />${buildDjLineup()}</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Also, I'm always looking for new people to invite. If there are DJs, producers, or friends you think would be a good fit, I would love an intro.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">And more specifically, <strong>I'd really like to bring more women into the lineup</strong>, so if anyone comes to mind, please send them my way.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">As always, if you have any feedback, ideas, or things you'd want to see, I'm all ears.</p>
                  <p style="margin: 0 0 4px; color: #1a1a1a;">Thanks again for being part of this 🖤</p>
                  <p style="margin: 0; color: #1a1a1a;">Cap</p>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top: 32px; border-top: 1px solid #e5e5e5;" bgcolor="#ffffff">
                  <p style="margin: 0 0 12px; font-size: 13px; color: #999;">
                    You're receiving this as a DJ on Channel Radio.
                  </p>
                  <a href="${settingsUrl}" style="font-size: 12px; color: #999; text-decoration: underline;">
                    Unsubscribe
                  </a>
                  <!--${Date.now()}-->
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `);
}

// ── Route handler ───────────────────────────────────────────────────
// Modes:
//   ?mode=preview  → send test to cap@channel-app.com
//   ?mode=dry-run  → list who would receive (default)
//   ?mode=send     → send to all DJs with djInsiders=true (LOCKED until ready)

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get("mode") || "dry-run";

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  // Get all DJ users, then filter for djInsiders in code
  // (avoids needing a composite Firestore index on role + emailNotifications.djInsiders)
  const usersSnap = await db
    .collection("users")
    .where("role", "==", "dj")
    .get();

  // Exclude specific emails from this send
  const EXCLUDE_EMAILS = new Set(["maiii@posteo.la"]);

  const djRecipients: Array<{ email: string; name: string; id: string }> = [];
  const debug: Array<{ email: string; djInsiders: unknown; notifs: unknown }> = [];
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    if (!data.email) continue;
    if (EXCLUDE_EMAILS.has(data.email)) continue;
    debug.push({
      email: data.email,
      djInsiders: data.emailNotifications?.djInsiders,
      notifs: data.emailNotifications ? Object.keys(data.emailNotifications) : null,
    });
    if (!data.emailNotifications?.djInsiders) continue;
    // Use DJ internal name, displayName, or fallback
    const name = data.name || "there";
    djRecipients.push({ email: data.email, name, id: doc.id });
  }

  // Add pending DJs who have scheduled slots but no account yet
  const EXTRA_PENDING_DJS = [
    { email: "paulsboston@gmail.com", name: "Paul", id: "pending-spillman" },
  ];
  for (const pending of EXTRA_PENDING_DJS) {
    if (EXCLUDE_EMAILS.has(pending.email)) continue;
    if (djRecipients.some((r) => r.email === pending.email)) continue;
    djRecipients.push(pending);
  }

  // ── Preview mode: send test to cap@channel-app.com ──
  if (mode === "preview") {
    if (!resend) {
      return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
    }

    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: "cap@channel-app.com",
        subject: SUBJECT,
        html: buildEmailHtml("Cap"),
        headers: getUnsubscribeHeaders("dj"),
      });

      return NextResponse.json({
        mode: "preview",
        sentTo: "cap@channel-app.com",
        success: true,
        totalDjRecipients: djRecipients.length,
        recipients: djRecipients.map((r) => ({ email: r.email, name: r.name })),
      });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  // ── Dry-run mode: just list recipients ──
  if (mode === "dry-run") {
    return NextResponse.json({
      mode: "dry-run",
      totalDJs: usersSnap.docs.length,
      totalDjRecipients: djRecipients.length,
      recipients: djRecipients.map((r) => ({ email: r.email, name: r.name })),
      debug,
    });
  }

  // ── Send mode: LOCKED — flip to true when ready ──
  if (mode === "send") {
    const SEND_ENABLED = false; // ← flip to true when ready to send
    if (!SEND_ENABLED) {
      return NextResponse.json({
        error: "Send mode is locked. Set SEND_ENABLED = true in code when ready.",
        totalDjRecipients: djRecipients.length,
      });
    }

    if (!resend) {
      return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
    }

    let sent = 0;
    let failed = 0;
    const errors: Array<{ email: string; error: string }> = [];

    for (const recipient of djRecipients) {
      try {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: recipient.email,
          subject: SUBJECT,
          html: buildEmailHtml(recipient.name),
          headers: getUnsubscribeHeaders("dj"),
        });
        sent++;
      } catch (e) {
        failed++;
        errors.push({ email: recipient.email, error: String(e) });
      }
      // Rate limit: 150ms between sends
      await new Promise((r) => setTimeout(r, 150));
    }

    return NextResponse.json({
      mode: "send",
      sent,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    });
  }

  return NextResponse.json({ error: "Invalid mode. Use: preview, dry-run, send" }, { status: 400 });
}
