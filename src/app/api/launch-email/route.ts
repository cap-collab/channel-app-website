import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = "Cap from Channel <cap@channel-app.com>";
const LOGO_URL = "https://channel-app.com/logo-white.png";

// ── Hardcoded recipient lists ───────────────────────────────────────

const IOS_LIST: Array<{ email: string; name: string }> = [
  { email: "jchatard@outlook.fr", name: "JP" },
  { email: "omar41309@yahoo.com", name: "Omar" },
  { email: "cap@channel-app.com", name: "Cap" },
  { email: "jbektemba0711@gmail.com", name: "Jelani" },
  { email: "jeremieemk@gmail.com", name: "Jeremie" },
  { email: "walidvb@gmail.com", name: "Walid" },
  { email: "yaldahesh@gmail.com", name: "Yalda" },
  { email: "benjaminruthven@aol.com", name: "Benji" },
  { email: "2ty7cmd5tf@privaterelay.appleid.com", name: "Cap" },
  { email: "ssantos2107@gmail.com", name: "Sofia" },
  { email: "pierre.elie.fauche@gmail.com", name: "Pierre-Élie" },
  { email: "thomas@sidewalk-consulting.com", name: "Thomas" },
  { email: "paulanthonychin@gmail.com", name: "Paul-Anthony" },
  { email: "emwhitenoise@gmail.com", name: "Emily" },
  { email: "aurelien.porte@gmail.com", name: "Aurelien" },
];

const GENERAL_LIST: Array<{ email: string; name: string }> = [
  { email: "maxcheney@gmail.com", name: "Max" },
  { email: "danimunt91@gmail.com", name: "Daniela" },
  { email: "maiii@posteo.la", name: "Maiii" },
  { email: "j.r.colby@gmail.com", name: "Jim" },
  { email: "2jc6y8xkc8@privaterelay.appleid.com", name: "Joey" },
  { email: "cap@beyondalgorithms.cloud", name: "Cap" },
  { email: "cf6nq9k22f@privaterelay.appleid.com", name: "Sam" },
  { email: "stephan.kimbel@gmail.com", name: "Stephan" },
  { email: "bilaliwood@gmail.com", name: "Bilal" },
  { email: "billyboyali@gmail.com", name: "Bilal" },
  { email: "pwbrs7rxyt@privaterelay.appleid.com", name: "Natalie" },
  { email: "mqt85x26ms@privaterelay.appleid.com", name: "Amandine" },
  { email: "7mpnw5xkkh@privaterelay.appleid.com", name: "Ana" },
  { email: "bqbwvhdq7v@privaterelay.appleid.com", name: "Ana" },
  { email: "v8yykfdgbd@privaterelay.appleid.com", name: "Christian" },
  { email: "djfp9n86bf@privaterelay.appleid.com", name: "Eduardo" },
  { email: "tabicat22@gmail.com", name: "Tabitha" },
  { email: "toby.alden@gmail.com", name: "Toby" },
  { email: "powell.oliver@me.com", name: "Oliver" },
  { email: "clindsay123@gmail.com", name: "Christian" },
  { email: "paulsboston@gmail.com", name: "Paul" },
  { email: "juniorsbl@gmail.com", name: "Junior" },
  { email: "hello@justinmiller.nyc", name: "Justin" },
  { email: "dorwand@gmail.com", name: "Dor Wand" },
  { email: "cesartoribio1@gmail.com", name: "Cesar" },
  { email: "omer.almileik@gmail.com", name: "Omer" },
  { email: "5kyriv3r5@gmail.com", name: "Sky" },
];

// ── Email HTML builders ─────────────────────────────────────────────

function minifyHtml(html: string): string {
  return html.replace(/\n\s+/g, "\n").replace(/\n+/g, "\n").trim();
}

