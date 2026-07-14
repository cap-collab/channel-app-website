import { proseLink, proseDjLink, proseCollectiveLink } from "@/lib/email";

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  REWRITTEN EVERY WEEK.
//
// This is the ONLY file to touch for a new weekly send. Update the subject AND
// the body together — the subject is also what the Monday report run matches
// against in Resend to attribute opens (see WEEKLY_SUBJECTS below).
//
// Style: a plain TEXT email, like the track-IDs send. Prose paragraphs, inline
// underlined links, no cards or tables. Links are never bold.
//
// Every DJ/collective link must resolve — verify handles against prod before
// sending. A 404 in a mail to the whole artist list is not recoverable.
// ─────────────────────────────────────────────────────────────────────────────

export type IntroCohort = "dj" | "listener";

// Section heading. The gap belongs ABOVE the heading (separating it from the
// previous section), not below it — a heading should sit close to the text it
// introduces. Hence the 22px top / 2px bottom.
const heading = (emoji: string, text: string) =>
  `<p style="margin: 22px 0 2px; font-size: 14px; line-height: 1.6; color: #1a1a1a;"><strong>${emoji} ${text}</strong></p>`;

// Body line inside a section — tight against its neighbours, so a section reads
// as one block rather than a list of loose paragraphs.
const tight = (html: string) =>
  `<p style="margin: 0 0 2px; font-size: 14px; line-height: 1.6; color: #1a1a1a;">${html}</p>`;

// "include a discount code" links to a collective actually running discounted
// events in the reader's city — Hidden Village in NY, Information in LA. Anywhere
// else there's no local collective to point at, so it stays bold but unlinked
// rather than sending a Berlin DJ to an LA event.
//
// City resolution mirrors scene-payload.ts (irlCity → timezone), so this link and
// the "Coming up" section always agree about where the reader is.
function discountPhrase(text: string, city?: string | null): string {
  const bold = `<strong>${text}</strong>`;
  const c = (city || "").trim().toLowerCase();
  // Exact-ish matching only. A bare `includes("la")` would also fire on Atlanta,
  // Dallas, Oakland…
  if (c === "new york" || c === "nyc" || c === "brooklyn") {
    return proseCollectiveLink("hiddenvillage", bold);
  }
  if (c === "los angeles" || c === "la") {
    return proseCollectiveLink("information", bold);
  }
  return bold;
}

function buildDjIntro(firstName: string, latestShowSlug?: string, city?: string | null): string {
  const greeting = firstName === "there" ? "Hi," : `Hi ${firstName},`;

  // "its own shareable link" IS the link — pointing at their most recent show —
  // whenever they have one. No show → the same words, unlinked, rather than a
  // link to nothing.
  const shareable = latestShowSlug
    ? proseLink(
        `https://channel-app.com/?archive=${encodeURIComponent(latestShowSlug)}`,
        "its own shareable link",
      )
    : "its own shareable link";

  return [
    tight(greeting),
    tight(`A few things we've shipped this week.`),

    heading("\u{1F4BE}", "More reliable recordings"),
    tight(
      `I've made another round of improvements to make recordings more resilient to unstable ` +
        `Wi-Fi during live broadcasts. Thanks to ${proseDjLink("davidl", "David L")}, ` +
        `${proseDjLink("brod", "B. Rod")}, ${proseDjLink("m0lly", "M0LLY")}, and ` +
        `${proseDjLink("znc", "Znc")} for their patience while I continue improving the ` +
        `recording experience.`,
    ),

    heading("\u{1F465}", "Collectives &amp; Events"),
    tight(
      `Collectives can now manage their own profile, artists, and events directly on Channel. ` +
        `Every event can also ${discountPhrase("include a discount code", city)} to reward your community and help it ` +
        `stand out. Thanks to ${proseCollectiveLink("hiddenvillage", "Hidden Village")} for ` +
        `helping shape this feature.`,
    ),

    heading("\u{1F3B5}", "Automatic Track IDs"),
    tight(
      `Every show now gets automatic Track IDs, editable from your Studio. Thanks to ` +
        `${proseDjLink("marienyx", "Marie Nyx")}, ${proseDjLink("gstyle", "G-Style")}, ` +
        `${proseDjLink("andyoro", "Andy Oro")}, and ${proseDjLink("apili", "A-Pili")} for ` +
        `helping shape the feature, and shoutout to ${proseDjLink("akumen", "Akumen")}, whose ` +
        `tracks were played by three different Channel artists.`,
    ),

    heading("\u{1F3A7}", "Reach more listeners"),
    tight(
      `Your shows are now recommended to listeners already following your collective and the ` +
        `artists you've introduced to Channel, helping your music reach more people who are ` +
        `likely to enjoy it. See your recommendations: ` +
        `${proseLink("https://channel-app.com/foryou", "channel-app.com/foryou")}`,
    ),

    heading("\u{1F4DA}", "Archives"),
    tight(
      `Archives are back on the homepage, and every show now has ${shareable}. Thanks to ` +
        `${proseDjLink("tsgo", "ts GO")}, ${proseDjLink("dizi", "DIZI")}, and ` +
        `${proseDjLink("andyoro", "Andy Oro")} for catching the issue.`,
    ),

    // Sign-off closes the letter — give it the same gap a new section gets.
    `<p style="margin: 22px 0 0; font-size: 14px; line-height: 1.6; color: #1a1a1a;">Thanks again for helping me build Channel.</p>`,
  ].join("");
}

function buildListenerIntro(city?: string | null): string {
  // Bulleted, so the two new things read as a list rather than one dense
  // sentence. <ul>/<li> render reliably across mail clients when the margins are
  // set inline (Outlook ignores most list CSS otherwise).
  const li = (html: string) =>
    `<li style="margin: 0 0 4px; font-size: 14px; line-height: 1.6; color: #1a1a1a;">${html}</li>`;

  return [
    tight(`A couple of new things this week:`),
    `<ul style="margin: 0 0 0 20px; padding: 0;">` +
      li(
        `Type <strong>"track id"</strong> in the chat while listening to any show to instantly ` +
          `get the full tracklist`,
      ) +
      li(`Keep an eye out for ${discountPhrase("exclusive discount codes", city)} on selected events`) +
      `</ul>`,
    `<p style="margin: 22px 0 0; font-size: 14px; line-height: 1.6; color: #1a1a1a;">I've also updated your recommendations:</p>`,
  ].join("");
}

export const WEEKLY_INTRO = {
  dj: {
    subject: "Collectives, Reach & Track IDs",
    build: buildDjIntro,
  },
  listener: {
    subject: "Track IDs, Discounts & Your Weekly Picks",
    // No greeting and no links on the listener variant — by design.
    build: buildListenerIntro,
  },
} as const;

// Every subject this week's send can produce. The Monday report run polls Resend
// for EACH of these to attribute opens; a subject missing here means that
// cohort's opens are silently never stamped. Derived, so it cannot drift.
export const WEEKLY_SUBJECTS: string[] = [WEEKLY_INTRO.dj.subject, WEEKLY_INTRO.listener.subject];

export function introSubjectFor(cohort: IntroCohort): string {
  return WEEKLY_INTRO[cohort].subject;
}

export function buildIntroHtml(
  cohort: IntroCohort,
  firstName: string,
  latestShowSlug?: string,
  city?: string | null,
): string {
  return cohort === "dj"
    ? WEEKLY_INTRO.dj.build(firstName, latestShowSlug, city)
    : WEEKLY_INTRO.listener.build(city);
}
