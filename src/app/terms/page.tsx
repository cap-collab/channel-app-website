import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use - Channel",
  description: "Terms of Use for Channel - Channel Media, Inc.",
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
        By accessing or using Channel — including the mobile app, web app, Channel Broadcast, DJ
        Studio, public DJ pages, and DJ profile chats — you agree to these Terms of Use.
      </p>
      <p>If you do not agree, do not use Channel.</p>

      <h2>2. Eligibility</h2>
      <p>Channel is intended for users 16 years and older worldwide.</p>

      <h2>3. Description of the Service</h2>
      <p>Channel is a platform that enables users to:</p>
      <ul>
        <li>Listen to live audio streams from third-party radio stations</li>
        <li>Listen to live DJ broadcasts through Channel Broadcast</li>
        <li>View public DJ profiles and pages (e.g. /dj/[username])</li>
        <li>Interact with public chat rooms</li>
        <li>Discover show schedules, metadata, and listener indicators</li>
        <li>Send voluntary tips to support DJs</li>
        <li>Receive optional notifications and emails</li>
        <li>Save favorites, watchlists, and searches</li>
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

      <h2>5. Public DJ Profiles</h2>

      <h3>5.1 Profile Content</h3>
      <p>Channel displays public DJ profiles that may include:</p>
      <ul>
        <li>DJ name or username</li>
        <li>Biography and descriptive information</li>
        <li>Images, artwork, or thumbnails</li>
        <li>Location, genres, and recommendations</li>
        <li>Social links and references</li>
        <li>Past or upcoming broadcasts and recordings</li>
      </ul>
      <p>Profile information may originate from:</p>
      <ul>
        <li>DJs themselves (after claiming a profile)</li>
        <li>Channel administrators</li>
        <li>Publicly available information from third-party platforms</li>
      </ul>
      <p>Channel does not guarantee the accuracy or completeness of DJ profile information.</p>

      <h3>5.2 Pending and Auto-Created Profiles</h3>
      <p>Some DJ profiles may exist before a DJ signs up, including profiles:</p>
      <ul>
        <li>Created by Channel administrators</li>
        <li>Automatically generated from publicly available sources</li>
      </ul>
      <p>These profiles are displayed for discovery purposes.</p>
      <p>
        If a DJ later signs up with a matching email, the profile may be claimed and updated.
      </p>

      <h2>6. Channel Broadcast (Listening Experience)</h2>
      <p>Channel may display live DJ broadcasts that:</p>
      <ul>
        <li>Appear dynamically when a DJ is live</li>
        <li>May be interrupted, delayed, or unavailable</li>
        <li>May include live chat, reactions, or recordings</li>
      </ul>
      <p>Channel does not guarantee broadcast availability, quality, or continuity.</p>

      <h2>7. Tips &amp; Voluntary Support</h2>

      <h3>7.1 Voluntary Nature of Tips</h3>
      <p>Users may voluntarily send tips to DJs.</p>
      <ul>
        <li>Tips are optional and non-refundable</li>
        <li>Tips do not purchase goods or services</li>
        <li>Tips do not create any contractual or employment relationship</li>
      </ul>

      <h3>7.2 Processing &amp; Fees</h3>
      <p>Tips are processed via third-party payment providers (such as Stripe).</p>
      <p>
        Channel charges a platform fee on each tip (currently 15% or a $0.50 minimum, whichever is
        higher).
      </p>
      <p>Channel is not responsible for payment processor errors, delays, or reversals.</p>

      <h3>7.3 Unclaimed Tips</h3>
      <p>If a DJ does not complete payout setup, tips may be temporarily held.</p>
      <p>
        Unclaimed tips after a defined period may be reallocated to Channel&apos;s DJ Support Pool
        and are not refundable.
      </p>

      <h2>8. User Conduct</h2>
      <p>You agree not to post, transmit, or interact in a way that includes:</p>
      <ul>
        <li>Harassment, threats, or abuse</li>
        <li>Hate speech or discriminatory content</li>
        <li>Illegal or infringing material</li>
        <li>Sexual or explicit content</li>
        <li>Spam or unrelated self-promotion</li>
        <li>Sharing personal information of others</li>
      </ul>
      <p>Violations may result in content removal, account restriction, or loss of access.</p>

      <h2>9. User-Generated Content &amp; Chats</h2>

      <h3>9.1 DJ-Specific Chats</h3>
      <p>
        Chat messages are posted to DJ-specific chat rooms associated with individual DJ profiles.
      </p>
      <p>Chats:</p>
      <ul>
        <li>Are public</li>
        <li>Are visible to other users</li>
        <li>Persist beyond a single broadcast session</li>
      </ul>
      <p>Messages are not ephemeral unless explicitly stated.</p>

      <h3>9.2 Responsibility for Messages</h3>
      <p>You are responsible for any content you post.</p>
      <p>
        Channel does not endorse or verify user-generated messages and may remove content that
        violates these Terms or Community Guidelines.
      </p>

      <h2>10. Automated Activity Messages</h2>
      <p>Channel may display system-generated messages related to user activity, such as:</p>
      <ul>
        <li>Love reactions</li>
        <li>Locked-in listening indicators</li>
        <li>Favorite acknowledgments</li>
        <li>Tip acknowledgments</li>
      </ul>
      <p>These messages may appear publicly and can be disabled in settings.</p>

      <h2>11. Notifications</h2>

      <h3>11.1 Push Notifications (Mobile)</h3>
      <p>Optional notifications may include:</p>
      <ul>
        <li>Show reminders</li>
        <li>Go-live alerts</li>
        <li>Mentions</li>
      </ul>

      <h3>11.2 Email Notifications (Web)</h3>
      <p>Optional emails may include:</p>
      <ul>
        <li>Show reminders</li>
        <li>Watchlist updates</li>
        <li>Digest emails</li>
      </ul>
      <p>You may disable notifications at any time.</p>

      <h2>12. Third-Party Services</h2>
      <p>Channel integrates third-party services, including:</p>
      <ul>
        <li>Firebase / Google Cloud</li>
        <li>Hetzner (streaming infrastructure)</li>
        <li>Cloudflare R2 (recording storage)</li>
        <li>Vercel (hosting)</li>
        <li>Resend (email)</li>
        <li>Stripe (payments)</li>
      </ul>
      <p>Channel is not responsible for third-party service interruptions or failures.</p>

      <h2>13. Disclaimers</h2>
      <p>Channel is provided &quot;as is&quot; without warranties of any kind.</p>

      <h2>14. Limitation of Liability</h2>
      <p>To the fullest extent permitted by law, Channel Media, Inc. is not liable for:</p>
      <ul>
        <li>Broadcast interruptions or failures</li>
        <li>Accuracy of DJ profile information</li>
        <li>User-generated content or chat messages</li>
        <li>Payment processing errors or delays</li>
        <li>Data loss or unauthorized account access</li>
        <li>Unclaimed or reallocated tips</li>
      </ul>
      <p>Your sole remedy is to stop using Channel.</p>

      <h2>15. Reporting &amp; Enforcement</h2>
      <p>You may report issues via:</p>
      <ul>
        <li>Shaking your device (mobile)</li>
        <li>Mentioning @Channel in chat</li>
        <li>Emailing <a href="mailto:support@channel-app.com">support@channel-app.com</a></li>
      </ul>
      <p>Channel may remove content or restrict access at its discretion.</p>

      <h2>16. Account Deletion</h2>
      <p>Users may delete their account via Settings.</p>
      <p>Deletion removes associated user data as described in the Privacy Policy.</p>

      <h2>17. Governing Law</h2>
      <p>
        These Terms are governed by U.S. federal law and the laws of California, except where EU/UK
        consumer protections apply.
      </p>

      <h2>18. Contact</h2>
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
