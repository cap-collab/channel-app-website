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

function buildDjIntro(firstName: string, latestShowSlug?: string): string {
  const greeting = firstName === "there" ? "Hi," : `Hi ${firstName},`;

  // Only offer the share link when they actually have a show to share —
  // otherwise the sentence would point at nothing.
  const shareLine = latestShowSlug
    ? `Every show now has its own shareable link. Here's your latest: ${proseLink(
        `https://channel-app.com/?archive=${encodeURIComponent(latestShowSlug)}`,
        "listen and share it",
      )}.`
    : `Every show now has its own shareable link.`;

  return [
    tight(greeting),
    tight(`A few things we've shipped over the past week.`),

    heading("🎵", "Automatic Track IDs"),
    tight(`Every show now gets automatic Track IDs.`),
    tight(`You can edit, reorder, add missing tracks, or hide individual ones from your Studio.`),
    tight(
      `Thanks to ${proseDjLink("marienyx", "Marie")}, ${proseDjLink("gstyle", "Gabri")}, ` +
        `${proseDjLink("andyoro", "Andy")}, and ${proseDjLink("apili", "Alex")} for helping shape the feature.`,
    ),
    tight(
      `Special shoutout to ${proseDjLink("akumen", "Akumen")}, whose tracks were played by three ` +
        `different Channel artists this week. Every identified track now links listeners back to ` +
        `the artist's profile.`,
    ),

    heading("🎧", "Reach more listeners"),
    tight(
      `Your shows are recommended to listeners who already enjoy artists from your collective and ` +
        `the ones you've introduced to Channel.`,
    ),
    tight(`The idea is simple: help your music reach more people who are likely to enjoy it.`),
    tight(
      `See your recommendations: ${proseLink("https://channel-app.com/foryou", "channel-app.com/foryou")}`,
    ),

    heading("👥", "Collective &amp; Events"),
    tight(`Collectives can now manage their own profile, artists, and events directly on Channel.`),
    tight(
      `Every event can also include a discount code, making it easier to reward your community and stand out.`,
    ),
    tight(
      `Thanks to ${proseCollectiveLink("hiddenvillage", "Hidden Village")} for helping shape this feature.`,
    ),

    heading("📚", "Archives"),
    tight(`Archives that disappeared from the homepage are now back.`),
    tight(shareLine),
    tight(
      `Thanks to ${proseDjLink("tsgo", "TS Go")}, ${proseDjLink("dizi", "Dizi")}, and ` +
        `${proseDjLink("andyoro", "Andy")} for catching the issue.`,
    ),

    heading("💾", "More reliable recordings"),
    tight(
      `I've made another round of improvements to make recordings more resilient to unstable ` +
        `Wi-Fi during live broadcasts.`,
    ),
    tight(
      `A special thank you to ${proseDjLink("davidl", "David L")}, ${proseDjLink("brod", "B. Rod")}, ` +
        `${proseDjLink("m0lly", "M0lly")}, and ${proseDjLink("znc", "Znc")}, whose shows experienced ` +
        `the recording issues. I really appreciate their patience while I continue improving the ` +
        `recording experience.`,
    ),

    // Sign-off closes the letter — give it the same gap a new section gets, so
    // it doesn't hug the last thank-you line.
    `<p style="margin: 22px 0 0; font-size: 14px; line-height: 1.6; color: #1a1a1a;">Thanks again for helping me build Channel.</p>`,
  ].join("");
}

function buildListenerIntro(): string {
  // Same tight rhythm as the DJ intro — two loose 16px paragraphs read as an
  // airy fragment rather than a short note.
  return [
    tight(
      `A couple of new things this week. Type "track id" in the chat while listening to any show ` +
        `to instantly get the full tracklist, and keep an eye out for exclusive discount codes on ` +
        `selected events.`,
    ),
    tight(`I've also updated your recommendations. They're just below.`),
  ].join("");
}

export const WEEKLY_INTRO = {
  dj: {
    subject: "Collectives, reach & Track IDs",
    build: buildDjIntro,
  },
  listener: {
    subject: "Track IDs, discounts & your weekly picks",
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
): string {
  return cohort === "dj"
    ? WEEKLY_INTRO.dj.build(firstName, latestShowSlug)
    : WEEKLY_INTRO.listener.build();
}
