import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { queryCollection } from "@/lib/firebase-rest";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = "Cap from Channel <cap@channel-app.com>";
const LOGO_URL = "https://channel-app.com/logo-white.png";

// ── Push token field name (discovered via ?mode=probe) ──────────────
const PUSH_TOKEN_FIELD = "expoPushToken";

// ── Recipient type ──────────────────────────────────────────────────
interface Recipient {
  email: string;
  name?: string; // first name from displayName, or chatUsername
  isIOSUser: boolean;
  source: string;
}

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

function buildIOSEmailHtml(name?: string): string {
  const greeting = name ? `Hi ${name},` : "Hi,";
  return wrapEmailContent(`
    <p style="margin: 0 0 16px; color: #e4e4e7;">${greeting}</p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">Quick update on Channel, it's evolved quite a bit since the iOS app.</p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">I'm now relaunching it as a community radio, where DJs and producers host shows and people tune in together.</p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">You can follow what they do, chat during sets, and stay connected to what's happening around them, on other radios and IRL.</p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">We're live now with the first shows coming out of LA.</p>
    <p style="margin: 0 0 8px; color: #e4e4e7;">Tune in here:</p>
    <p style="margin: 0 0 24px;"><a href="https://channel-app.com/" style="color: #a1a1aa; text-decoration: underline;">https://channel-app.com/</a></p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">Would love to have you back on.</p>
    <p style="margin: 0; color: #e4e4e7;">Cap</p>
  `);
}

function buildGeneralEmailHtml(): string {
  return wrapEmailContent(`
    <p style="margin: 0 0 16px; color: #e4e4e7;">Hi,</p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">Channel is now live.</p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">It's a community radio where DJs and producers host shows and people tune in together.</p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">You can follow what they do, chat during sets, and stay connected to what's happening around them, on other radios and IRL.</p>
    <p style="margin: 0 0 16px; color: #e4e4e7;">We're live now with the first shows coming out of LA.</p>
    <p style="margin: 0 0 8px; color: #e4e4e7;">Tune in here:</p>
    <p style="margin: 0 0 24px;"><a href="https://channel-app.com/" style="color: #a1a1aa; text-decoration: underline;">https://channel-app.com/</a></p>
    <p style="margin: 0; color: #e4e4e7;">Cap</p>
  `);
}

// ── Extract first name from displayName ─────────────────────────────
function getFirstName(displayName?: string, chatUsername?: string): string | undefined {
  if (displayName) {
    const first = displayName.trim().split(/\s+/)[0];
    if (first && first.length > 1) return first;
  }
  if (chatUsername) return chatUsername;
  return undefined;
}

// ── Collect all recipients ──────────────────────────────────────────
async function collectRecipients(): Promise<{
  recipients: Map<string, Recipient>;
  stats: {
    usersTotal: number;
    usersIOS: number;
    usersNonIOS: number;
    pendingDJs: number;
    djApplications: number;
    waitlist: number;
    deduped: number;
  };
  fieldReport?: string[];
}> {
  const recipients = new Map<string, Recipient>();
  let deduped = 0;
  let usersTotal = 0;
  let usersIOS = 0;
  let usersNonIOS = 0;

  // 1. All registered users
  // queryCollection has a default limit of 100, we need all users
  // Query in batches by fetching all at once with high limit
  const allUsers = await queryCollection("users", [], 10000);
  usersTotal = allUsers.length;

  for (const user of allUsers) {
    const email = (user.data.email as string)?.toLowerCase()?.trim();
    if (!email || !email.includes("@")) continue;

    const displayName = user.data.displayName as string | undefined;
    const chatUsername = user.data.chatUsername as string | undefined;
    const pushToken = user.data[PUSH_TOKEN_FIELD];
    const isIOS = !!(pushToken && String(pushToken).length > 0);

    if (isIOS) usersIOS++;
    else usersNonIOS++;

    recipients.set(email, {
      email,
      name: getFirstName(displayName, chatUsername),
      isIOSUser: isIOS,
      source: "user",
    });
  }

  // 2. Pending DJ profiles
  const pendingDJs = await queryCollection("pending-dj-profiles", [], 10000);
  let pendingDJCount = 0;
  for (const dj of pendingDJs) {
    const email = (dj.data.email as string)?.toLowerCase()?.trim();
    if (!email || !email.includes("@")) continue;
    pendingDJCount++;
    if (recipients.has(email)) {
      deduped++;
      continue;
    }
    recipients.set(email, {
      email,
      isIOSUser: false,
      source: "pending-dj",
    });
  }

  // 3. DJ applications
  const djApps = await queryCollection("dj-applications", [], 10000);
  let djAppCount = 0;
  for (const app of djApps) {
    const email = (app.data.email as string)?.toLowerCase()?.trim();
    if (!email || !email.includes("@")) continue;
    djAppCount++;
    if (recipients.has(email)) {
      deduped++;
      continue;
    }
    recipients.set(email, {
      email,
      isIOSUser: false,
      source: "dj-application",
    });
  }

  // 4. Waitlist
  const waitlist = await queryCollection("radio-notify-waitlist", [], 10000);
  let waitlistCount = 0;
  for (const entry of waitlist) {
    const email = (entry.data.email as string)?.toLowerCase()?.trim();
    if (!email || !email.includes("@")) continue;
    waitlistCount++;
    if (recipients.has(email)) {
      deduped++;
      continue;
    }
    recipients.set(email, {
      email,
      isIOSUser: false,
      source: "waitlist",
    });
  }

  return {
    recipients,
    stats: {
      usersTotal,
      usersIOS,
      usersNonIOS,
      pendingDJs: pendingDJCount,
      djApplications: djAppCount,
      waitlist: waitlistCount,
      deduped,
    },
  };
}

