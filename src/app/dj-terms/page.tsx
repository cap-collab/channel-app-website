import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "DJ Terms of Use - Channel",
  description: "DJ Terms of Use - Channel Media, Inc.",
};

export default function DJTermsPage() {
  return (
    <div className="legal-container">
      <Link href="/" className="inline-block text-gray-500 text-sm mb-8 hover:text-white">
        &larr; Back to Channel
      </Link>

      <h1>DJ Terms of Use</h1>
      <p className="last-updated">
        Channel Media, Inc.
        <br />
        Last updated: March 2026
      </p>

      <h2>1. Purpose &amp; Scope</h2>
      <p>
        These DJ Terms of Use (&quot;DJ Terms&quot;) apply to any DJ, artist, collective, or
        broadcaster (&quot;DJ,&quot; &quot;you&quot;) who applies to participate on Channel,
        including by:
      </p>
      <ul>
        <li>Broadcasting live audio</li>
        <li>Managing or appearing on a DJ profile or DJ Studio page</li>
        <li>Receiving listener support through tips</li>
        <li>Appearing on public DJ pages (e.g. /dj/[username])</li>
        <li>Participating in DJ-specific chats associated with your profile</li>
        <li>Participating in collective pages or collective-related broadcasts</li>
      </ul>
      <p>
        The DJ application process is open and may be accessed through the Channel website or app.
      </p>
      <p>
        By submitting a DJ application or using DJ features on Channel, you confirm that you have
        read and accepted these DJ Terms.
      </p>
      <p>
        These DJ Terms supplement Channel&apos;s{" "}
        <Link href="/terms">Terms of Use</Link>,{" "}
        <Link href="/privacy">Privacy Policy</Link>, and{" "}
        <Link href="/guidelines">Community Guidelines</Link>, all of which also apply.
      </p>

      <h2>2. Eligibility &amp; Approval</h2>
      <p>Submitting a DJ application does not guarantee approval.</p>
      <p>
        Applications may be submitted through the DJ application interface without requiring prior
        authentication.
      </p>
      <p>Channel Media, Inc. (&quot;Channel&quot;) may:</p>
      <ul>
        <li>approve or reject applications</li>
        <li>approve or deny profile claims</li>
        <li>assign or revoke DJ permissions</li>
        <li>suspend or revoke DJ access</li>
      </ul>
      <p>All decisions are made at Channel&apos;s sole discretion.</p>
      <p>
        Channel may also pre-create DJ profiles and assign roles or permissions before a DJ claims
        or manages the profile.
      </p>
      <p>Channel may limit, modify, or discontinue DJ features at any time.</p>

      <h2>3. Platform Role Disclaimer</h2>
      <p>Channel provides technical infrastructure to enable:</p>
      <ul>
        <li>live audio streaming</li>
        <li>DJ profiles and discovery</li>
        <li>DJ chats and community spaces</li>
        <li>recordings and archives</li>
        <li>listener support through voluntary tips</li>
      </ul>
      <p>Channel:</p>
      <ul>
        <li>is not a publisher</li>
        <li>does not pre-screen or curate DJ content</li>
        <li>does not assume responsibility for audio played during broadcasts</li>
      </ul>
      <p>You are solely responsible for your content and activity on Channel.</p>

      <h2>4. Content Rights &amp; Licensing (Critical)</h2>
      <p>
        By broadcasting, uploading, or otherwise providing content on Channel, you represent and
        warrant that:
      </p>
      <ul>
        <li>
          you own or have obtained all necessary rights, licenses, and permissions to broadcast all
          audio content
        </li>
        <li>
          your activity does not infringe copyright, neighboring rights, performance rights, or
          related rights
        </li>
        <li>you comply with applicable copyright laws in your jurisdiction</li>
      </ul>
      <p>Channel does not obtain licenses on your behalf and does not verify your rights.</p>

      <h2>5. Venue Authorization (Critical)</h2>
      <p>If you broadcast from a public or private venue, you represent and warrant that:</p>
      <ul>
        <li>you have explicit authorization from the venue to livestream and record audio</li>
        <li>your broadcast does not violate venue policies, agreements, or local regulations</li>
      </ul>
      <p>Any venue-related disputes are solely your responsibility.</p>

      <h2>6. Prohibited Content</h2>
      <p>You may not broadcast, publish, or promote:</p>
      <ul>
        <li>hate speech, harassment, or discriminatory content</li>
        <li>explicit sexual content</li>
        <li>illegal content or encouragement of illegal activity</li>
        <li>deceptive content (e.g., recorded sets presented as live)</li>
        <li>content that violates Channel&apos;s Community Guidelines</li>
      </ul>
      <p>Channel may interrupt or terminate DJ activity immediately for violations.</p>

      <h3>6.1 Monetization Restrictions</h3>
      <p>
        DJs may not use Channel to solicit or receive tips in connection with content that involves:
      </p>
      <ul>
        <li>adult content containing nudity or explicit sexual acts</li>
        <li>copyright-infringing or unauthorized content</li>
        <li>intellectual property or proprietary rights violations</li>
        <li>violent extremism or promotion of unlawful violence</li>
        <li>hate speech or content targeting protected groups</li>
      </ul>
      <p>
        Channel may disable tipping, remove content, suspend DJ access, or reverse payouts if
        monetization is associated with prohibited content.
      </p>

      <h2>7. Live Broadcast Risks &amp; Interruptions</h2>
      <p>You acknowledge that live broadcasting involves inherent technical risks.</p>
      <p>Channel does not guarantee:</p>
      <ul>
        <li>stream quality or availability</li>
        <li>latency, uptime, or audience reach</li>
        <li>successful delivery of a broadcast</li>
      </ul>
      <p>
        Broadcasts may be interrupted, delayed, muted, or terminated for technical, safety, legal,
        or compliance reasons.
      </p>

      <h2>8. DJ Identity, Profiles &amp; Public Display</h2>

      <h3>8.1 DJ Profiles</h3>
      <p>Channel displays public DJ profiles that may include:</p>
      <ul>
        <li>DJ name or username</li>
        <li>biography and descriptive information</li>
        <li>images or artwork</li>
        <li>location, genres, and recommendations</li>
        <li>social links and external references</li>
        <li>associated broadcasts, schedules, and recordings</li>
        <li>associations with collectives, venues, or events</li>
      </ul>
      <p>Your DJ name and profile information may appear publicly:</p>
      <ul>
        <li>on public DJ pages</li>
        <li>on collective or event pages</li>
        <li>in schedules, notifications, and calendars</li>
        <li>in recordings, replays, and archives</li>
      </ul>
      <p>
        Public DJ pages may serve as the DJ&apos;s public creator presence on Channel and may be
        associated with listener support, broadcasts, schedules, and related activity on the
        platform.
      </p>
      <p>You are responsible for the accuracy of information once you claim or modify a profile.</p>

      <h3>8.2 Pre-Created &amp; Auto-Created DJ Profiles</h3>
      <p>Channel may create DJ profiles before you sign up, including profiles:</p>
      <ul>
        <li>created manually by Channel administrators</li>
        <li>
          automatically generated using publicly available information from third-party platforms
          (such as radio station websites or show pages)
        </li>
      </ul>
      <p>Such profiles may display publicly prior to your registration.</p>
      <p>
        If you sign up using a matching email address, the profile may be automatically claimed by
        your account.
      </p>
      <p>
        In some cases, profile claims or DJ permissions may require administrative approval.
      </p>
      <p>
        Once a profile is claimed and approved, you may update, modify, or correct profile
        information.
      </p>
      <p>
        You may request correction or removal of a profile in accordance with the{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>9. DJ Chats &amp; Community Spaces</h2>
      <p>Each DJ profile may have a dedicated public chat room associated with it.</p>
      <p>You acknowledge that:</p>
      <ul>
        <li>chat messages are public and visible on your DJ profile</li>
        <li>chats may persist beyond individual broadcast sessions</li>
        <li>your DJ profile chat represents your public community space</li>
      </ul>
      <p>You are responsible for:</p>
      <ul>
        <li>your own conduct in chat</li>
        <li>managing your DJ chat space</li>
        <li>content shared via chat messages, promo links, or pinned content</li>
      </ul>
      <p>Channel may remove chat content or restrict access for violations.</p>

      <h2>10. Scheduling &amp; Go-Live Behavior</h2>
      <p>DJ participation may include scheduled broadcast slots.</p>
      <p>Channel may automatically start or stop a broadcast based on scheduled times.</p>
      <p>You are responsible for being ready at the scheduled time.</p>
      <p>
        Channel is not responsible for missed, delayed, or mistimed broadcasts.
      </p>

      <h2>11. Recording of Broadcasts</h2>
      <p>All DJ broadcasts on Channel are recorded by default.</p>
      <p>By broadcasting, you acknowledge and agree that:</p>
      <ul>
        <li>Channel may record, store, replay, and make available your broadcasts</li>
        <li>recordings may include audio, metadata, timestamps, and DJ identifiers</li>
      </ul>
      <p>Recordings may be used for:</p>
      <ul>
        <li>playback and replays</li>
        <li>editorial or promotional purposes</li>
        <li>moderation, compliance, and product improvement</li>
      </ul>
      <p>
        You grant Channel Media, Inc. a non-exclusive, worldwide, royalty-free license to record,
        reproduce, stream, and make available recordings of your broadcasts on Channel platforms and
        channels.
      </p>
      <p>If your DJ account is removed, associated recordings and public DJ pages may be removed.</p>

      <h2>12. Listener Support &amp; Tips</h2>

      <h3>12.1 Voluntary Support</h3>
      <p>Listeners may voluntarily send monetary support (&quot;tips&quot;) to DJs.</p>
      <p>Tips:</p>
      <ul>
        <li>are voluntary</li>
        <li>do not purchase goods or services</li>
        <li>do not guarantee exposure, promotion, or access</li>
      </ul>
      <p>Channel does not guarantee any DJ will receive tips.</p>

      <h3>12.2 Platform Fee</h3>
      <p>Tips are processed via Stripe.</p>
      <p>Channel retains a 15% platform fee (minimum $0.50 per tip).</p>
      <p>The DJ receives the remaining amount, subject to payout eligibility.</p>

      <h2>13. Stripe &amp; Payout Setup</h2>
      <p>To receive payouts, DJs must connect and maintain a valid Stripe account.</p>
      <p>
        Channel facilitates listener tips through Stripe Connect. Stripe is responsible for
        connected account onboarding, identity verification, payout processing, and related payment
        compliance for connected accounts.
      </p>
      <p>You are responsible for:</p>
      <ul>
        <li>completing Stripe onboarding</li>
        <li>maintaining accurate account information</li>
        <li>taxes, reporting, and legal compliance related to earnings</li>
      </ul>
      <p>Channel is not responsible for Stripe account issues, reviews, holds, or errors.</p>
      <p>
        Channel may temporarily hold funds related to tips until a DJ completes payout onboarding
        through Stripe.
      </p>

      <h2>14. Pending Tips &amp; Unclaimed Support</h2>
      <p>
        Listeners may send tips to DJs even if the DJ has not yet connected a payout account.
      </p>
      <p>In this situation:</p>
      <ul>
        <li>tips are accepted by Channel and temporarily held on behalf of the DJ</li>
        <li>
          the DJ will be prompted to connect a Stripe payout account in order to receive the funds
        </li>
        <li>Channel may notify or remind DJs that tips are pending and available for payout</li>
      </ul>
      <p>
        Tips remain pending until the DJ completes Stripe onboarding and connects a valid payout
        account.
      </p>
      <p>If a DJ does not complete payout setup within 60 days of receiving a tip:</p>
      <ul>
        <li>the tip becomes unclaimed support</li>
        <li>the funds may be reallocated to Channel&apos;s DJ Support Pool</li>
      </ul>
      <p>After reallocation, such support is no longer claimable by the DJ.</p>
      <p>Reallocated support is not refundable and does not create any credit or entitlement.</p>

      <h2>15. DJ Support Pool</h2>
      <p>
        The DJ Support Pool is used to support DJs and DJ-related initiatives on Channel, such as:
      </p>
      <ul>
        <li>recordings</li>
        <li>promotion</li>
        <li>platform features</li>
      </ul>
      <p>Reallocated support:</p>
      <ul>
        <li>is not cash-equivalent</li>
        <li>is not withdrawable by DJs</li>
        <li>does not create any entitlement or credit balance</li>
      </ul>
      <p>Channel determines how the DJ Support Pool is used within DJ-related purposes.</p>

      <h2>16. No Guarantee of Earnings</h2>
      <p>Channel makes no guarantees regarding:</p>
      <ul>
        <li>tip amounts</li>
        <li>frequency of support</li>
        <li>listener participation</li>
      </ul>
      <p>All support is entirely at the discretion of listeners.</p>

      <h2>17. Data Collection &amp; Storage</h2>
      <p>As a DJ, Channel may collect and store:</p>
      <ul>
        <li>DJ username and profile data</li>
        <li>application information</li>
        <li>broadcast schedules and metadata</li>
        <li>timestamps and listener counts</li>
        <li>chat messages and promo links</li>
        <li>tip transaction metadata (excluding full payment details)</li>
      </ul>
      <p>
        Data handling is governed by Channel&apos;s <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>18. Indemnification</h2>
      <p>
        You agree to defend, indemnify, and hold harmless Channel Media, Inc., its officers,
        directors, contractors, and partners from any claims arising from:
      </p>
      <ul>
        <li>copyright or licensing disputes</li>
        <li>venue disputes</li>
        <li>broadcast, profile, or chat content</li>
        <li>tip-related disputes</li>
        <li>your breach of these DJ Terms</li>
      </ul>
      <p>This obligation survives termination.</p>

      <h2>19. Termination of DJ Access</h2>
      <p>
        Channel may suspend or terminate DJ access at any time, with or without notice, including
        for:
      </p>
      <ul>
        <li>violations of these DJ Terms</li>
        <li>violations of Community Guidelines</li>
        <li>legal risk or complaints</li>
        <li>safety or compliance concerns</li>
      </ul>
      <p>You have no entitlement to continued DJ access.</p>

      <h2>20. No Employment or Partnership</h2>
      <p>You are not an employee, contractor, or partner of Channel.</p>
      <p>Nothing in these DJ Terms creates a partnership, agency, or employment relationship.</p>

      <h2>21. Governing Law</h2>
      <p>
        These DJ Terms are governed by U.S. federal law and the laws of the State of California,
        except where EU/UK consumer protections apply.
      </p>

      <h2>22. Contact</h2>
      <p>
        Channel Media, Inc.
        <br />
        <a href="mailto:info@channel-app.com">info@channel-app.com</a>
        <br />
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>
      </p>

      <footer className="legal-footer">
        <p>&copy; 2026 Channel Media, Inc.</p>
      </footer>
    </div>
  );
}
