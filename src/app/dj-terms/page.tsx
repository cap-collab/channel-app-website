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
        Last updated: January 2026
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
        <li>Receiving listener support</li>
        <li>Appearing on public DJ pages (e.g. /dj/[username])</li>
        <li>Participating in DJ-specific chats associated with your profile</li>
      </ul>
      <p>
        By applying to participate as a DJ or using DJ features on Channel, you agree to these DJ
        Terms.
      </p>
      <p>
        These DJ Terms supplement Channel&apos;s{" "}
        <Link href="/terms">Terms of Use</Link>,{" "}
        <Link href="/privacy">Privacy Policy</Link>, and{" "}
        <Link href="/guidelines">Community Guidelines</Link>, all of which also apply.
      </p>

      <h2>2. Eligibility &amp; Approval</h2>
      <p>Applying to participate as a DJ does not guarantee approval.</p>
      <p>
        Channel Media, Inc. (&quot;Channel&quot;) may approve, reject, suspend, or revoke DJ access
        at its sole discretion.
      </p>
      <p>Channel may limit, modify, or discontinue DJ features at any time.</p>

      <h2>3. Platform Role Disclaimer</h2>
      <p>
        Channel provides technical infrastructure to enable live audio streaming, DJ profiles, DJ
        chats, recordings, and related features.
      </p>
      <p>Channel:</p>
      <ul>
        <li>Is not a publisher</li>
        <li>Does not pre-screen or curate DJ content</li>
        <li>Does not assume responsibility for audio played during broadcasts</li>
      </ul>
      <p>You are solely responsible for your content and activity on Channel.</p>

      <h2>4. Content Rights &amp; Licensing (Critical)</h2>
      <p>
        By broadcasting, uploading, or otherwise providing content on Channel, you represent and
        warrant that:
      </p>
      <ul>
        <li>
          You own or have obtained all necessary rights, licenses, and permissions to broadcast all
          audio content
        </li>
        <li>
          Your activity does not infringe copyright, neighboring rights, performance rights, or
          related rights
        </li>
        <li>You comply with applicable copyright laws in your jurisdiction</li>
      </ul>
      <p>Channel does not obtain licenses on your behalf and does not verify your rights.</p>

      <h2>5. Venue Authorization (Critical)</h2>
      <p>If you broadcast from a public or private venue, you represent and warrant that:</p>
      <ul>
        <li>You have explicit authorization from the venue to livestream and record audio</li>
        <li>Your broadcast does not violate venue policies, agreements, or local regulations</li>
      </ul>
      <p>Any venue-related disputes are solely your responsibility.</p>

      <h2>6. Prohibited Content</h2>
      <p>You may not broadcast, publish, or promote:</p>
      <ul>
        <li>Hate speech, harassment, or discriminatory content</li>
        <li>Explicit sexual content</li>
        <li>Illegal content or encouragement of illegal activity</li>
        <li>Deceptive content (e.g. recorded sets presented as live)</li>
        <li>Content that violates Channel&apos;s Community Guidelines</li>
      </ul>
      <p>Channel may interrupt or terminate DJ activity immediately for violations.</p>

      <h2>7. Live Broadcast Risks &amp; Interruptions</h2>
      <p>You acknowledge that live broadcasting involves inherent technical risks.</p>
      <p>Channel does not guarantee:</p>
      <ul>
        <li>Stream quality or availability</li>
        <li>Latency, uptime, or audience reach</li>
        <li>Successful delivery of a broadcast</li>
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
        <li>Biography and descriptive information</li>
        <li>Images or artwork</li>
        <li>Location, genres, and recommendations</li>
        <li>Social links and external references</li>
        <li>Associated broadcasts, schedules, and recordings</li>
      </ul>
      <p>Your DJ name and profile information may appear publicly:</p>
      <ul>
        <li>On public DJ pages</li>
        <li>In schedules, notifications, and calendars</li>
        <li>In recordings, replays, and archives</li>
      </ul>
      <p>You are responsible for the accuracy of information once you claim or modify a profile.</p>

      <h3>8.2 Pre-Created &amp; Auto-Created DJ Profiles</h3>
      <p>Channel may create DJ profiles before you sign up, including profiles:</p>
      <ul>
        <li>Created manually by Channel administrators</li>
        <li>
          Automatically generated using publicly available information from third-party platforms
          (such as radio station websites or show pages)
        </li>
      </ul>
      <p>Such profiles may display publicly prior to your registration.</p>
      <p>
        If you sign up using a matching email address, the profile may be automatically claimed by
        your account. Once claimed, you may update, modify, or correct profile information.
      </p>
      <p>
        You may request correction or removal of a profile in accordance with the{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>9. DJ Chats &amp; Community Spaces</h2>
      <p>Each DJ profile may have a dedicated public chat room associated with it.</p>
      <p>You acknowledge that:</p>
      <ul>
        <li>Chat messages are public and visible on your DJ profile</li>
        <li>Chats persist beyond individual broadcast sessions</li>
        <li>Your DJ profile chat represents your public community space</li>
      </ul>
      <p>You are responsible for:</p>
      <ul>
        <li>Your own conduct in chat</li>
        <li>Managing your DJ chat space</li>
        <li>Content shared via chat messages, promo links, or pinned content</li>
      </ul>
      <p>Channel may remove chat content or restrict access for violations.</p>

      <h2>10. Scheduling &amp; Go-Live Behavior</h2>
      <p>DJ participation may include scheduled broadcast slots.</p>
      <p>Channel may automatically start or stop a broadcast based on scheduled times.</p>
      <p>
        You are responsible for being ready at the scheduled time. Channel is not responsible for
        missed, delayed, or mistimed broadcasts.
      </p>

      <h2>11. Recording of Broadcasts</h2>
      <p>All DJ broadcasts on Channel are recorded by default.</p>
      <p>By broadcasting, you acknowledge and agree that:</p>
      <ul>
        <li>Channel may record, store, replay, and make available your broadcasts</li>
        <li>Recordings may include audio, metadata, timestamps, and DJ identifiers</li>
        <li>
          Recordings may be used for:
          <ul>
            <li>Playback and replays</li>
            <li>Editorial or promotional purposes</li>
            <li>Moderation, compliance, and product improvement</li>
          </ul>
        </li>
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
        <li>Are voluntary</li>
        <li>Do not purchase goods or services</li>
        <li>Do not guarantee exposure, promotion, or access</li>
      </ul>
      <p>Channel does not guarantee any DJ will receive tips.</p>

      <h3>12.2 Platform Fee</h3>
      <p>Tips are processed via Stripe.</p>
      <p>Channel retains a 15% platform fee (minimum $0.50 per tip).</p>
      <p>The DJ receives the remaining amount, subject to payout eligibility.</p>

      <h2>13. Stripe &amp; Payout Setup</h2>
      <p>To receive payouts, DJs must connect and maintain a valid Stripe account.</p>
      <p>You are responsible for:</p>
      <ul>
        <li>Completing Stripe onboarding</li>
        <li>Maintaining accurate account information</li>
        <li>Taxes, reporting, and legal compliance related to earnings</li>
      </ul>
      <p>Channel is not responsible for Stripe account issues, reviews, holds, or errors.</p>

      <h2>14. Pending &amp; Unclaimed Support</h2>
      <p>Listeners may send support even if you have not yet completed payout setup.</p>
      <ul>
        <li>Support remains pending until payout setup is completed</li>
        <li>Channel will attempt to pay out pending support once setup is complete</li>
      </ul>
      <p>
        If payout setup is not completed within 60 days, the support becomes unclaimed and is
        reallocated to Channel&apos;s DJ Support Pool.
      </p>
      <p>After reallocation, such support is no longer claimable by you.</p>

      <h2>15. DJ Support Pool</h2>
      <p>
        The DJ Support Pool is used to support DJs and DJ-related initiatives on Channel, such as:
      </p>
      <ul>
        <li>Recordings</li>
        <li>Promotion</li>
        <li>Platform features</li>
      </ul>
      <p>Reallocated support:</p>
      <ul>
        <li>Is not cash-equivalent</li>
        <li>Is not withdrawable by DJs</li>
        <li>Does not create any entitlement or credit balance</li>
      </ul>
      <p>Channel determines how the DJ Support Pool is used within DJ-related purposes.</p>

      <h2>16. No Guarantee of Earnings</h2>
      <p>Channel makes no guarantees regarding:</p>
      <ul>
        <li>Tip amounts</li>
        <li>Frequency of support</li>
        <li>Listener participation</li>
      </ul>
      <p>All support is entirely at the discretion of listeners.</p>

      <h2>17. Data Collection &amp; Storage</h2>
      <p>As a DJ, Channel may collect and store:</p>
      <ul>
        <li>DJ username and profile data</li>
        <li>Application information</li>
        <li>Broadcast schedules and metadata</li>
        <li>Timestamps and listener counts</li>
        <li>Chat messages and promo links</li>
        <li>Tip transaction metadata (excluding full payment details)</li>
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
        <li>Copyright or licensing disputes</li>
        <li>Venue disputes</li>
        <li>Broadcast, profile, or chat content</li>
        <li>Tip-related disputes</li>
        <li>Your breach of these DJ Terms</li>
      </ul>
      <p>This obligation survives termination.</p>

      <h2>19. Termination of DJ Access</h2>
      <p>
        Channel may suspend or terminate DJ access at any time, with or without notice, including
        for:
      </p>
      <ul>
        <li>Violations of these DJ Terms</li>
        <li>Violations of Community Guidelines</li>
        <li>Legal risk or complaints</li>
        <li>Safety or compliance concerns</li>
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
