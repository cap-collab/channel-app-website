// Shared helpers for the channel-wide newsletter (admin route + Monday crons).
// Anything that needs to build recipient lists, email HTML, or send the
// campaign should import from here — not duplicate logic in the route.

export const NEWSLETTER_FROM_EMAIL = "Cap from Channel <cap@channel-app.com>";
export const NEWSLETTER_LOGO_URL = "https://channel-app.com/logo-black.png";
export const NEWSLETTER_APP_URL = "https://channel-app.com";
export const NEWSLETTER_SUBJECT = "Two scenes are emerging";

export type Cohort = "dj" | "listener";
export type Recipient = { email: string; name: string; id: string; cohort: Cohort };

// First-name overrides: highest priority, applied before Firebase fields.
// Priority: override → name → displayName → chatUsername → "there".
export const FIRST_NAME_OVERRIDES: Record<string, string> = {
  "anthonypomije@gmail.com": "Anthony",
  "paulsboston@gmail.com": "Paul",
  "kevinlipman7@gmail.com": "Kevin",
  "drew.labarre@gmail.com": "Drew",
  "celebritybitcrush@gmail.com": "Keigo",
  "cap@beyondalgorithms.cloud": "Cap",
  "2ty7cmd5tf@privaterelay.appleid.com": "Cap",
  "hello@justinmiller.nyc": "Justin",
  "m6kdesign@gmail.com": "Maxim",
  "omer.almileik@gmail.com": "Omer",
  "aubespin@gmail.com": "David",
  "jchatard@outlook.fr": "JP",
  "powell.oliver@me.com": "Oliver",
  "ssantos2107@gmail.com": "Sofia",
  "walidvb@gmail.com": "Walid",
  "benjaminruthven@aol.com": "Benji",
  "billyboyali@gmail.com": "Bilal",
  "cf6nq9k22f@privaterelay.appleid.com": "Sam",
  "emwhitenoise@gmail.com": "Emily",
  "jbektemba0711@gmail.com": "Jelani",
  "mashinerie@gmail.com": "Antonia",
  "t8bm2sdryx@privaterelay.appleid.com": "Shane",
  "v8yykfdgbd@privaterelay.appleid.com": "Christian",
  "yaldahesh@gmail.com": "Yalda",
  "pierre.elie.fauche@gmail.com": "Pierre-Elie",
  "margot2themax@gmail.com": "Margot",
  "akumenmusic@gmail.com": "Tony",
  "5kyriv3r5@gmail.com": "Michael",
  "7bv6k4cjvc@privaterelay.appleid.com": "Robert",
  "7mpnw5xkkh@privaterelay.appleid.com": "Marianne",
  "alexandra.sentisfranco@gmail.com": "Alexandra",
  "bqbwvhdq7v@privaterelay.appleid.com": "Ana",
  "dcosenza31@gmail.com": "Dan",
  "djfp9n86bf@privaterelay.appleid.com": "Eduardo",
  "jagewuel@gmail.com": "Will",
  "jahichambers@gmail.com": "Jahi",
  "jonathanamar28@gmail.com": "J",
  "markdcramer@gmail.com": "Mark",
  "pwbrs7rxyt@privaterelay.appleid.com": "Natalie",
  "rmt7jxvkc5@privaterelay.appleid.com": "Jon",
  "tabicat22@gmail.com": "Tabitha",
  "thomas@sidewalk-consulting.com": "Thomas",
  "valerianspaceparty@gmail.com": "there",
  "atomic.records.boutique@gmail.com": "Corey",
  "charles.fages@gmail.com": "Charles",
};

export const EXCLUDE_EMAILS = new Set<string>([
  "maiii@posteo.la",
  "64j87qk747@privaterelay.appleid.com",
]);

// Extra listeners — radio-notify waitlist signups without a `users` doc.
const EXTRA_LISTENERS: Array<{ email: string; name: string; id: string }> = [
  { email: "alexandra.sentisfranco@gmail.com", name: "Alexandra", id: "waitlist-alexandra" },
  { email: "charles.fages@gmail.com", name: "Charles", id: "waitlist-charles" },
  { email: "emroseclements@gmail.com", name: "Em Rose", id: "waitlist-emrose" },
  { email: "jahichambers@gmail.com", name: "Jahi", id: "waitlist-jahi" },
];

function minifyHtml(html: string): string {
  return html.replace(/\n\s+/g, "\n").replace(/\n+/g, "\n").trim();
}

export function resolveFirstName(
  email: string,
  name?: string,
  chatUsername?: string,
  displayName?: string,
): string {
  const override = FIRST_NAME_OVERRIDES[email];
  if (override) return override;
  if (name && name.trim()) return name.trim().split(/\s+/)[0];
  if (displayName && displayName.trim()) return displayName.trim().split(/\s+/)[0];
  if (chatUsername && chatUsername.trim()) return chatUsername.trim();
  return "there";
}

