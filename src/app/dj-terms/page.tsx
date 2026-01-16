import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Broadcast Terms for DJs - Channel",
  description: "Channel Broadcast Terms for DJs & Broadcasters - Channel Media, Inc.",
};

export default function DJTermsPage() {
  return (
    <div className="legal-container">
      <Link href="/" className="inline-block text-gray-500 text-sm mb-8 hover:text-white">
        &larr; Back to Channel
      </Link>

      <h1>Channel Broadcast Terms for DJs &amp; Broadcasters</h1>
      <p className="last-updated">
        Channel Media, Inc.
        <br />
        Last updated: January 2026
      </p>

      <h2>1. Purpose &amp; Scope</h2>
      <p>
        These Channel Broadcast Terms (&quot;Broadcast Terms&quot;) apply to any DJ, artist, collective, or broadcaster (&quot;Broadcaster,&quot; &quot;you&quot;) who applies to stream or livestream audio content on Channel Broadcast, whether from a private location or a public venue.
      </p>
      <p>By submitting an application to broadcast, you agree to these Broadcast Terms in full.</p>
      <p>
        These Broadcast Terms supplement Channel&apos;s general{" "}
        <Link href="/terms">Terms of Use</Link>,{" "}
        <Link href="/privacy">Privacy Policy</Link>, and{" "}
        <Link href="/guidelines">Community Guidelines</Link>, all of which also apply.
      </p>

      <h2>2. Eligibility &amp; Approval</h2>
      <ul>
        <li>Applying to broadcast does not guarantee approval.</li>
        <li>Channel Media, Inc. (&quot;Channel&quot;) may approve, reject, suspend, or revoke broadcast access at its sole discretion.</li>
        <li>Channel may limit, modify, or discontinue Channel Broadcast at any time.</li>
      </ul>

      <h2>3. Platform Role Disclaimer</h2>
      <p>Channel provides technical infrastructure only to enable live audio streaming.</p>
      <p>Channel:</p>
      <ul>
        <li>Is not a publisher</li>
        <li>Does not curate or pre-screen live broadcast content</li>
        <li>Does not assume responsibility for audio played during broadcasts</li>
      </ul>
      <p>You are solely responsible for your broadcast content.</p>

      <h2>4. Content Rights &amp; Licensing (CRITICAL)</h2>
      <p>By broadcasting on Channel, you represent and warrant that:</p>
      <ul>
        <li>You own or have obtained all necessary rights, licenses, and permissions to broadcast all audio content you stream</li>
        <li>Your broadcast does not infringe any copyright, neighboring rights, performance rights, or related rights</li>
        <li>You comply with all applicable copyright laws in your jurisdiction</li>
      </ul>
      <p>Channel does not obtain licenses on your behalf and does not verify your rights.</p>

      <h2>5. Venue Authorization (CRITICAL)</h2>
      <p>If you broadcast from a public or private venue (club, bar, event space, festival, etc.), you represent and warrant that:</p>
      <ul>
        <li>You have the explicit authorization of the venue to livestream and record audio from that location</li>
        <li>Your broadcast does not violate venue policies, agreements, or local regulations</li>
      </ul>
      <p>Any disputes with venues are solely your responsibility.</p>

      <h2>6. Prohibited Content</h2>
      <p>You may not broadcast:</p>
      <ul>
        <li>Hate speech, harassment, or discriminatory content</li>
        <li>Explicit sexual content</li>
        <li>Illegal content or encouragement of illegal activity</li>
        <li>Content intended to deceive listeners (e.g., recorded sets presented as live)</li>
        <li>Content that violates Channel&apos;s Community Guidelines</li>
      </ul>
      <p>Channel may interrupt or terminate a broadcast immediately for violations.</p>

      <h2>7. Live Broadcast Risks &amp; Interruptions</h2>
      <p>You acknowledge that live broadcasting involves inherent technical risks.</p>
      <p>Channel does not guarantee:</p>
      <ul>
        <li>Stream availability or quality</li>
        <li>Latency, uptime, or audience reach</li>
        <li>Successful delivery of a broadcast</li>
      </ul>
      <p>Broadcasts may be interrupted, delayed, muted, or terminated due to:</p>
      <ul>
        <li>Technical issues</li>
        <li>Safety concerns</li>
        <li>Legal or compliance reasons</li>
        <li>Platform maintenance</li>
      </ul>

      <h2>8. DJ Identity &amp; Chat Conduct</h2>
      <ul>
        <li>You may be required to register a DJ username to broadcast</li>
        <li>Your username will appear publicly in chat, activity messages, and recordings</li>
        <li>You are responsible for your conduct in chat and for moderating your broadcast space</li>
        <li>Promo links shared in chat are considered user-generated content</li>
      </ul>
      <p>Abusive behavior may result in loss of broadcast access.</p>

      <h2>9. Scheduling &amp; Auto Go-Live</h2>
      <ul>
        <li>Broadcast slots may include start and end times</li>
        <li>Channel may automatically start or stop your broadcast based on the scheduled slot</li>
        <li>You are responsible for being ready at the scheduled time</li>
      </ul>
      <p>Channel is not responsible for missed or mistimed broadcasts.</p>

      <h2>10. Recording of Broadcasts</h2>
      <p>By broadcasting on Channel, you acknowledge and agree that:</p>
      <ul>
        <li>Channel may record, store, archive, replay, and make available your live broadcast, in whole or in part</li>
        <li>Recordings may include audio, metadata, timestamps, chat messages, and DJ identifiers</li>
        <li>Recordings may be used for:
          <ul>
            <li>Playback or replays on Channel</li>
            <li>Editorial, promotional, or archival purposes</li>
            <li>Moderation, compliance, and product improvement</li>
          </ul>
        </li>
      </ul>
      <p>
        You grant Channel Media, Inc. a non-exclusive, worldwide, royalty-free license to record, reproduce, stream, and make available recordings of your broadcast on Channel websites and channels.
      </p>
      <p>You confirm that:</p>
      <ul>
        <li>You have the right to grant this permission</li>
        <li>All DJs listed on the broadcast are aware of and consent to the recording</li>
        <li>Recording does not violate venue policies or third-party rights</li>
      </ul>
      <p>Channel is not obligated to publish or retain any recording.</p>

      <h2>11. Tips &amp; Payments</h2>
      <h3>11.1 Listener Tips</h3>
      <p>Listeners may voluntarily send monetary tips to DJs during broadcasts.</p>
      <ul>
        <li>Tips are voluntary</li>
        <li>Tips do not purchase goods, services, or guaranteed access</li>
        <li>Channel does not guarantee any DJ will receive tips</li>
      </ul>

      <h3>11.2 Platform Fee</h3>
      <ul>
        <li>Tips are processed via Stripe</li>
        <li>Channel retains a 15% service fee, with a minimum fee of $0.50 per tip</li>
        <li>The DJ receives the tip amount minus the platform fee</li>
      </ul>

      <h2>12. Stripe Connect Requirement</h2>
      <p>To receive tips, DJs must connect a Stripe account.</p>
      <ul>
        <li>You are responsible for completing Stripe onboarding</li>
        <li>You are responsible for maintaining your Stripe account in good standing</li>
        <li>You are solely responsible for taxes, reporting, and compliance related to tips</li>
      </ul>
      <p>Channel is not responsible for Stripe account issues.</p>

      <h2>13. Payout Terms</h2>
      <ul>
        <li>Tips are transferred to your connected Stripe account</li>
        <li>Stripe handles payouts to your bank account according to Stripe&apos;s payout schedule</li>
        <li>Channel is not responsible for Stripe processing delays, holds, reversals, or account reviews</li>
      </ul>

      <h2>14. Tips for DJs Without Stripe Connected</h2>
      <ul>
        <li>Listeners may send tips even if you have not yet connected Stripe</li>
        <li>Tips will be held by Channel until Stripe onboarding is completed</li>
        <li>You must connect Stripe within 60 days of receiving a tip to claim it</li>
        <li>Unclaimed tips after 60 days are forfeited and retained by Channel</li>
        <li>Channel is not obligated to notify you of pending or unclaimed tips (though it may do so)</li>
      </ul>

      <h2>15. No Guarantee of Tips</h2>
      <p>Channel makes no guarantees regarding:</p>
      <ul>
        <li>Tip amounts</li>
        <li>Frequency of tips</li>
        <li>Listener participation</li>
      </ul>
      <p>All tipping activity is entirely at the discretion of listeners.</p>

      <h2>16. Data Collection &amp; Storage</h2>
      <p>As a broadcaster, Channel may collect and store:</p>
      <ul>
        <li>DJ username</li>
        <li>Application information</li>
        <li>Broadcast schedules and slot metadata</li>
        <li>Go-live and end timestamps</li>
        <li>Listener presence counts</li>
        <li>Chat messages and promo links</li>
        <li>Tip transaction metadata (excluding full payment details)</li>
      </ul>
      <p>Data handling is governed by Channel&apos;s <Link href="/privacy">Privacy Policy</Link>.</p>

      <h2>17. Indemnification (VERY IMPORTANT)</h2>
      <p>
        You agree to defend, indemnify, and hold harmless Channel Media, Inc., its officers, directors, contractors, and partners from any claims, damages, losses, liabilities, or expenses arising from:
      </p>
      <ul>
        <li>Copyright or licensing claims</li>
        <li>Venue disputes</li>
        <li>Broadcast content</li>
        <li>Tip-related disputes or claims</li>
        <li>User complaints related to your broadcast</li>
        <li>Your breach of these Broadcast Terms</li>
      </ul>
      <p>This obligation survives termination.</p>

      <h2>18. Termination of Broadcast Access</h2>
      <p>Channel may suspend or terminate your broadcast privileges at any time, with or without notice, including for:</p>
      <ul>
        <li>Violations of these Broadcast Terms</li>
        <li>Violations of Community Guidelines</li>
        <li>Legal risk or complaints</li>
        <li>Platform safety or compliance concerns</li>
      </ul>
      <p>You have no entitlement to continued broadcast access.</p>

      <h2>19. No Employment or Partnership</h2>
      <p>You acknowledge that you are not an employee, contractor, or partner of Channel.</p>
      <p>Nothing in these Terms creates a partnership, agency, or employment relationship.</p>

      <h2>20. Governing Law</h2>
      <p>
        These Broadcast Terms are governed by U.S. federal law and the laws of the State of California, except where EU/UK consumer protections apply.
      </p>

      <h2>21. Contact</h2>
      <p>
        Channel Media, Inc.
        <br />
        General inquiries: <a href="mailto:info@channel-app.com">info@channel-app.com</a>
        <br />
        Safety &amp; legal: <a href="mailto:support@channel-app.com">support@channel-app.com</a>
      </p>

      <footer className="legal-footer">
        <p>&copy; 2026 Channel Media, Inc.</p>
        <p>
          <a href="mailto:info@channel-app.com">info@channel-app.com</a>
        </p>
      </footer>
    </div>
  );
}
