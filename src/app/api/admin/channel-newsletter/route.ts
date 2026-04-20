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
const SUBJECT = "Something is starting to take shape";

type Cohort = "dj" | "listener";

// First-name overrides: applied only when Firebase `name` is missing.
// Priority: Firebase name → override → chatUsername → "there".
const FIRST_NAME_OVERRIDES: Record<string, string> = {
  "anthonypomije@gmail.com": "Anthony",
  "paulsboston@gmail.com": "Paul",
  "kevinlipman7@gmail.com": "Kevin",
  "drew.labarre@gmail.com": "Drew",
  "celebritybitcrush@gmail.com": "Keigo",
  "cap@beyondalgorithms.cloud": "Cap",
  "2ty7cmd5tf@privaterelay.appleid.com": "Cap",
  // Listener corrections
  "aubespin@gmail.com": "David",
  "jchatard@outlook.fr": "JP",
  "powell.oliver@me.com": "Oliver",
  "ssantos2107@gmail.com": "Sofia",
  "walidvb@gmail.com": "Walid",
  "benjaminruthven@aol.com": "Benji",
  "billyboyali@gmail.com": "Bilal",
  "cf6nq9k22f@privaterelay.appleid.com": "there",
  "emwhitenoise@gmail.com": "Emily",
  "jbektemba0711@gmail.com": "Jelani",
  "mashinerie@gmail.com": "hello",
  "t8bm2sdryx@privaterelay.appleid.com": "user1",
  "v8yykfdgbd@privaterelay.appleid.com": "cpl",
  "yaldahesh@gmail.com": "Yalda",
  "pierre.elie.fauche@gmail.com": "Pierre-Elie",
  "margot2themax@gmail.com": "Margot",
  "akumenmusic@gmail.com": "Tony",
};

const EXCLUDE_EMAILS = new Set([
  "maiii@posteo.la",
  "64j87qk747@privaterelay.appleid.com",
]);

// Pending DJs (no account yet) — same list as dj-newsletter route.
const EXTRA_PENDING_DJS: Array<{ email: string; name: string; id: string }> = [
  { email: "paulsboston@gmail.com", name: "Paul", id: "pending-spillman" },
  { email: "juniorsbl@gmail.com", name: "Junior", id: "pending-junior" },
  { email: "hello@justinmiller.nyc", name: "Justin", id: "pending-justin" },
  { email: "cesartoribio1@gmail.com", name: "Cesar", id: "pending-toribio" },
  { email: "celebritybitcrush@gmail.com", name: "Keigo", id: "pending-celebritybitcrush" },
  { email: "dorwand@gmail.com", name: "Dor", id: "pending-dorwand" },
  { email: "omer.almileik@gmail.com", name: "Omer", id: "pending-omer" },
];

// Extra listeners — radio-notify waitlist signups without a `users` doc
// that we still want included in the broadcast.
const EXTRA_LISTENERS: Array<{ email: string; name: string; id: string }> = [
  { email: "alexandra.sentisfranco@gmail.com", name: "Alexandra", id: "waitlist-alexandra" },
  { email: "charles.fages@gmail.com", name: "Charles", id: "waitlist-charles" },
  { email: "emroseclements@gmail.com", name: "Em Rose", id: "waitlist-emrose" },
  { email: "jahichambers@gmail.com", name: "Jahi", id: "waitlist-jahi" },
];

function minifyHtml(html: string): string {
  return html.replace(/\n\s+/g, "\n").replace(/\n+/g, "\n").trim();
}

function resolveFirstName(email: string, name?: string, chatUsername?: string): string {
  const override = FIRST_NAME_OVERRIDES[email];
  if (override) return override;
  if (name && name.trim()) return name.trim().split(/\s+/)[0];
  if (chatUsername && chatUsername.trim()) return chatUsername.trim();
  return "there";
}

// Capitalize the first letter (Unicode-safe) without touching the rest,
// so "aurelien" → "Aurelien", "jérémie" → "Jérémie", "DJ Valerian" stays.
function capitalize(s: string): string {
  if (!s) return s;
  const first = s.charAt(0);
  const upper = first.toLocaleUpperCase();
  if (first === upper) return s;
  return upper + s.slice(1);
}

