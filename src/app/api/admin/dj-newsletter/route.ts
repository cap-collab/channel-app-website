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
const SUBJECT = "Week 3: building around the community";

// First-name overrides: when data.name is missing, wrong, or a full name.
const FIRST_NAME_OVERRIDES: Record<string, string> = {
  "anthonypomije@gmail.com": "Anthony",
  "paulsboston@gmail.com": "Paul",
  "kevinlipman7@gmail.com": "Kevin",
  "drew.labarre@gmail.com": "Drew",
  "celebritybitcrush@gmail.com": "Keigo",
  "cap@beyondalgorithms.cloud": "Cap",
  "2ty7cmd5tf@privaterelay.appleid.com": "Cap",
};

// ── Email HTML builder ─────────────────────────────────────────────

function minifyHtml(html: string): string {
  return html.replace(/\n\s+/g, "\n").replace(/\n+/g, "\n").trim();
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
                  <a href="${APP_URL}" style="text-decoration: none;"><img src="${LOGO_URL}" alt="Channel" width="120" style="width: 120px; height: auto;" /></a>
                </td>
              </tr>
              <tr>
                <td bgcolor="#ffffff" style="font-size: 15px; line-height: 1.6; color: #1a1a1a;">
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Hi ${name},</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Channel is taking shape, last week was another strong step forward.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Streaming quality is now in a really good place. I've improved recording quality and upgraded audio monitoring.</p>
                  <p style="margin: 0 0 8px; color: #1a1a1a;"><strong>This week, I'm pausing live shows to focus on making Channel feel less like a playlist, and more like a living network of communities by:</strong></p>
                  <ul style="margin: 0 0 16px; padding-left: 20px; color: #1a1a1a;">
                    <li style="margin-bottom: 4px;">organizing the artists and recording library by scene / community</li>
                    <li style="margin-bottom: 4px;">introducing visual identities with artists from each scene</li>
                  </ul>
                  <p style="margin: 0 0 8px; color: #1a1a1a;"><strong>I'd love your help representing your scene:</strong></p>
                  <ul style="margin: 0 0 16px; padding-left: 20px; color: #1a1a1a;">
                    <li style="margin-bottom: 4px;">if you know DJs, producers, or visual artists who could represent your community, I'd love an intro</li>
                    <li style="margin-bottom: 4px;">I also want to bring more diversity into the lineup</li>
                  </ul>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">I'll be back next week with more live sessions, stronger promotion, better discovery, and cleaner recordings.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">As always, if you have feedback or ideas, I'm all ears.</p>
                  <p style="margin: 0 0 4px; color: #1a1a1a;">Thanks again,</p>
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
//   ?mode=preview[&to=foo@bar.com]  → send test to cap@channel-app.com (or override)
//   ?mode=dry-run                   → list who would receive, flag "there" fallbacks (default)
//   ?mode=compare                   → diff current recipients vs last send (by subject via Resend API)
//   ?mode=send                      → send to all (LOCKED until SEND_ENABLED=true)

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

  // ── Get DJ recipients ──
  const usersSnap = await db
    .collection("users")
    .where("role", "==", "dj")
    .get();

  const EXCLUDE_EMAILS = new Set([
    "maiii@posteo.la",
    "64j87qk747@privaterelay.appleid.com", // not a Channel DJ
  ]);

  const djRecipients: Array<{ email: string; name: string; id: string }> = [];
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    if (!data.email) continue;
    if (EXCLUDE_EMAILS.has(data.email)) continue;
    if (!data.emailNotifications?.djInsiders) continue;
    const override = FIRST_NAME_OVERRIDES[data.email];
    const name = override || (data.name ? data.name.split(" ")[0] : "there");
    djRecipients.push({ email: data.email, name, id: doc.id });
  }

  // Add pending DJs who have scheduled slots but no account yet
  const EXTRA_PENDING_DJS = [
    { email: "paulsboston@gmail.com", name: "Paul", id: "pending-spillman" },
    { email: "juniorsbl@gmail.com", name: "Junior", id: "pending-junior" },
    { email: "hello@justinmiller.nyc", name: "Justin", id: "pending-justin" },
    { email: "cesartoribio1@gmail.com", name: "Cesar", id: "pending-toribio" },
    { email: "celebritybitcrush@gmail.com", name: "Keigo", id: "pending-celebritybitcrush" },
    { email: "dorwand@gmail.com", name: "Dor", id: "pending-dorwand" },
    { email: "omer.almileik@gmail.com", name: "Omer", id: "pending-omer" },
  ];
  for (const pending of EXTRA_PENDING_DJS) {
    if (EXCLUDE_EMAILS.has(pending.email)) continue;
    if (djRecipients.some((r) => r.email === pending.email)) continue;
    djRecipients.push(pending);
  }

  // ── Preview mode: send test to cap@channel-app.com (or ?to=...) ──
  if (mode === "preview") {
    if (!resend) {
      return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
    }

    const toParam = request.nextUrl.searchParams.get("to");
    const previewTo = toParam || "cap@channel-app.com";
    const previewName = toParam
      ? (djRecipients.find((r) => r.email === toParam)?.name || "Cap")
      : "Cap";

    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: previewTo,
        subject: SUBJECT,
        html: buildEmailHtml(previewName),
        headers: getUnsubscribeHeaders("dj"),
      });

      return NextResponse.json({
        mode: "preview",
        sentTo: previewTo,
        greetedAs: previewName,
        subject: SUBJECT,
        success: true,
        totalDjRecipients: djRecipients.length,
      });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  // ── Dry-run mode: just list recipients ──
  if (mode === "dry-run") {
    // Also list all pending-dj-profiles with emails
    const pendingSnap = await db.collection("pending-dj-profiles").get();
    const pendingProfiles: Array<{ email: string; name: string }> = [];
    for (const doc of pendingSnap.docs) {
      const data = doc.data();
      if (data.email) {
        pendingProfiles.push({
          email: data.email,
          name: data.chatUsername || data.chatUsernameNormalized || "unknown",
        });
      }
    }

    const unresolved = djRecipients.filter((r) => r.name === "there");

    return NextResponse.json({
      mode: "dry-run",
      subject: SUBJECT,
      totalDjRecipients: djRecipients.length,
      unresolvedGreetingCount: unresolved.length,
      unresolvedGreetings: unresolved.map((r) => r.email),
      recipients: djRecipients.map((r) => ({ email: r.email, greeting: `Hi ${r.name},` })),
      pendingDjProfiles: pendingProfiles,
    });
  }

  // ── Compare mode: diff current recipients vs last send ──
  if (mode === "compare") {
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: "Resend API key not configured" }, { status: 500 });
    }

    const lastSubject = request.nextUrl.searchParams.get("lastSubject");
    if (!lastSubject) {
      return NextResponse.json({
        error: "Pass ?lastSubject=... to diff against a prior send (e.g. 'Starting week 2')",
      }, { status: 400 });
    }

    // Fetch recent Resend emails (first 100 covers ~10 days of normal traffic).
    const r = await fetch("https://api.resend.com/emails?limit=100", {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    if (!r.ok) {
      return NextResponse.json({ error: `Resend API: ${r.status}` }, { status: 500 });
    }
    const data = await r.json() as { data: Array<{ to: string[]; subject: string; last_event: string; created_at: string }> };
    const priorSends = data.data.filter((e) => e.subject === lastSubject);
    const priorEmails = new Set(priorSends.map((e) => e.to[0]).filter((e) => e !== "cap@channel-app.com"));
    const currentEmails = new Set(djRecipients.map((r) => r.email));

    const added = Array.from(currentEmails).filter((e) => !priorEmails.has(e));
    const removed = Array.from(priorEmails).filter((e) => !currentEmails.has(e));
    const unchanged = Array.from(currentEmails).filter((e) => priorEmails.has(e));

    return NextResponse.json({
      mode: "compare",
      lastSubject,
      currentSubject: SUBJECT,
      priorSendCount: priorEmails.size,
      currentRecipientCount: currentEmails.size,
      added,
      removed,
      unchangedCount: unchanged.length,
    });
  }

  // ── Send mode: LOCKED — flip to true when ready ──
  if (mode === "send") {
    const SEND_ENABLED = false; // ← sent 24/24 on 2026-04-13
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
