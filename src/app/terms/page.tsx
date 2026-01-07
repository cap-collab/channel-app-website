import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use - Channel",
  description: "Terms of Use for Channel - Community-Led Media",
};

export default function TermsPage() {
  return (
    <div className="legal-container">
      <Link href="/" className="inline-block text-gray-500 text-sm mb-8 hover:text-white">
        &larr; Back to Channel
      </Link>

      <h1>Terms of Use</h1>
      <p className="last-updated">
        Channel Media, Inc.
        <br />
        Last updated: January 2026
      </p>

      <h2>1. Acceptance of Terms</h2>
      <p>
        By accessing or using Channel — including the mobile app, web app, and Channel Broadcast — you agree to these Terms of Use.
      </p>
      <p>If you do not agree, do not use Channel.</p>

      <h2>2. Eligibility</h2>
      <p>Channel is intended for users 16 years and older worldwide.</p>

      <h2>3. Description of the Service</h2>
      <p>Channel is a platform that enables:</p>
      <ul>
        <li>Live audio streams from third-party radio stations</li>
        <li>Live DJ broadcasts through Channel Broadcast</li>
        <li>Public chat rooms associated with stations and broadcasts</li>
        <li>Show schedules, metadata, BPM analysis, and listener indicators</li>
        <li>Optional automated activity messages (Love, Locked In, Favorites)</li>
        <li>Optional push notifications (mobile)</li>
        <li>Optional email notifications (web)</li>
        <li>Watchlists, favorites, and saved searches</li>
        <li>Deep linking between web and mobile</li>
        <li>Voluntary tipping to support DJs and creators</li>
      </ul>
      <p>Channel does not own or control the content streamed by third-party radios or DJs.</p>

      <h2>4. Accounts &amp; Authentication</h2>

      <h3>4.1 Mobile App</h3>
      <p>Use is anonymous by default. Users may optionally authenticate using:</p>
      <ul>
        <li>Email and password</li>
        <li>Email Magic Link</li>
        <li>Google OAuth</li>
        <li>Apple Sign-In</li>
      </ul>
      <p>You are responsible for maintaining the security of your account credentials.</p>

      <h2>5. Channel Broadcast (DJ Livestreaming)</h2>

      <h3>5.1 Platform Role</h3>
      <p>Channel provides technical tools that allow DJs to livestream audio.</p>
      <p>Channel acts as a hosting platform, not a publisher.</p>
      <p>DJs are solely responsible for the content they broadcast.</p>

      <h3>5.2 DJ Responsibility</h3>
      <p>By broadcasting on Channel, DJs represent and warrant that:</p>
      <ul>
        <li>They have all necessary rights to stream the audio content</li>
        <li>They have permission from the venue if broadcasting from a venue</li>
        <li>Their broadcast complies with applicable laws and venue policies</li>
      </ul>
      <p>Channel does not verify licensing or venue authorization.</p>

      <h3>5.3 Broadcast Availability</h3>
      <p>Channel does not guarantee:</p>
      <ul>
        <li>Stream quality or continuity</li>
        <li>Audience size</li>
        <li>Successful delivery of a live broadcast</li>
      </ul>
      <p>Broadcasts may be interrupted, delayed, or terminated at any time for technical, safety, or compliance reasons.</p>

      <h3>5.4 Recording of Broadcasts</h3>
      <p>By broadcasting on Channel, you acknowledge and agree that:</p>
      <ul>
        <li>Channel may record, store, and archive your live broadcast, in whole or in part</li>
        <li>Recordings may include audio, metadata, timestamps, and DJ identifiers</li>
        <li>Recordings may be used for:
          <ul>
            <li>Playback or replays on Channel</li>
            <li>Editorial, promotional, or archival purposes</li>
            <li>Product improvement and moderation</li>
            <li>Internal review and compliance</li>
          </ul>
        </li>
      </ul>
      <p>
        You grant Channel Media, Inc. a non-exclusive, worldwide, royalty-free license to record, store, reproduce, stream, and make available recordings of your broadcast on the Channel platform.
      </p>
      <p>You confirm that:</p>
      <ul>
        <li>You have the right to grant this permission</li>
        <li>All DJs listed on the broadcast are aware of and consent to the recording</li>
        <li>Recording the broadcast does not violate venue policies or third-party rights</li>
      </ul>
      <p>Channel is not obligated to publish or retain any recording and may remove recordings at its discretion.</p>

      <h2>6. Tips, Payments &amp; Creator Earnings</h2>

      <h3>6.1 Voluntary Support</h3>
      <p>Listeners may send voluntary tips to DJs or creators through Channel.</p>
      <p>Tips are non-refundable and are not payments for services or goods.</p>
      <p>Tipping does not create a contractual or employment relationship between the listener and the creator.</p>

      <h3>6.2 Platform Role in Payments</h3>
      <p>Channel uses third-party payment processors (e.g., Stripe) to facilitate tips.</p>
      <p>Channel collects a platform fee on each tip (currently 15% or a $0.50 minimum, whichever is higher).</p>
      <p>Fees are subject to change with notice.</p>
      <p>Channel is not a bank, payment institution, or money transmitter.</p>

      <h3>6.3 Creator Payouts</h3>
      <p>Creators must connect a valid payout method (e.g., Stripe Express) to receive earnings.</p>
      <p>Channel does not guarantee payout timing, and payouts are subject to processor verification.</p>
      <p>Channel is not responsible for delays or issues caused by third-party processors or user error.</p>

      <h3>6.4 Pending or Unclaimed Tips</h3>
      <p>If a creator has not connected a payout account, tips will be held on their behalf.</p>
      <p>Channel may retain unclaimed funds indefinitely or, after reasonable notice, apply them at its discretion (e.g., to platform operations or charitable causes).</p>

      <h3>6.5 Refunds and Chargebacks</h3>
      <p>Tips are final. Refunds are generally not issued.</p>
      <p>If a chargeback is filed, Channel may reverse or withhold the associated payout to the creator.</p>
      <p>Abuse of the tipping or refund system may result in account suspension.</p>

      <h2>7. User Conduct</h2>
      <p>You agree not to post, transmit, or broadcast:</p>
      <ul>
        <li>Harassment, threats, or abuse</li>
        <li>Hate speech or discriminatory content</li>
        <li>Illegal or infringing material</li>
        <li>Sexual or explicit content</li>
        <li>Spam or self-promotion unrelated to the broadcast</li>
        <li>Personal information of others</li>
      </ul>
      <p>Violations may result in removal, suspension, or permanent restriction.</p>

      <h2>8. User-Generated Content &amp; Chat</h2>

      <h3>8.1 Public Chat</h3>
      <p>Messages posted in chat are public and visible to all listeners.</p>
      <p>You are responsible for what you post.</p>

      <h3>8.2 Mentions</h3>
      <p>Users may mention others using @username.</p>
      <p>Mentions may trigger notifications.</p>
      <p>Harassing mentions violate these Terms.</p>

      <h3>8.3 Automated Activity Messages</h3>
      <p>Channel may generate optional automatic messages based on listening behavior, including:</p>
      <ul>
        <li>Love reactions</li>
        <li>Locked In messages (after ~35 minutes of listening)</li>
        <li>Favorite messages</li>
      </ul>
      <p>These features can be disabled in Settings and are rate-limited.</p>

      <h2>9. Notifications</h2>

      <h3>9.1 Push Notifications (Mobile)</h3>
      <p>Optional notifications may include:</p>
      <ul>
        <li>Show reminders</li>
        <li>Popularity alerts</li>
        <li>Mentions</li>
        <li>Chat activity</li>
      </ul>

      <h3>9.2 Email Notifications (Web)</h3>
      <p>Optional emails may include:</p>
      <ul>
        <li>Show reminders</li>
        <li>Watchlist updates</li>
        <li>Digest emails</li>
      </ul>
      <p>You may disable notifications at any time.</p>

      <h2>10. Third-Party Services</h2>
      <p>Channel integrates third-party services including:</p>
      <ul>
        <li>Firebase / Google Cloud (authentication, databases, notifications)</li>
        <li>Hetzner (live streaming infrastructure)</li>
        <li>Cloudflare R2 (recording storage)</li>
        <li>Vercel (application hosting)</li>
        <li>Resend (email delivery)</li>
        <li>Stripe (payment processing)</li>
      </ul>
      <p>Channel is not responsible for third-party service interruptions.</p>

      <h2>11. Disclaimers</h2>
      <p>Channel is provided &quot;as is&quot; without warranties of any kind.</p>
      <p>We do not guarantee availability, accuracy, or uninterrupted service.</p>

      <h2>12. Limitation of Liability</h2>
      <p>To the fullest extent permitted by law, Channel Media, Inc. is not liable for:</p>
      <ul>
        <li>Live broadcast interruptions or failures</li>
        <li>Copyright or venue disputes</li>
        <li>User-generated content</li>
        <li>Chat interactions</li>
        <li>Data loss</li>
        <li>Unauthorized account access</li>
        <li>Payment processing errors or delays</li>
        <li>Unclaimed or reversed tips</li>
      </ul>
      <p>Your sole remedy is to stop using Channel.</p>

      <h2>13. Reporting &amp; Enforcement</h2>
      <p>You may report issues via:</p>
      <ul>
        <li>Shaking your device (mobile)</li>
        <li>Mentioning @Channel in chat</li>
        <li>Emailing <a href="mailto:support@channel-app.com">support@channel-app.com</a></li>
      </ul>
      <p>Channel may remove content or restrict access at its discretion.</p>

      <h2>14. Account Deletion</h2>
      <p>Web users may delete their account via Settings.</p>
      <p>Deletion removes associated user data as described in the Privacy Policy.</p>

      <h2>15. Governing Law</h2>
      <p>
        These Terms are governed by U.S. federal law and the laws of California, except where EU/UK consumer protections apply.
      </p>

      <h2>16. Contact</h2>
      <p>
        Channel Media, Inc.
        <br />
        <a href="mailto:info@channel-app.com">info@channel-app.com</a>
        <br />
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>
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
