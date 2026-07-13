// Shared helpers for the channel-wide newsletter (admin route + Monday crons).
// Anything that needs to build recipient lists, email HTML, or send the
// campaign should import from here — not duplicate logic in the route.

import { getCityFromTimezone } from "@/lib/city-detection";
import { normalizeUsername } from "@/lib/dj-matching";

export type Cohort = "dj" | "listener";
export type Recipient = {
  email: string;
  name: string;
  id: string;
  cohort: Cohort;
  djUsername?: string;
  // Resolved IRL city (for city-gating the weekly fallback email's coming-up).
  // pending-dj → djProfile.location; application → city; waitlist → tz-derived.
  // Undefined when unknown (caller falls back to its own default, e.g. LA).
  city?: string;
};

export const NEWSLETTER_FROM_EMAIL = "Cap from Channel <cap@channel-app.com>";
export const NEWSLETTER_APP_URL = "https://channel-app.com";

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

function resolveDjUsername(data: FirebaseFirestore.DocumentData): string | undefined {
  const normalized = typeof data.chatUsernameNormalized === "string" ? data.chatUsernameNormalized.trim() : "";
  if (normalized) return normalized;
  const raw = typeof data.chatUsername === "string" ? data.chatUsername.trim() : "";
  if (!raw) return undefined;
  return normalizeUsername(raw);
}

export async function getDjRecipients(db: FirebaseFirestore.Firestore): Promise<Recipient[]> {
  // DJ cohort is strictly users where role=="dj". Pending-dj-profiles and
  // EXTRA_DJS are excluded — they may still receive the listener email if
  // they exist as a non-DJ user, but otherwise get nothing this send.
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
      city:
        (data.irlCity as string | undefined) ||
        getCityFromTimezone((data.timezone as string) || "") ||
        undefined,
    });
  }

  // Pending DJ profiles → listener cohort. They've applied but don't have
  // a users doc with role=="dj" yet, so they get the listener email (not the
  // DJ one). Skipped if they exist as a users doc (handled above).
  const pendingSnap = await db.collection("pending-dj-profiles").get();
  for (const doc of pendingSnap.docs) {
    const data = doc.data();
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    if (!email) continue;
    if (data.unsubscribed === true) continue;
    if (EXCLUDE_EMAILS.has(email)) continue;
    if (djEmails.has(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      name: resolveFirstName(email, data.name, data.chatUsername, data.displayName),
      id: doc.id,
      cohort: "listener",
      // Pending DJs store their city on djProfile.location (no irlCity field).
      city:
        ((data.djProfile as Record<string, unknown> | undefined)?.location as string | undefined) ||
        (data.irlCity as string | undefined) ||
        (data.city as string | undefined) ||
        undefined,
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
      city:
        (data.irlCity as string | undefined) ||
        (data.city as string | undefined) ||
        getCityFromTimezone((data.timezone as string) || "") ||
        undefined,
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