function buildEmailHtml(name: string, cohort: Cohort): string {
  const displayName = capitalize(name);
  const unsubscribeCategory = cohort === "dj" ? "dj" : "marketing";
  const settingsUrl = `${APP_URL}/settings?unsubscribe=${unsubscribeCategory}`;
  const footerText = cohort === "dj"
    ? "You're receiving this as an artist on Channel."
    : "You're receiving this as a member of Channel.";

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
          <td align="center" style="padding: 40px 16px;" bgcolor="#ffffff">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 720px;">
              <tr>
                <td align="center" style="padding-bottom: 32px;" bgcolor="#ffffff">
                  <a href="${APP_URL}" style="text-decoration: none;"><img src="${LOGO_URL}" alt="Channel" width="120" style="width: 120px; height: auto;" /></a>
                </td>
              </tr>
              <tr>
                <td bgcolor="#ffffff" style="font-size: 15px; line-height: 1.6; color: #1a1a1a;">
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Hi ${displayName},</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Channel is starting to take shape.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Over the past couple weeks, a number of DJs and producers have been playing, and something is emerging through that.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">I've started posting moments from the shows here, and will share upcoming sessions as they happen:<br/><a href="https://instagram.com/channelrad.io" style="color: #1a1a1a;">https://instagram.com/channelrad.io</a></p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">All past shows are available on the website:<br/><a href="https://channel-app.com" style="color: #1a1a1a;">https://channel-app.com</a></p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;"><strong>A series of live shows are coming up this week across LA and NY</strong>, spanning a range of sounds — from ambient to house, techno, and more experimental edges.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Stay tuned.</p>
                  <p style="margin: 0; color: #1a1a1a;">Cap</p>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top: 32px; border-top: 1px solid #e5e5e5;" bgcolor="#ffffff">
                  <p style="margin: 0 0 12px; font-size: 13px; color: #999;">
                    ${footerText}
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

type Recipient = { email: string; name: string; id: string; cohort: Cohort };

async function getDjRecipients(db: FirebaseFirestore.Firestore): Promise<Recipient[]> {
  const snap = await db.collection("users").where("role", "==", "dj").get();
  const out: Recipient[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.email) continue;
    if (EXCLUDE_EMAILS.has(data.email)) continue;
    if (!data.emailNotifications?.djInsiders) continue;
    out.push({
      email: data.email,
      name: resolveFirstName(data.email, data.name, data.chatUsername),
      id: doc.id,
      cohort: "dj",
    });
  }
  for (const pending of EXTRA_PENDING_DJS) {
    if (EXCLUDE_EMAILS.has(pending.email)) continue;
    if (out.some((r) => r.email === pending.email)) continue;
    out.push({ ...pending, cohort: "dj" });
  }
  return out;
}

async function getListenerRecipients(
  db: FirebaseFirestore.Firestore,
  djEmails: Set<string>,
): Promise<Recipient[]> {
  const snap = await db.collection("users").get();
  const out: Recipient[] = [];
  const seen = new Set<string>();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.email) continue;
    const email = data.email as string;
    if (EXCLUDE_EMAILS.has(email)) continue;
    if (djEmails.has(email)) continue;
    // Skip any user with a DJ-adjacent role; they belong to the DJ cohort even
    // if djInsiders is off (they already opted out of DJ emails explicitly).
    if (data.role === "dj" || data.role === "broadcaster" || data.role === "admin") continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      name: resolveFirstName(email, data.name, data.chatUsername),
      id: doc.id,
      cohort: "listener",
    });
  }
  for (const extra of EXTRA_LISTENERS) {
    if (EXCLUDE_EMAILS.has(extra.email)) continue;
    if (djEmails.has(extra.email)) continue;
    if (out.some((r) => r.email === extra.email)) continue;
    out.push({ ...extra, cohort: "listener" });
  }
  return out;
}

