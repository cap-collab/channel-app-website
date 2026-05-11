// Shared helpers for the channel-wide newsletter (admin route + Monday crons).
// Anything that needs to build recipient lists, email HTML, or send the
// campaign should import from here — not duplicate logic in the route.

export type Cohort = "dj" | "listener";
export type Recipient = {
  email: string;
  name: string;
  id: string;
  cohort: Cohort;
  djUsername?: string;
};

export const NEWSLETTER_FROM_EMAIL = "Cap from Channel <cap@channel-app.com>";
export const NEWSLETTER_LOGO_URL = "https://channel-app.com/logo-black.png";
export const NEWSLETTER_APP_URL = "https://channel-app.com";
export const NEWSLETTER_SUBJECTS: Record<Cohort, string> = {
  dj: "Channel is now non stop radio",
  listener: "Channel is now non stop radio",
};

export function subjectFor(cohort: Cohort): string {
  return NEWSLETTER_SUBJECTS[cohort];
}

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
  "jeremieemk@gmail.com": "Jeremie",
  "nopressure.gng@gmail.com": "Nopressure",
  "notjoshua@gmail.com": "heckadecimal",
  "omar41309@yahoo.com": "Omar",
  "thinkabtrecords@proton.me": "Ava",
};

export const EXCLUDE_EMAILS = new Set<string>([
  "maiii@posteo.la",
  "64j87qk747@privaterelay.appleid.com",
  // Waitlist spam — Gmail dot-stuffed addresses, won't deliver and risk
  // hurting our sender reputation if Gmail flags them as fake.
  "c.epuz.i.z.o.b.i.so.63@gmail.com",
  "eho.na.siloh.ek9.0@gmail.com",
  "h.o.o.dd.j.o.rd.j.8.9@gmail.com",
  "varavag.u.t.80.1@gmail.com",
]);

// Extra listeners — radio-notify waitlist signups without a `users` doc.
const EXTRA_LISTENERS: Array<{ email: string; name: string; id: string }> = [
  { email: "alexandra.sentisfranco@gmail.com", name: "Alexandra", id: "waitlist-alexandra" },
  { email: "charles.fages@gmail.com", name: "Charles", id: "waitlist-charles" },
  { email: "emroseclements@gmail.com", name: "Em Rose", id: "waitlist-emrose" },
  { email: "jahichambers@gmail.com", name: "Jahi", id: "waitlist-jahi" },
];

