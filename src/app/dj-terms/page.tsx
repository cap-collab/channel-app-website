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
        <li>broadcasting live audio</li>
        <li>managing or appearing on a DJ profile or DJ Studio page</li>
        <li>sharing external links (including promotional or support links)</li>
        <li>appearing on public DJ pages (e.g. /dj/[username])</li>
        <li>participating in DJ-specific chats associated with your profile</li>
        <li>participating in collective pages or collective-related broadcasts</li>
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
        <Link href="/guidelines">Community Guidelines</Link>.
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
      </ul>
      <p>Channel:</p>
      <ul>
        <li>is not a publisher</li>
        <li>does not pre-screen or curate DJ content</li>
        <li>does not assume responsibility for audio played during broadcasts</li>
      </ul>
      <p>Channel does not process payments, handle funds, or facilitate financial transactions.</p>
      <p>You are solely responsible for your content and activity on Channel.</p>

      <h2>4. Content Rights &amp; Licensing (Critical)</h2>
      <p>
        By broadcasting, uploading, or otherwise providing content on Channel, you represent and
        warrant that:
      </p>
      <ul>
        <li>you own or have obtained all necessary rights, licenses, and permissions</li>
        <li>your activity does not infringe copyright or related rights</li>
        <li>you comply with applicable laws in your jurisdiction</li>
      </ul>
      <p>Channel does not obtain licenses on your behalf and does not verify your rights.</p>

      <h2>5. Venue Authorization (Critical)</h2>
      <p>If you broadcast from a venue, you represent and warrant that:</p>
      <ul>
        <li>you have explicit authorization to livestream and record</li>
        <li>your broadcast complies with venue policies and local laws</li>
      </ul>
      <p>Any disputes are solely your responsibility.</p>

      <h2>6. Prohibited Content</h2>
      <p>You may not broadcast, publish, promote, or link to content that involves:</p>
      <ul>
        <li>hate speech, harassment, or discrimination</li>
        <li>explicit sexual content or nudity</li>
        <li>illegal activity or encouragement of illegal activity</li>
        <li>copyright-infringing or unauthorized content</li>
        <li>deceptive content (e.g. recorded sets presented as live)</li>
      </ul>
      <p>Channel may interrupt or terminate DJ activity immediately for violations.</p>

      <h3>6.1 Prohibited External Monetization &amp; Links</h3>
      <p>
        You may not use Channel to promote or link to external services that involve:
      </p>
      <ul>
        <li>adult content or explicit sexual services</li>
        <li>copyright-infringing material (including pirated music)</li>
        <li>intellectual property violations</li>
        <li>violent extremism or promotion of unlawful violence</li>
        <li>hate speech targeting protected groups</li>
      </ul>
      <p>Channel may remove links, restrict access, or suspend accounts for violations.</p>

      <h2>7. External Links &amp; Third-Party Services</h2>
      <p>Channel may allow DJs to display or share external links.</p>
      <p>You acknowledge that:</p>
      <ul>
        <li>Channel does not operate or control external websites or services</li>
        <li>Channel does not process payments or transactions on your behalf</li>
        <li>any interaction with third-party services is at the user&apos;s own risk</li>
      </ul>
      <p>You are solely responsible for:</p>
      <ul>
        <li>the content and destination of links you share</li>
        <li>compliance with applicable laws</li>
        <li>any transactions conducted outside of Channel</li>
      </ul>
      <p>Channel is not responsible for third-party services, payments, disputes, or losses.</p>

      <h2>8. Live Broadcast Risks &amp; Interruptions</h2>
      <p>You acknowledge that live broadcasting involves technical risks.</p>
      <p>Channel does not guarantee:</p>
      <ul>
        <li>stream quality or availability</li>
        <li>latency or uptime</li>
        <li>audience reach</li>
      </ul>
      <p>Broadcasts may be interrupted or terminated at any time.</p>

      <h2>9. DJ Identity, Profiles &amp; Public Display</h2>

      <h3>9.1 DJ Profiles</h3>
      <p>Channel displays public DJ profiles that may include:</p>
      <ul>
        <li>name, bio, and media</li>
        <li>genres, location, and recommendations</li>
        <li>social links</li>
        <li>broadcasts and recordings</li>
        <li>associations with collectives, venues, or events</li>
      </ul>
      <p>Profiles may serve as your public presence on Channel.</p>
      <p>You are responsible for the accuracy of your profile.</p>

      <h3>9.2 Pre-Created &amp; Auto-Created Profiles</h3>
      <p>Channel may create profiles:</p>
      <ul>
        <li>manually</li>
        <li>from publicly available information</li>
      </ul>
      <p>Profiles may exist before you register.</p>
      <p>Claims may require approval.</p>
      <p>
        You may request corrections or removal per the{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>10. DJ Chats &amp; Community Spaces</h2>
      <p>Each DJ profile may include a public chat.</p>
      <p>You acknowledge:</p>
      <ul>
        <li>messages are public</li>
        <li>chats may persist beyond broadcasts</li>
        <li>you are responsible for your community space</li>
      </ul>
      <p>Channel may moderate or remove content.</p>

      <h2>11. Scheduling &amp; Go-Live</h2>
      <p>Channel may:</p>
      <ul>
        <li>assign broadcast slots</li>
        <li>automatically start or stop streams</li>
      </ul>
      <p>You are responsible for readiness.</p>

      <h2>12. Recording of Broadcasts</h2>
      <p>All broadcasts are recorded by default.</p>
      <p>You grant Channel a:</p>
      <ul>
        <li>non-exclusive</li>
        <li>worldwide</li>
        <li>royalty-free license</li>
      </ul>
      <p>to record, store, and distribute your broadcasts for:</p>
      <ul>
        <li>playback</li>
        <li>promotion</li>
        <li>moderation</li>
        <li>product improvement</li>
      </ul>
      <p>Recordings may be removed if your account is removed.</p>

      <h2>13. No Payments or Financial Services</h2>
      <p>Channel does not:</p>
      <ul>
        <li>process payments</li>
        <li>facilitate transactions</li>
        <li>act as a financial intermediary</li>
        <li>provide escrow or payout services</li>
      </ul>
      <p>Any financial interaction occurs outside of Channel.</p>

      <h2>14. No Guarantee of Earnings</h2>
      <p>Channel makes no guarantees regarding:</p>
      <ul>
        <li>audience size</li>
        <li>exposure</li>
        <li>external support or revenue</li>
      </ul>

      <h2>15. Data Collection &amp; Storage</h2>
      <p>Channel may collect:</p>
      <ul>
        <li>profile data</li>
        <li>application data</li>
        <li>broadcast metadata</li>
        <li>chat content</li>
      </ul>
      <p>
        Data handling is governed by the{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>16. Indemnification</h2>
      <p>You agree to indemnify Channel against claims related to:</p>
      <ul>
        <li>copyright or licensing</li>
        <li>venue disputes</li>
        <li>broadcast or profile content</li>
        <li>external links or third-party services</li>
        <li>your violation of these Terms</li>
      </ul>

      <h2>17. Termination</h2>
      <p>Channel may suspend or terminate access at any time.</p>
      <p>No entitlement to continued access.</p>

      <h2>18. No Employment Relationship</h2>
      <p>You are not an employee, contractor, or partner of Channel.</p>

      <h2>19. Governing Law</h2>
      <p>
        These Terms are governed by U.S. federal law and California law, except where EU/UK
        protections apply.
      </p>

      <h2>20. Contact</h2>
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