function wrapEmailContent(content: string): string {
  return minifyHtml(`
    <!DOCTYPE html>
    <html style="background-color: #0a0a0a;" bgcolor="#0a0a0a">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="dark only">
      <meta name="supported-color-schemes" content="dark only">
      <style>
        :root { color-scheme: dark only; }
        body, .body-bg { background-color: #0a0a0a !important; }
        u + .body-bg { background-color: #0a0a0a !important; }
      </style>
    </head>
    <body class="body-bg" bgcolor="#0a0a0a" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0a0a0a; color: #fff; margin: 0; padding: 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0a0a" style="background-color: #0a0a0a;">
        <tr>
          <td align="center" style="padding: 40px 20px;" bgcolor="#0a0a0a">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 480px;">
              <tr>
                <td align="center" style="padding-bottom: 32px;" bgcolor="#0a0a0a">
                  <img src="${LOGO_URL}" alt="Channel" width="120" style="width: 120px; height: auto;" />
                </td>
              </tr>
              <tr>
                <td bgcolor="#0a0a0a" style="font-size: 15px; line-height: 1.6; color: #e4e4e7;">
                  ${content}
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top: 32px;" bgcolor="#0a0a0a">
                  <p style="margin: 0; font-size: 12px; color: #52525b;">
                    Channel · Los Angeles
                  </p>
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

const BUTTON_STYLE = "display: inline-block; background-color: #2a2a2a; color: #fff !important; padding: 14px 28px; border-radius: 0; text-decoration: none; font-weight: 600; font-size: 14px;";

function buildIOSEmailHtml(name: string): string {
  return wrapEmailContent(`
    <p style="margin: 0 0 16px; color: #e4e4e7;">Hi ${name},</p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">Channel is now live as a community radio<br /><a href="https://channel-app.com/" style="color: #a1a1aa; text-decoration: underline;">https://channel-app.com/</a></p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">It has evolved quite a bit since the iOS app. It is now available on web, where DJs and producers host shows and people tune in together.</p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">You can follow what they do, chat during sets, and stay connected to what is happening around them, on other radios and IRL.</p>
    <p style="margin: 0 0 24px; color: #e4e4e7;">We are live now with the first shows coming out of LA.</p>
    <p style="margin: 0 0 24px;"><a href="https://channel-app.com/" style="${BUTTON_STYLE}">TUNE IN NOW</a></p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">Would love to have you back on.</p>
    <p style="margin: 0; color: #e4e4e7;">Cap</p>
  `);
}

function buildGeneralEmailHtml(name: string): string {
  return wrapEmailContent(`
    <p style="margin: 0 0 16px; color: #e4e4e7;">Hi ${name},</p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">Channel is now live<br /><a href="https://channel-app.com/" style="color: #a1a1aa; text-decoration: underline;">https://channel-app.com/</a></p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">It's a community radio where DJs and producers host shows and people tune in together.</p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">You can follow what they do, chat during sets, and stay connected to what's happening around them, on other radios and IRL.</p>
    <p style="margin: 0 0 24px; color: #e4e4e7;">We're live with the first shows coming out of LA.</p>
    <p style="margin: 0 0 24px;"><a href="https://channel-app.com/" style="${BUTTON_STYLE}">TUNE IN NOW</a></p>
    <p style="margin: 0; color: #e4e4e7;">Cap</p>
  `);
}

// ── Route handler ───────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get("mode") || "dry-run";

  // ⚠️ PREVIEW MODE ONLY — sends both variants to cap@channel-app.com only
  // Lists are defined above but NOT used for sending until the lock is removed.
  if (mode === "preview") {
    if (!resend) {
      return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
    }

    const previewEmail = "cap@channel-app.com";
    const results: Array<{ variant: string; success: boolean; error?: string }> = [];

    // Send iOS variant
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: previewEmail,
        subject: "Channel is live now",
        html: buildIOSEmailHtml("Cap"),
      });
      results.push({ variant: "ios", success: true });
    } catch (e) {
      results.push({ variant: "ios", success: false, error: String(e) });
    }

    // Send general variant
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: previewEmail,
        subject: "Channel is live now",
        html: buildGeneralEmailHtml("Cap"),
      });
      results.push({ variant: "general", success: true });
    } catch (e) {
      results.push({ variant: "general", success: false, error: String(e) });
    }

    return NextResponse.json({
      mode: "preview",
      sentTo: previewEmail,
      results,
    });
  }

  // Full send is DISABLED — re-enable in code when ready
  return NextResponse.json({
    error: "Send is disabled. Only ?mode=preview is available. Lists are hardcoded for when send is re-enabled.",
    iosListCount: IOS_LIST.length,
    generalListCount: GENERAL_LIST.length,
  }, { status: 403 });
}