// ── Probe mode: discover fields on user docs ────────────────────────
async function probeUserFields(): Promise<NextResponse> {
  const users = await queryCollection("users", [], 30);
  const allFields = new Set<string>();
  const fieldCounts: Record<string, number> = {};

  for (const user of users) {
    for (const key of Object.keys(user.data)) {
      allFields.add(key);
      fieldCounts[key] = (fieldCounts[key] || 0) + 1;
    }
  }

  // Look for push-related fields
  const pushCandidates: Record<string, { count: number; sample: string }> = {};
  for (const user of users) {
    for (const [key, value] of Object.entries(user.data)) {
      const lk = key.toLowerCase();
      if (lk.includes("push") || lk.includes("token") || lk.includes("fcm") || lk.includes("apns") || lk.includes("expo")) {
        if (!pushCandidates[key]) {
          pushCandidates[key] = { count: 0, sample: "" };
        }
        pushCandidates[key].count++;
        if (!pushCandidates[key].sample && value) {
          pushCandidates[key].sample = String(value).substring(0, 60);
        }
      }
    }
  }

  return NextResponse.json({
    totalUsersProbed: users.length,
    allFields: Array.from(allFields).sort(),
    fieldCounts,
    pushCandidates,
    sampleUser: users[0] ? {
      id: users[0].id,
      fields: Object.fromEntries(
        Object.entries(users[0].data).map(([k, v]) => [
          k,
          typeof v === "string" ? v.substring(0, 50) : typeof v,
        ])
      ),
    } : null,
  });
}

// ── Send emails ─────────────────────────────────────────────────────
async function sendEmails(
  recipients: Map<string, Recipient>,
  testEmail?: string
): Promise<{
  sent: number;
  failed: number;
  errors: Array<{ email: string; error: string }>;
}> {
  if (!resend) {
    return { sent: 0, failed: 0, errors: [{ email: "", error: "Resend not configured" }] };
  }

  let sent = 0;
  let failed = 0;
  const errors: Array<{ email: string; error: string }> = [];

  const toSend = testEmail
    ? Array.from(recipients.values()).filter((r) => r.email === testEmail.toLowerCase())
    : Array.from(recipients.values());

  // If test email not found in recipients, send both variants to test address
  if (testEmail && toSend.length === 0) {
    toSend.push(
      { email: testEmail.toLowerCase(), name: "Test", isIOSUser: true, source: "test" },
      { email: testEmail.toLowerCase(), isIOSUser: false, source: "test" }
    );
  }

  for (let i = 0; i < toSend.length; i++) {
    const recipient = toSend[i];
    const html = recipient.isIOSUser
      ? buildIOSEmailHtml(recipient.name)
      : buildGeneralEmailHtml();
    const subject = recipient.isIOSUser
      ? "Channel is live now"
      : "Channel is live";

    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipient.email,
        subject,
        html,
      });
      sent++;
    } catch (e) {
      failed++;
      errors.push({ email: recipient.email, error: String(e) });
    }

    // Rate limit: ~6/sec
    if (i < toSend.length - 1) {
      await new Promise((r) => setTimeout(r, 150));
    }

    // Progress log every 50
    if ((i + 1) % 50 === 0) {
      console.log(`[launch-email] Progress: ${i + 1}/${toSend.length} (${sent} sent, ${failed} failed)`);
    }
  }

  return { sent, failed, errors };
}

// ── Route handler ───────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get("mode") || "dry-run";
  const testEmail = request.nextUrl.searchParams.get("testEmail") || undefined;

  // Probe mode: discover user doc fields
  if (mode === "probe") {
    return probeUserFields();
  }

  // Collect recipients
  const { recipients, stats } = await collectRecipients();

  const iosList = Array.from(recipients.values()).filter((r) => r.isIOSUser);
  const generalList = Array.from(recipients.values()).filter((r) => !r.isIOSUser);

  // Dry-run mode: show stats and samples
  if (mode === "dry-run") {
    return NextResponse.json({
      stats,
      totalUniqueEmails: recipients.size,
      iosListCount: iosList.length,
      generalListCount: generalList.length,
      iosSample: iosList.slice(0, 10).map((r) => ({
        email: r.email,
        name: r.name,
        source: r.source,
      })),
      generalSample: generalList.slice(0, 10).map((r) => ({
        email: r.email,
        source: r.source,
      })),
      iosEmails: iosList.map((r) => r.email),
      generalEmails: generalList.map((r) => r.email),
    });
  }

  // Send mode
  if (mode === "send") {
    const result = await sendEmails(recipients, testEmail);
    return NextResponse.json({
      mode: testEmail ? "test-send" : "full-send",
      testEmail,
      stats,
      totalUniqueEmails: recipients.size,
      iosListCount: iosList.length,
      generalListCount: generalList.length,
      ...result,
    });
  }

  return NextResponse.json({ error: "Invalid mode. Use: probe, dry-run, send" }, { status: 400 });
}