// Modes:
//   ?mode=preview&cohort=dj|listener[&to=foo@bar.com]
//   ?mode=dry-run&cohort=dj|listener|all  (default = all)
//   ?mode=compare&lastSubject=...&cohort=dj|listener|all
//   ?mode=send&cohort=dj|listener|all     (LOCKED until SEND_ENABLED=true)

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get("mode") || "dry-run";
  const cohortParam = (request.nextUrl.searchParams.get("cohort") || "all") as
    | "dj"
    | "listener"
    | "all";

  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const djRecipients = await getDjRecipients(db);
  const djEmails = new Set(djRecipients.map((r) => r.email));
  const listenerRecipients =
    cohortParam === "dj" ? [] : await getListenerRecipients(db, djEmails);

  const selected: Recipient[] =
    cohortParam === "dj"
      ? djRecipients
      : cohortParam === "listener"
        ? listenerRecipients
        : [...djRecipients, ...listenerRecipients];

  // ── Preview ──
  if (mode === "preview") {
    if (!resend) {
      return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
    }
    if (cohortParam === "all") {
      return NextResponse.json({ error: "preview requires cohort=dj|listener" }, { status: 400 });
    }
    const toParam = request.nextUrl.searchParams.get("to");
    const previewTo = toParam || "cap@channel-app.com";
    const previewName = toParam
      ? (selected.find((r) => r.email === toParam)?.name || "Cap")
      : "Cap";
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: previewTo,
        subject: SUBJECT,
        html: buildEmailHtml(previewName, cohortParam),
        headers: getUnsubscribeHeaders(cohortParam === "dj" ? "dj" : "marketing"),
      });
      return NextResponse.json({
        mode: "preview",
        cohort: cohortParam,
        sentTo: previewTo,
        greetedAs: previewName,
        subject: SUBJECT,
      });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  // ── Dry-run ──
  if (mode === "dry-run") {
    const unresolved = selected.filter((r) => r.name === "there");
    return NextResponse.json({
      mode: "dry-run",
      cohort: cohortParam,
      subject: SUBJECT,
      totals: {
        dj: djRecipients.length,
        listener: listenerRecipients.length,
        selected: selected.length,
      },
      unresolvedGreetingCount: unresolved.length,
      unresolvedGreetings: unresolved.map((r) => ({ email: r.email, cohort: r.cohort })),
      recipients: selected.map((r) => ({
        email: r.email,
        firstName: r.name,
        cohort: r.cohort,
      })),
    });
  }

  // ── Compare (diff against a prior send by subject) ──
  if (mode === "compare") {
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: "Resend API key not configured" }, { status: 500 });
    }
    const lastSubject = request.nextUrl.searchParams.get("lastSubject");
    if (!lastSubject) {
      return NextResponse.json(
        { error: "Pass ?lastSubject=... to diff against a prior send" },
        { status: 400 },
      );
    }
    const r = await fetch("https://api.resend.com/emails?limit=100", {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    if (!r.ok) {
      return NextResponse.json({ error: `Resend API: ${r.status}` }, { status: 500 });
    }
    const data = (await r.json()) as {
      data: Array<{ to: string[]; subject: string; last_event: string; created_at: string }>;
    };
    const priorSends = data.data.filter((e) => e.subject === lastSubject);
    const priorEmails = new Set(
      priorSends.map((e) => e.to[0]).filter((e) => e !== "cap@channel-app.com"),
    );
    const currentEmails = new Set(selected.map((r) => r.email));
    const added = Array.from(currentEmails).filter((e) => !priorEmails.has(e));
    const removed = Array.from(priorEmails).filter((e) => !currentEmails.has(e));
    const unchanged = Array.from(currentEmails).filter((e) => priorEmails.has(e));
    return NextResponse.json({
      mode: "compare",
      cohort: cohortParam,
      lastSubject,
      currentSubject: SUBJECT,
      priorSendCount: priorEmails.size,
      currentRecipientCount: currentEmails.size,
      added,
      removed,
      unchangedCount: unchanged.length,
    });
  }

  // ── Send (LOCKED) ──
  if (mode === "send") {
    const SEND_ENABLED = false;
    if (!SEND_ENABLED) {
      return NextResponse.json({
        error: "Send mode is locked. Set SEND_ENABLED = true in code when ready.",
        cohort: cohortParam,
        totalSelected: selected.length,
      });
    }
    if (!resend) {
      return NextResponse.json({ error: "Resend not configured" }, { status: 500 });
    }
    let sent = 0;
    let failed = 0;
    const errors: Array<{ email: string; error: string }> = [];
    for (const recipient of selected) {
      try {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: recipient.email,
          subject: SUBJECT,
          html: buildEmailHtml(recipient.name, recipient.cohort),
          headers: getUnsubscribeHeaders(recipient.cohort === "dj" ? "dj" : "marketing"),
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
      cohort: cohortParam,
      sent,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    });
  }

  return NextResponse.json(
    { error: "Invalid mode. Use: preview, dry-run, compare, send" },
    { status: 400 },
  );
}