// Extra DJs — approved applicants who have a show booked but haven't
// created a `users` account yet. djUsername intentionally left undefined:
// their /dj/<slug> page renders 404 until they onboard, so the Channel
// link falls back to the site root.
const EXTRA_DJS: Array<{ email: string; name: string; id: string; djUsername?: string }> = [
  { email: "jaketurpin@minimal.audio", name: "Jake", id: "applicant-jaketurpin" },
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

  const cleanName = name?.trim() ? name.trim().split(/\s+/)[0] : "";
  const cleanDisplay = displayName?.trim() ? displayName.trim().split(/\s+/)[0] : "";
  const cleanChat = chatUsername?.trim() ? chatUsername.trim() : "";

  // Priority: name → displayName → chatUsername (used as last-resort fallback
  // for DJs who never set a real name). Same chain for both cohorts.
  const resolved = cleanName || cleanDisplay || cleanChat || "there";

  if (resolved === "there") return resolved;
  return capitalize(resolved);
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

export function buildEmailHtml(
  name: string,
  cohort: Cohort,
  email: string,
  djUsername?: string,
): string {
  // resolveFirstName already handles capitalization (overrides preserved as-is,
  // fallbacks capitalized) — don't double-capitalize here.
  const displayName = name;
  const category: "dj" | "marketing" = cohort === "dj" ? "dj" : "marketing";
  const settingsUrl = buildUnsubscribeUrl(email, category);
  const footerText = cohort === "dj"
    ? "You're receiving this as an artist on Channel."
    : "You're receiving this as a member of Channel.";

  const djProfileUrl = djUsername
    ? `${NEWSLETTER_APP_URL}/dj/${encodeURIComponent(djUsername)}`
    : NEWSLETTER_APP_URL;

  const djFooterBlock = cohort === "dj" ? `
    <p style="margin: 24px 0 8px; font-size: 12px; color: #999;">*</p>
    <p style="margin: 0 0 10px; font-size: 12px; line-height: 1.5; color: #999;">Most shows are uploaded shortly after broadcast.</p>
    <p style="margin: 0 0 6px; font-size: 12px; line-height: 1.5; color: #999;">Channel<br/>
      <a href="${djProfileUrl}" style="color: #999;">${djProfileUrl}</a>
    </p>
    <p style="margin: 0 0 6px; font-size: 12px; line-height: 1.5; color: #999;">YouTube<br/>
      <a href="https://youtube.com/@channelrad-io" style="color: #999;">https://youtube.com/@channelrad-io</a>
    </p>
    <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #999;">SoundCloud<br/>
      <a href="https://soundcloud.com/channel-254533657" style="color: #999;">https://soundcloud.com/channel-254533657</a>
    </p>
  ` : "";

  const listenerFooterBlock = cohort === "listener" ? `
    <p style="margin: 24px 0 8px; font-size: 12px; color: #999;">*</p>
    <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #999;">Live moments and clips:<br/>
      <a href="https://instagram.com/channelrad.io" style="color: #999;">https://instagram.com/channelrad.io</a>
    </p>
  ` : "";

  const body = `
    <p style="margin: 0 0 16px; color: #1a1a1a;">Hi ${displayName},</p>
    <p style="margin: 0 0 16px; color: #1a1a1a;"><strong>Channel is now running continuously, 24/7.</strong></p>
    <p style="margin: 0 0 16px; color: #1a1a1a;">Live sets and restreams moving throughout day and night.</p>
    <p style="margin: 0 0 16px; color: #1a1a1a;"><strong>Lock in:</strong><br/>
      <a href="${NEWSLETTER_APP_URL}" style="color: #1a1a1a;">https://channel-app.com</a>
    </p>
    <p style="margin: 0; color: #1a1a1a;">Cap</p>
    ${djFooterBlock}
    ${listenerFooterBlock}
  `;

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
                  ${body}
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

function resolveDjUsername(data: FirebaseFirestore.DocumentData): string | undefined {
  const normalized = typeof data.chatUsernameNormalized === "string" ? data.chatUsernameNormalized.trim() : "";
  if (normalized) return normalized;
  const raw = typeof data.chatUsername === "string" ? data.chatUsername.trim() : "";
  if (!raw) return undefined;
  return raw.replace(/[\s-]+/g, "").toLowerCase();
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
      djUsername: resolveDjUsername(data),
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
      djUsername: resolveDjUsername(data),
    });
  }

  for (const extra of EXTRA_DJS) {
    if (EXCLUDE_EMAILS.has(extra.email)) continue;
    if (seenEmails.has(extra.email.toLowerCase())) continue;
    seenEmails.add(extra.email.toLowerCase());
    out.push({ ...extra, cohort: "dj" });
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
    if (!data.email) continue;
    const emailLower = (data.email as string).toLowerCase();
    if (data.unsubscribed === true) {
      waitlistUnsubscribed.add(emailLower);
      continue;
    }
    if (EXCLUDE_EMAILS.has(emailLower)) continue;
    if (djEmails.has(data.email as string)) continue;
    if (seen.has(data.email as string)) continue;
    seen.add(data.email as string);
    out.push({
      email: data.email as string,
      name: resolveFirstName(emailLower, data.name, undefined, data.displayName),
      id: doc.id,
      cohort: "listener",
    });
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
  source: "users-dj" | "users-non-dj" | "pending-dj" | "waitlist" | "extra-dj" | "extra-listener";
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
  // For DJ rows, the link Cap will include in the email — either the
  // personalized /dj/<slug> URL or the site-root fallback if no slug exists.
  // null for non-DJ rows.
  djProfileUrl: string | null;
  // Raw emailNotifications flags so the audit can explain why someone
  // isn't on next send (e.g. djInsiders undefined).
  djInsiders: boolean | null;
  marketing: boolean | null;
};

const FALLBACK_DJ_URL = `${NEWSLETTER_APP_URL}/`;