// Capitalize the first letter (Unicode-safe) without touching the rest.
export function capitalize(s: string): string {
  if (!s) return s;
  const first = s.charAt(0);
  const upper = first.toLocaleUpperCase();
  if (first === upper) return s;
  return upper + s.slice(1);
}

export function buildUnsubscribeUrl(email: string, category: "dj" | "marketing"): string {
  const token = Buffer.from(email.trim().toLowerCase()).toString("base64");
  return `${NEWSLETTER_APP_URL}/api/newsletter-unsubscribe?token=${encodeURIComponent(token)}&c=${category}`;
}

export function buildListUnsubscribeHeaders(email: string, category: "dj" | "marketing") {
  const url = buildUnsubscribeUrl(email, category);
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export function buildEmailHtml(name: string, cohort: Cohort, email: string): string {
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
                  <a href="${NEWSLETTER_APP_URL}" style="text-decoration: none;"><img src="${NEWSLETTER_LOGO_URL}" alt="Channel" width="120" style="width: 120px; height: auto;" /></a>
                </td>
              </tr>
              <tr>
                <td bgcolor="#ffffff" style="font-size: 15px; line-height: 1.6; color: #1a1a1a;">
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Hi ${displayName},</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">Channel has been growing steadily over the past weeks, and I'm seeing two scenes form through the shows.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;">One is more trippy and experimental, the other more groovy and social.</p>
                  <p style="margin: 0 0 16px; color: #1a1a1a;"><strong>Check them out:</strong><br/><span style="font-size: 1.25em; line-height: 1; vertical-align: -0.08em;">🌀</span> <a href="https://channel-app.com/radio?spiral" style="color: #1a1a1a;">https://channel-app.com/radio?spiral</a><br/><span style="font-size: 1.4em; line-height: 1; vertical-align: -0.1em;">✳</span> <a href="https://channel-app.com/radio?star" style="color: #1a1a1a;">https://channel-app.com/radio?star</a></p>
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

export async function getDjRecipients(db: FirebaseFirestore.Firestore): Promise<Recipient[]> {
  const snap = await db.collection("users").where("role", "==", "dj").get();
  const out: Recipient[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.email) continue;
    if (EXCLUDE_EMAILS.has(data.email)) continue;
    if (!data.emailNotifications?.djInsiders) continue;
    if (data.emailNotifications?.marketing === false) continue;
    out.push({
      email: data.email,
      name: resolveFirstName(data.email, data.name, data.chatUsername, data.displayName),
      id: doc.id,
      cohort: "dj",
    });
  }

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
      name: resolveFirstName(email, data.name, data.chatUsername, data.displayName),
      id: doc.id,
      cohort: "dj",
    });
  }
  return out;
}

export async function getListenerRecipients(
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
    if (data.role === "dj" || data.role === "broadcaster" || data.role === "admin") continue;
    if (seen.has(email)) continue;
    if (data.emailNotifications?.marketing === false) continue;
    seen.add(email);
    out.push({
      email,
      name: resolveFirstName(email, data.name, data.chatUsername, data.displayName),
      id: doc.id,
      cohort: "listener",
    });
  }

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

export type AuditRow = {
  email: string;
  source: "users-dj" | "users-non-dj" | "pending-dj" | "waitlist";
  role: string;
  name: string | null;
  displayName: string | null;
  chatUsername: string | null;
  unsubscribed: boolean;
  unsubReason: string[];
  onNextSend: boolean;
  onNextSendCohort: "dj" | "listener" | null;
  currentFirstName: string;
  displayNameFirstWord: string | null;
};

function firstWord(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  return t.split(/\s+/)[0];
}

