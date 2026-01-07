import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy - Channel",
  description: "Privacy Policy for Channel - Community-Led Media",
};

export default function PrivacyPage() {
  return (
    <div className="legal-container">
      <Link href="/" className="inline-block text-gray-500 text-sm mb-8 hover:text-white">
        &larr; Back to Channel
      </Link>

      <h1>Privacy Policy</h1>
      <p className="last-updated">
        Channel Media, Inc.
        <br />
        Last updated: January 2026
      </p>

      <h2>1. Introduction</h2>
      <p>
        Channel Media, Inc. (&quot;Channel,&quot; &quot;we,&quot; &quot;our,&quot; &quot;us&quot;)
        provides a platform for streaming independent radio stations, hosting live DJ broadcasts,
        discovering shows, participating in public chat communities, and optionally supporting
        creators.
      </p>
      <p>Channel is available on both mobile and web.</p>
      <p>
        This Privacy Policy explains what personal data we collect, how we use it, how it is stored,
        and the rights available to users in the EU, EEA, and UK under GDPR and UK GDPR.
      </p>
      <p>By using Channel, you agree to this Privacy Policy.</p>

      <h2>2. Who We Are</h2>
      <p>
        Channel Media, Inc.
        <br />
        Los Angeles, California, USA
      </p>
      <p>
        General contact: <a href="mailto:info@channel-app.com">info@channel-app.com</a>
        <br />
        Safety and abuse: <a href="mailto:support@channel-app.com">support@channel-app.com</a>
      </p>
      <p>
        Channel does not specifically target users in the EU/EEA/UK. Access is offered on a passive
        basis; therefore, an EU representative is not required under GDPR Article 27.
      </p>

      <h2>3. Minimum Age</h2>
      <p>Channel is intended for users 16 years and older.</p>
      <p>We do not knowingly collect personal data from children under 16.</p>
      <p>
        If you believe a child under 16 is using Channel, contact{" "}
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>.
      </p>

      <h2>4. Information We Collect</h2>
      <p>Channel operates in two modes:</p>
      <ul>
        <li>Mobile app (anonymous by default)</li>
        <li>Web app (requires authentication)</li>
      </ul>
      <p>We collect only the information necessary to operate the service.</p>

      <h3>4.1 Information You Provide Directly</h3>

      <p>
        <strong>A. Chat Messages (Mobile + Web)</strong>
      </p>
      <ul>
        <li>Public messages you post in chat rooms</li>
        <li>Visible to anyone tuned into a station or live broadcast</li>
        <li>Stored in Firebase Firestore</li>
      </ul>
      <p>You may request deletion of your chat messages.</p>

      <p>
        <strong>B. Username</strong>
      </p>
      <ul>
        <li>Optional on mobile</li>
        <li>Automatically created on web from your authentication provider</li>
        <li>Displayed publicly in chat and automated activity messages (if enabled)</li>
      </ul>

      <p>
        <strong>C. Email and Notification Preferences (Web)</strong>
      </p>
      <p>If you enable email-based features, we store:</p>
      <ul>
        <li>Email address</li>
        <li>Notification preferences</li>
        <li>Watchlist items</li>
        <li>Favorite shows</li>
        <li>Saved search terms</li>
        <li>Digest timestamps</li>
        <li>Calendar sync settings</li>
      </ul>

      <h3>4.2 Authentication Methods</h3>

      <p>
        <strong>Google OAuth</strong>
      </p>
      <p>We receive: email address, display name, profile photo, and timezone.</p>

      <p>
        <strong>Apple Sign-In</strong>
      </p>
      <p>
        We receive: email address, full name (when shared), and an Apple user identifier.
        <br />
        Apple may mask your email using &quot;Hide My Email.&quot;
      </p>

      <p>
        <strong>Email Magic Link</strong>
      </p>
      <p>
        Your email address is temporarily stored in localStorage during the login flow and cleared
        when the flow completes or expires.
      </p>

      <h3>4.3 Information Collected Automatically</h3>
      <p>
        Channel does not use advertising identifiers, tracking pixels, fingerprinting, or behavioral
        analytics.
      </p>
      <p>We collect:</p>
      <ul>
        <li>Firebase User ID (anonymous on mobile, authenticated on web)</li>
        <li>Temporary IP address logs at the infrastructure level for security and delivery</li>
        <li>Temporary session identifiers for presence tracking</li>
        <li>Device or app metadata only when reporting an issue manually</li>
      </ul>
      <p>We do not collect background logs or screenshots automatically.</p>

      <h3>4.4 Listener Presence &amp; Stream Metadata</h3>
      <p>To operate live streams, Channel generates and processes:</p>
      <ul>
        <li>Anonymous listener session identifiers</li>
        <li>Join and leave timestamps</li>
        <li>Listener counts per live stream</li>
        <li>Stream identifiers linked to DJs and shows</li>
      </ul>
      <p>Session identifiers are short-lived and regenerated per session.</p>

      <h3>4.5 Live Audio Streaming &amp; Recording</h3>
      <p>
        Channel provides live audio streaming using a self-hosted LiveKit server operated by
        Channel.
      </p>
      <p>Important disclosures:</p>
      <ul>
        <li>All live audio is relayed through Channel-controlled servers</li>
        <li>Live streams are automatically recorded by default</li>
        <li>Recordings are created using HLS egress and stored as MP4 files</li>
        <li>Recordings are stored permanently unless removed by Channel</li>
      </ul>
      <p>Recordings may include:</p>
      <ul>
        <li>Audio content</li>
        <li>Timestamps</li>
        <li>Stream identifiers</li>
        <li>DJ identifiers</li>
      </ul>
      <p>Chat messages are not included in audio recordings or replays.</p>
      <p>Channel staff may access live or recorded audio only for:</p>
      <ul>
        <li>Debugging and technical troubleshooting</li>
        <li>Safety or moderation review</li>
        <li>Compliance and internal operations</li>
      </ul>
      <p>Channel does not enable third-party analytics or telemetry on live audio streams.</p>

      <h3>4.6 Storage of Recordings</h3>
      <p>Recorded broadcasts are stored in Cloudflare R2 object storage.</p>
      <p>
        Cloudflare may process limited technical data (such as IP addresses and network metadata) to
        provide storage and delivery services.
      </p>
      <p>Channel controls access to stored recordings.</p>

      <h3>4.7 Push Notifications (Mobile)</h3>
      <p>We store a Firebase Cloud Messaging (FCM) token to deliver notifications.</p>
      <p>Tokens are removed when you sign out, disable notifications, or uninstall the app.</p>

      <h3>4.8 Local Device Storage</h3>
      <p>Your device may store:</p>
      <ul>
        <li>Favorites (local copies)</li>
        <li>Notification settings</li>
        <li>Feature discovery flags</li>
        <li>Recently viewed shows</li>
        <li>Temporary session identifiers</li>
        <li>Temporary Magic Link email</li>
      </ul>
      <p>Local data is removed when you uninstall the app or clear browser storage.</p>

      <h3>4.9 Automated Activity Messages</h3>
      <p>
        When enabled, Channel may generate automatic public messages based on listening behavior,
        including:
      </p>
      <ul>
        <li>Love reactions</li>
        <li>Locked-in messages</li>
        <li>Favorite messages</li>
      </ul>
      <p>These messages are optional, rate-limited, and configurable.</p>

      <h3>4.10 @Channel Mentions Logging</h3>
      <p>
        Messages that mention &quot;@Channel&quot; are logged for developer review and abuse
        detection.
      </p>
      <p>These logs are not used for advertising or profiling.</p>

      <h3>4.11 Payments and Tips</h3>
      <p>Channel may allow users to voluntarily support DJs through tips.</p>
      <p>
        Payments are processed by Stripe. Channel does not store full payment card numbers or
        sensitive payment credentials.
      </p>
      <p>Channel may store limited payment-related information, including:</p>
      <ul>
        <li>Payment amount and currency</li>
        <li>Transaction identifiers</li>
        <li>Timestamp</li>
        <li>Payment status</li>
        <li>Associated DJ or show</li>
      </ul>
      <p>Tips may be sent with or without creating an account.</p>
      <p>
        For logged-in users, tips are internally associated with the user&apos;s account identifier
        and username.
      </p>
      <p>
        For guest users, tips are associated with a transaction identifier without creating a user
        profile.
      </p>
      <p>Creators receiving payouts must complete identity verification directly with Stripe.</p>

      <h3>4.12 DJ / Creator Applications</h3>
      <p>If you apply to become a DJ or broadcaster on Channel, we may collect:</p>
      <ul>
        <li>DJ or project name</li>
        <li>Email address</li>
        <li>Show name</li>
        <li>Preferred broadcast times</li>
        <li>Venue information (if applicable)</li>
        <li>Optional social media links (e.g. SoundCloud, Instagram, YouTube)</li>
      </ul>
      <p>
        This information is used solely to evaluate applications, schedule broadcasts, and
        communicate with DJs.
      </p>

      <h3>4.13 DJ Broadcast History</h3>
      <p>
        For DJs, Channel retains a history of broadcasts, including show identifiers and broadcast
        dates, for operational, archival, and scheduling purposes.
      </p>

      <h2>5. Legal Bases for Processing (GDPR / UK GDPR)</h2>

      <p>
        <strong>Contract (Article 6(1)(b))</strong>
      </p>
      <ul>
        <li>Account functionality</li>
        <li>Live streaming</li>
        <li>Chat and community features</li>
        <li>Notifications and reminders</li>
      </ul>

      <p>
        <strong>Consent (Article 6(1)(a))</strong>
      </p>
      <ul>
        <li>Emails and digests</li>
        <li>Push notifications</li>
        <li>Calendar sync</li>
        <li>Automated activity messages</li>
      </ul>

      <p>
        <strong>Legitimate Interest (Article 6(1)(f))</strong>
      </p>
      <ul>
        <li>Security</li>
        <li>Abuse prevention</li>
        <li>Fraud detection</li>
        <li>Service reliability</li>
      </ul>

      <p>No data is used for advertising or profiling.</p>

      <h2>6. How We Use Information</h2>
      <p>We use personal data to:</p>
      <ul>
        <li>Operate live audio streams and recordings</li>
        <li>Provide chat and community features</li>
        <li>Display usernames and stream metadata</li>
        <li>Deliver notifications</li>
        <li>Facilitate voluntary tips and creator payouts</li>
        <li>Prevent fraud and abuse</li>
        <li>Debug and improve platform reliability</li>
      </ul>
      <p>We do not sell personal data or share it with advertisers.</p>

      <h2>7. Data Sharing</h2>
      <p>Channel shares data only with service providers required to operate the platform:</p>
      <ul>
        <li>Firebase / Google Cloud – authentication, databases, notifications</li>
        <li>Hetzner – hosting of live streaming infrastructure</li>
        <li>Cloudflare R2 – storage of recorded broadcasts</li>
        <li>Vercel – application hosting and APIs</li>
        <li>Stripe – payment processing and creator payouts</li>
      </ul>
      <p>These providers act as processors and do not receive data for advertising purposes.</p>

      <h2>8. International Transfers</h2>
      <p>Data may be processed in the United States and the European Union.</p>
      <p>Transfers are protected by:</p>
      <ul>
        <li>Standard Contractual Clauses (SCCs)</li>
        <li>Additional security measures</li>
      </ul>

      <h2>9. Data Retention</h2>
      <p>Retention periods include:</p>
      <ul>
        <li>Chat messages: until deletion request</li>
        <li>User account data: until account deletion</li>
        <li>Presence session identifiers: short-lived</li>
        <li>Live stream recordings: retained permanently unless removed</li>
        <li>Payment transaction records: retained for accounting, compliance, and dispute handling</li>
        <li>DJ application data: retained while relevant to platform participation</li>
        <li>Abuse and moderation logs: retained as necessary for safety</li>
      </ul>

      <h2>10. Your Rights (GDPR / UK GDPR)</h2>
      <p>You may:</p>
      <ul>
        <li>Access your data</li>
        <li>Correct inaccurate data</li>
        <li>Request deletion</li>
        <li>Export your data</li>
        <li>Withdraw consent</li>
        <li>Object to processing</li>
      </ul>
      <p>
        To exercise your rights, contact:{" "}
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>
      </p>

      <h2>11. Automated Decision-Making</h2>
      <p>Channel does not use automated decision-making or profiling.</p>

      <h2>12. Security</h2>
      <p>
        We use industry-standard security practices including HTTPS, access controls, Firestore
        security rules, and infrastructure protections.
      </p>

      <h2>13. Changes to This Policy</h2>
      <p>We may update this Privacy Policy.</p>
      <p>Updates will be reflected by a new &quot;Last updated&quot; date.</p>

      <h2>14. Contact</h2>
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
