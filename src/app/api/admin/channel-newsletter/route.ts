import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAdminDb } from "@/lib/firebase-admin";
function buildListUnsubscribeHeaders(email: string, category: "dj" | "marketing") {
  const url = buildUnsubscribeUrl(email, category);
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = "Cap from Channel <cap@channel-app.com>";
const LOGO_URL = "https://channel-app.com/logo-black.png";
const APP_URL = "https://channel-app.com";
const SUBJECT = "Two scenes are emerging";

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
  "5kyriv3r5@gmail.com": "Michael",
};

const EXCLUDE_EMAILS = new Set([
  "maiii@posteo.la",
  "64j87qk747@privaterelay.appleid.com",
]);

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

function buildUnsubscribeUrl(email: string, category: "dj" | "marketing"): string {
  const token = Buffer.from(email.trim().toLowerCase()).toString("base64");
  return `${APP_URL}/api/newsletter-unsubscribe?token=${encodeURIComponent(token)}&c=${category}`;
}

function buildEmailHtml(name: string, cohort: Cohort, email: string): string {
  const displayName = capitalize(name);
  const category: "dj" | "marketing" = cohort === "dj" ? "dj" : "marketing";
  const settingsUrl = buildUnsubscribeUrl(email, category);
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
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Channel has been growing steadily over the past weeks, and I'm seeing two scenes form through the shows.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">One is more trippy and experimental, the other more groovy and social.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Check them out:<br/>🌀 <a href="https://channel-app.com/radio?spiral" style="color: #1a1a1a;">https://channel-app.com/radio?spiral</a><br/>💎 <a href="https://channel-app.com/radio?diamond" style="color: #1a1a1a;">https://channel-app.com/radio?diamond</a></p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">More shows are coming in this week across LA and NY.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Daily clips on IG <a href="https://instagram.com/channelrad.io" style="color: #1a1a1a; text-decoration: underline;">@channelrad.io</a></p>
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
    // Respect explicit marketing opt-out — unsubscribing from the channel
    // newsletter sets marketing=false even for DJs.
    if (data.emailNotifications?.marketing === false) continue;
    out.push({
      email: data.email,
      name: resolveFirstName(data.email, data.name, data.chatUsername),
      id: doc.id,
      cohort: "dj",
    });
  }

  // Pending DJs live in pending-dj-profiles — auto-pull every doc with an
  // email, skip any flagged unsubscribed=true, and dedupe against the
  // users-sourced DJ set above.
  const pendingSnap = await db.collection("pending-dj-profiles").get();
  const seenEmails = new Set(out.map((r) => r.email.toLowerCase()));
  for (const doc of pendingSnap.docs) {
    const data = doc.data();
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    if (!email) continue;
    if (data.unsubscribed === true) continue;
    if (EXCLUDE_EMAILS.has(email)) continue;
    if (seenEmails.has(email)) continue;
    seenEmails.add(email);
    out.push({
      email,
      name: resolveFirstName(email, data.name, data.chatUsername),
      id: doc.id,
      cohort: "dj",
    });
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
    // Honour explicit marketing opt-out.
    if (data.emailNotifications?.marketing === false) continue;
    seen.add(email);
    out.push({
      email,
      name: resolveFirstName(email, data.name, data.chatUsername),
      id: doc.id,
      cohort: "listener",
    });
  }

  // Waitlist signups feeding EXTRA_LISTENERS; skip any whose waitlist
  // doc is flagged unsubscribed=true.
  const waitlistUnsubscribed = new Set<string>();
  const waitlistSnap = await db.collection("radio-notify-waitlist").get();
  for (const doc of waitlistSnap.docs) {
    const data = doc.data();
    if (data.email && data.unsubscribed === true) {
      waitlistUnsubscribed.add((data.email as string).toLowerCase());
    }
  }

  for (const extra of EXTRA_LISTENERS) {
    if (EXCLUDE_EMAILS.has(extra.email)) continue;
    if (djEmails.has(extra.email)) continue;
    if (waitlistUnsubscribed.has(extra.email.toLowerCase())) continue;
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
    const asParam = request.nextUrl.searchParams.get("as");
    const previewTo = toParam || "cap@channel-app.com";
    // The "as" email drives the unsubscribe token + greeted name so we can
    // simulate sends from a specific cohort source (pending DJ, waitlist, etc.)
    // while still delivering to the test inbox.
    const tokenEmail = asParam || previewTo;
    const matched = selected.find((r) => r.email === tokenEmail);
    const previewName = matched?.name || (toParam ? "Cap" : "Cap");
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: previewTo,
        subject: `[test as ${tokenEmail}] ${SUBJECT}`,
        html: buildEmailHtml(previewName, cohortParam, tokenEmail),
        headers: buildListUnsubscribeHeaders(tokenEmail, cohortParam === "dj" ? "dj" : "marketing"),
      });
      return NextResponse.json({
        mode: "preview",
        cohort: cohortParam,
        sentTo: previewTo,
        unsubscribeTokenFor: tokenEmail,
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
    const SEND_ENABLED = false; // ← last send 72/72 on 2026-04-20; planned 2026-04-27
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
          html: buildEmailHtml(recipient.name, recipient.cohort, recipient.email),
          headers: buildListUnsubscribeHeaders(recipient.email, recipient.cohort === "dj" ? "dj" : "marketing"),
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