export async function buildAuditRows(db: FirebaseFirestore.Firestore): Promise<AuditRow[]> {
  const sendDjs = await getDjRecipients(db);
  const sendDjEmails = new Set(sendDjs.map((r) => r.email.toLowerCase()));
  const sendListeners = await getListenerRecipients(db, new Set(sendDjs.map((r) => r.email)));
  const sendListenerEmails = new Set(sendListeners.map((r) => r.email.toLowerCase()));

  const rows: AuditRow[] = [];
  const seen = new Set<string>();

  const usersSnap = await db.collection("users").get();
  for (const doc of usersSnap.docs) {
    const d = doc.data();
    if (!d.email) continue;
    const email = (d.email as string).toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const role = (d.role as string) || "";
    const unsubReasons: string[] = [];
    if (d.emailNotifications?.marketing === false) unsubReasons.push("marketing=false");
    if (role === "dj" && d.emailNotifications?.djInsiders === false) unsubReasons.push("djInsiders=false");
    if (EXCLUDE_EMAILS.has(email)) unsubReasons.push("excluded");
    const onDj = sendDjEmails.has(email);
    const onListener = sendListenerEmails.has(email);
    rows.push({
      email,
      source: role === "dj" ? "users-dj" : "users-non-dj",
      role,
      name: d.name ?? null,
      displayName: d.displayName ?? null,
      chatUsername: d.chatUsername ?? null,
      unsubscribed: unsubReasons.length > 0,
      unsubReason: unsubReasons,
      onNextSend: onDj || onListener,
      onNextSendCohort: onDj ? "dj" : onListener ? "listener" : null,
      currentFirstName: resolveFirstName(email, d.name, d.chatUsername, d.displayName),
      displayNameFirstWord: firstWord(d.displayName),
    });
  }

  const pendingSnap = await db.collection("pending-dj-profiles").get();
  for (const doc of pendingSnap.docs) {
    const d = doc.data();
    if (!d.email) continue;
    const email = (d.email as string).toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const unsubReasons: string[] = [];
    if (d.unsubscribed === true) unsubReasons.push("pending.unsubscribed=true");
    if (EXCLUDE_EMAILS.has(email)) unsubReasons.push("excluded");
    const onDj = sendDjEmails.has(email);
    rows.push({
      email,
      source: "pending-dj",
      role: "(pending dj)",
      name: d.name ?? null,
      displayName: d.displayName ?? null,
      chatUsername: d.chatUsername ?? null,
      unsubscribed: unsubReasons.length > 0,
      unsubReason: unsubReasons,
      onNextSend: onDj,
      onNextSendCohort: onDj ? "dj" : null,
      currentFirstName: resolveFirstName(email, d.name, d.chatUsername, d.displayName),
      displayNameFirstWord: firstWord(d.displayName),
    });
  }

  const waitlistSnap = await db.collection("radio-notify-waitlist").get();
  for (const doc of waitlistSnap.docs) {
    const d = doc.data();
    if (!d.email) continue;
    const email = (d.email as string).toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const unsubReasons: string[] = [];
    if (d.unsubscribed === true) unsubReasons.push("waitlist.unsubscribed=true");
    if (EXCLUDE_EMAILS.has(email)) unsubReasons.push("excluded");
    const onListener = sendListenerEmails.has(email);
    rows.push({
      email,
      source: "waitlist",
      role: "(waitlist)",
      name: d.name ?? null,
      displayName: d.displayName ?? null,
      chatUsername: null,
      unsubscribed: unsubReasons.length > 0,
      unsubReason: unsubReasons,
      onNextSend: onListener,
      onNextSendCohort: onListener ? "listener" : null,
      currentFirstName: resolveFirstName(email, d.name, undefined, d.displayName),
      displayNameFirstWord: firstWord(d.displayName),
    });
  }

  rows.sort((a, b) => {
    if (a.onNextSend !== b.onNextSend) return a.onNextSend ? -1 : 1;
    return a.email.localeCompare(b.email);
  });
  return rows;
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildAuditHtml(rows: AuditRow[]): string {
  const onSend = rows.filter((r) => r.onNextSend).length;
  const unsubbed = rows.filter((r) => r.unsubscribed).length;
  const headers = [
    "DJ / User",
    "Unsub?",
    "Email",
    "First name (as of now)",
    "displayName first word",
    "→ Your override",
  ];
  const th = headers
    .map((h) => `<th style="text-align:left;padding:6px 8px;border:1px solid #ddd;font-size:12px;background:#f6f6f6;">${h}</th>`)
    .join("");
  const trs = rows
    .map((r) => {
      const rowBg = r.onNextSend ? "#ffffff" : "#fafafa";
      const djOrUser =
        r.source === "users-dj" || r.source === "pending-dj"
          ? "DJ"
          : r.source === "waitlist"
            ? "Waitlist"
            : "User";
      const cells = [
        djOrUser,
        r.unsubscribed ? "YES" : "",
        r.email,
        r.currentFirstName,
        r.displayNameFirstWord ?? "",
        "",
      ];
      return `<tr style="background:${rowBg};">${cells.map((c) => `<td style="padding:6px 8px;border:1px solid #ddd;font-size:12px;vertical-align:top;">${escapeHtml(String(c))}</td>`).join("")}</tr>`;
    })
    .join("");
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,Arial,sans-serif;color:#111;">
    <h2 style="margin:0 0 8px;">Channel newsletter recipient audit</h2>
    <p style="margin:0 0 16px;font-size:13px;color:#555;">
      Total rows: <strong>${rows.length}</strong> · on next send: <strong>${onSend}</strong> · unsubscribed: <strong>${unsubbed}</strong>
    </p>
    <p style="margin:0 0 16px;font-size:13px;color:#555;">
      Reply with overrides in the form <code>email => FirstName</code> (one per line). Use <code>there</code> for neutral greeting, or <code>REMOVE</code> to exclude someone from the next send.
    </p>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
      <thead><tr>${th}</tr></thead>
      <tbody>${trs}</tbody>
    </table>
  </body></html>`;
}