function djProfileUrlFor(data: FirebaseFirestore.DocumentData): string {
  const slug = resolveDjUsername(data);
  return slug
    ? `${NEWSLETTER_APP_URL}/dj/${encodeURIComponent(slug)}`
    : FALLBACK_DJ_URL;
}

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
      djProfileUrl: role === "dj" ? djProfileUrlFor(d) : null,
      djInsiders: d.emailNotifications?.djInsiders ?? null,
      marketing: d.emailNotifications?.marketing ?? null,
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
      djProfileUrl: djProfileUrlFor(d),
      djInsiders: d.emailNotifications?.djInsiders ?? null,
      marketing: d.emailNotifications?.marketing ?? null,
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
      djProfileUrl: null,
      djInsiders: null,
      marketing: null,
    });
  }

  // In-code extras (approved DJs without a Firestore profile, waitlist
  // shortcuts) — Firestore loops above will miss these, so add them here.
  for (const extra of EXTRA_DJS) {
    const email = extra.email.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const unsubReasons: string[] = [];
    if (EXCLUDE_EMAILS.has(email)) unsubReasons.push("excluded");
    const onDj = sendDjEmails.has(email);
    const djProfileUrl = extra.djUsername
      ? `${NEWSLETTER_APP_URL}/dj/${encodeURIComponent(extra.djUsername)}`
      : FALLBACK_DJ_URL;
    rows.push({
      email,
      source: "extra-dj",
      role: "(extra dj — in-code)",
      name: extra.name,
      displayName: null,
      chatUsername: extra.djUsername ?? null,
      unsubscribed: unsubReasons.length > 0,
      unsubReason: unsubReasons,
      onNextSend: onDj,
      onNextSendCohort: onDj ? "dj" : null,
      currentFirstName: resolveFirstName(email, extra.name, extra.djUsername),
      displayNameFirstWord: null,
      djProfileUrl,
      djInsiders: null,
      marketing: null,
    });
  }

  for (const extra of EXTRA_LISTENERS) {
    const email = extra.email.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const unsubReasons: string[] = [];
    if (EXCLUDE_EMAILS.has(email)) unsubReasons.push("excluded");
    const onListener = sendListenerEmails.has(email);
    rows.push({
      email,
      source: "extra-listener",
      role: "(extra listener — in-code)",
      name: extra.name,
      displayName: null,
      chatUsername: null,
      unsubscribed: unsubReasons.length > 0,
      unsubReason: unsubReasons,
      onNextSend: onListener,
      onNextSendCohort: onListener ? "listener" : null,
      currentFirstName: resolveFirstName(email, extra.name),
      displayNameFirstWord: null,
      djProfileUrl: null,
      djInsiders: null,
      marketing: null,
    });
  }

  // Group order: 1) DJs with profile URL, 2) DJs with site-root fallback,
  // 3) Users (listeners). Within each group: on-next-send first, then
  // alphabetical by email. Anyone not on next send (unsubbed/excluded)
  // sinks to the bottom of their group.
  const groupOrder = (r: AuditRow): number => {
    if (r.onNextSendCohort === "dj") {
      const isFallback = r.djProfileUrl === FALLBACK_DJ_URL;
      return isFallback ? 1 : 0;
    }
    if (r.source === "users-dj" || r.source === "pending-dj" || r.source === "extra-dj") {
      // DJ row but not on next send (unsubbed/excluded) — keep with DJ groups
      const isFallback = r.djProfileUrl === FALLBACK_DJ_URL;
      return isFallback ? 1 : 0;
    }
    return 2;
  };
  rows.sort((a, b) => {
    const ga = groupOrder(a);
    const gb = groupOrder(b);
    if (ga !== gb) return ga - gb;
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

function sendStatusFor(r: AuditRow): string {
  if (r.onNextSend) return "Sending";
  if (r.unsubReason.length === 0) {
    // Not on send, but no explicit unsub reason recorded.
    if (r.source === "waitlist") return "Waitlist orphan (no users doc)";
    if (r.role === "admin" || r.role === "broadcaster") return `Excluded role: ${r.role}`;
    if (r.source === "users-dj" || r.source === "pending-dj" || r.source === "extra-dj") {
      return "DJ djInsiders flag not enabled";
    }
    return "Not on next send (reason unknown)";
  }
  if (r.unsubReason.includes("excluded")) return "Spam / excluded";
  if (r.unsubReason.includes("marketing=false")) return "Unsubscribed (marketing)";
  if (r.unsubReason.includes("djInsiders=false")) return "Unsubscribed (DJ insiders)";
  if (r.unsubReason.includes("pending.unsubscribed=true")) return "Unsubscribed (pending DJ)";
  if (r.unsubReason.includes("waitlist.unsubscribed=true")) return "Unsubscribed (waitlist)";
  return `Excluded: ${r.unsubReason.join(", ")}`;
}

export function buildAuditHtml(rows: AuditRow[]): string {
  const onSend = rows.filter((r) => r.onNextSend).length;
  const unsubbed = rows.filter((r) => r.unsubscribed).length;
  const headers = [
    "DJ / User",
    "Send status",
    "Email",
    "First name (as of now)",
    "displayName first word",
    "DJ link in email",
  ];
  const colCount = headers.length;
  const th = headers
    .map((h) => `<th style="text-align:left;padding:6px 8px;border:1px solid #ddd;font-size:12px;background:#f6f6f6;">${h}</th>`)
    .join("");

  const isDjSource = (r: AuditRow) => r.source === "users-dj" || r.source === "pending-dj" || r.source === "extra-dj";
  const djsWithProfile = rows.filter((r) => isDjSource(r) && r.djProfileUrl && r.djProfileUrl !== FALLBACK_DJ_URL);
  const djsWithRadio = rows.filter((r) => isDjSource(r) && r.djProfileUrl === FALLBACK_DJ_URL);
  const users = rows.filter((r) => r.source === "users-non-dj" || r.source === "waitlist" || r.source === "extra-listener");

  // Within each section: sending first, then everything else, then alpha by email.
  const sortBySendThenEmail = (a: AuditRow, b: AuditRow): number => {
    if (a.onNextSend !== b.onNextSend) return a.onNextSend ? -1 : 1;
    return a.email.localeCompare(b.email);
  };
  djsWithProfile.sort(sortBySendThenEmail);
  djsWithRadio.sort(sortBySendThenEmail);
  users.sort(sortBySendThenEmail);

  const renderRow = (r: AuditRow): string => {
    const rowBg = r.onNextSend ? "#ffffff" : "#fafafa";
    const djOrUser =
      isDjSource(r)
        ? "DJ"
        : r.source === "waitlist"
          ? "Waitlist"
          : "User";
    const linkCell = r.djProfileUrl
      ? `<a href="${escapeHtml(r.djProfileUrl)}" style="color:#0070f3;text-decoration:none;">${escapeHtml(r.djProfileUrl.replace(/^https?:\/\//, ""))}</a>`
      : "";
    const status = sendStatusFor(r);
    const statusColor = r.onNextSend ? "#0a7d28" : "#999";
    const statusCell = `<span style="color:${statusColor};font-weight:${r.onNextSend ? "bold" : "normal"};">${escapeHtml(status)}</span>`;
    const cells = [
      djOrUser,
      statusCell,
      r.email,
      r.currentFirstName,
      r.displayNameFirstWord ?? "",
      linkCell,
    ];
    return `<tr style="background:${rowBg};">${cells
      .map((c, i) =>
        i === 1 || i === 5
          ? `<td style="padding:6px 8px;border:1px solid #ddd;font-size:12px;vertical-align:top;">${c}</td>`
          : `<td style="padding:6px 8px;border:1px solid #ddd;font-size:12px;vertical-align:top;">${escapeHtml(String(c))}</td>`,
      )
      .join("")}</tr>`;
  };

  const sectionHeader = (label: string, count: number): string =>
    `<tr><td colspan="${colCount}" style="padding:10px 8px;border:1px solid #ddd;background:#222;color:#fff;font-size:12px;font-weight:bold;letter-spacing:0.04em;">${escapeHtml(label)} (${count})</td></tr>`;

  const trs =
    sectionHeader("1 · DJs with profile URL", djsWithProfile.length) +
    djsWithProfile.map(renderRow).join("") +
    sectionHeader("2 · DJs without profile (will use site root)", djsWithRadio.length) +
    djsWithRadio.map(renderRow).join("") +
    sectionHeader("3 · Users (listeners)", users.length) +
    users.map(renderRow).join("");

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
