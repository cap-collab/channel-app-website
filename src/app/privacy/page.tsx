import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy - Channel",
  description: "Privacy Policy for Channel - Channel Media, Inc.",
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
        Last updated: March 2026
      </p>

      <h2>1. Introduction</h2>
      <p>
        Channel Media, Inc. (&quot;Channel,&quot; &quot;we,&quot; &quot;our,&quot; or &quot;us&quot;)
        provides a platform for streaming independent radio stations, hosting live DJ broadcasts,
        discovering shows, participating in public chat communities, managing DJ profiles, and
        optionally supporting DJs through voluntary tips.
      </p>
      <p>Channel is available on both mobile and web.</p>
      <p>
        This Privacy Policy explains what personal data we collect, how it is used, how it is stored,
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
        <li>Web app (authentication required)</li>
      </ul>
      <p>We collect only the information necessary to operate the service.</p>

      <h3>4.1 Information You Provide Directly</h3>

      <p>
        <strong>A. Chat Messages (Mobile &amp; Web)</strong>
      </p>
      <p>Public messages posted in chat rooms.</p>
      <p>Messages may appear in:</p>
      <ul>
        <li>radio station chat rooms</li>
        <li>DJ profile chat rooms</li>
      </ul>
      <p>
        Messages are visible to anyone tuned into a station or viewing a DJ profile and are stored in
        Firebase Firestore.
      </p>
      <p>You may request deletion of your chat messages.</p>

      <p>
        <strong>B. Username</strong>
      </p>
      <p>Usernames are:</p>
      <ul>
        <li>optional on mobile</li>
        <li>automatically created on web from your authentication provider</li>
      </ul>
      <p>Usernames may appear publicly in chat, DJ profiles, and automated system messages.</p>

      <p>
        <strong>C. Email &amp; Notification Preferences (Web)</strong>
      </p>
      <p>If enabled, we store:</p>
      <ul>
        <li>Email address</li>
        <li>Notification preferences</li>
        <li>Watchlist items</li>
        <li>Favorite shows and DJs</li>
        <li>Saved searches</li>
        <li>Digest timestamps</li>
        <li>Calendar sync settings</li>
      </ul>

      <p>
        <strong>D. Personalization Preferences</strong>
      </p>
      <p>Users may optionally provide:</p>
      <ul>
        <li>preferred cities</li>
        <li>preferred music genres</li>
      </ul>
      <p>
        These preferences are stored in Firestore and used to improve discovery features, including
        personalized show recommendations.
      </p>

      <h3>4.2 Authentication Methods</h3>

      <p>
        <strong>Google OAuth</strong>
      </p>
      <p>We receive:</p>
      <ul>
        <li>email address</li>
        <li>display name</li>
        <li>profile photo</li>
        <li>timezone</li>
      </ul>

      <p>
        <strong>Apple Sign-In</strong>
      </p>
      <p>We receive:</p>
      <ul>
        <li>email address</li>
        <li>full name (when shared)</li>
        <li>Apple user identifier</li>
      </ul>
      <p>Apple may mask your email via &quot;Hide My Email&quot;.</p>

      <p>
        <strong>Email Magic Link</strong>
      </p>
      <p>
        Email addresses may be temporarily stored in browser localStorage during the login flow and
        are removed once authentication completes or expires.
      </p>

      <h3>4.3 Information Collected Automatically</h3>
      <p>
        Channel does not use advertising identifiers, tracking pixels, fingerprinting, or behavioral
        analytics.
      </p>
      <p>We collect:</p>
      <ul>
        <li>Firebase User ID (anonymous on mobile, authenticated on web)</li>
        <li>temporary IP address logs at the infrastructure level (security and delivery)</li>
        <li>temporary session identifiers for listener presence</li>
        <li>device or app metadata only when you manually report an issue</li>
      </ul>
      <p>We do not collect background logs or screenshots automatically.</p>

      <h3>4.4 Listener Presence &amp; Stream Metadata</h3>
      <p>To operate live streams, Channel generates and processes:</p>
      <ul>
        <li>anonymous listener session identifiers</li>
        <li>join and leave timestamps</li>
        <li>listener counts per live stream</li>
        <li>stream identifiers linked to DJs and shows</li>
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
        <li>Live streams are recorded by default</li>
        <li>Recordings are generated via HLS egress and stored as MP4 files</li>
        <li>Recordings are retained unless removed by Channel</li>
      </ul>
      <p>Recordings may include:</p>
      <ul>
        <li>audio content</li>
        <li>timestamps</li>
        <li>stream identifiers</li>
        <li>DJ identifiers</li>
      </ul>
      <p>Chat messages are not included in audio recordings or replays.</p>
      <p>Channel staff may access live or recorded audio solely for:</p>
      <ul>
        <li>debugging and technical troubleshooting</li>
        <li>safety and moderation review</li>
        <li>compliance and internal operations</li>
      </ul>
      <p>Channel does not enable third-party analytics or telemetry on live audio streams.</p>

      <h3>4.6 Storage of Recordings</h3>
      <p>Recorded broadcasts are stored in Cloudflare R2 object storage.</p>
      <p>
        Cloudflare may process limited technical data (such as IP addresses or network metadata) to
        provide storage and delivery services.
      </p>
      <p>Channel controls access to all stored recordings.</p>

      <h3>4.7 Push Notifications (Mobile)</h3>
      <p>We store a Firebase Cloud Messaging (FCM) token to deliver notifications.</p>
      <p>Tokens are removed when you sign out, disable notifications, or uninstall the app.</p>

      <h3>4.8 Local Device Storage</h3>
      <p>Your device may store:</p>
      <ul>
        <li>favorites (local copies)</li>
        <li>notification settings</li>
        <li>feature discovery flags</li>
        <li>recently viewed shows</li>
        <li>temporary session identifiers</li>
        <li>temporary Magic Link email</li>
      </ul>
      <p>Local data is removed when you uninstall the app or clear browser storage.</p>

      <h3>4.9 Automated Activity Messages</h3>
      <p>Channel may generate system-generated messages based on activity, including:</p>
      <ul>
        <li>Love reactions</li>
        <li>Locked-in messages</li>
        <li>Tip acknowledgments</li>
      </ul>
      <p>These messages are optional, rate-limited, and configurable.</p>

      <h3>4.10 @Channel Mentions Logging</h3>
      <p>
        Messages mentioning &quot;@Channel&quot; are logged for developer review and abuse
        detection.
      </p>
      <p>These logs are not used for advertising or profiling.</p>

      <h3>4.11 Payments &amp; Tips</h3>
      <p>Channel may allow users to voluntarily support DJs through tips.</p>
      <p>
        Payments are processed by Stripe. Channel does not store full payment card numbers or
        sensitive payment credentials.
      </p>
      <p>Channel may store limited transaction information, including:</p>
      <ul>
        <li>payment amount and currency</li>
        <li>transaction identifiers</li>
        <li>timestamp</li>
        <li>payment status</li>
        <li>associated DJ or show</li>
      </ul>
      <p>Tips may be sent with or without creating an account.</p>
      <ul>
        <li>
          For logged-in users, tips are internally associated with the user&apos;s account identifier
          and username.
        </li>
        <li>
          For guest users, tips are associated with a transaction identifier without creating a user
          profile.
        </li>
      </ul>
      <p>
        If a DJ does not complete payout setup within a defined period, transaction records related
        to unclaimed tips may be associated with Channel&apos;s DJ Support Pool for internal
        accounting purposes.
      </p>
      <p>Creators receiving payouts must complete identity verification directly with Stripe.</p>

      <h3>4.12 DJ / Creator Applications</h3>
      <p>If you apply to become a DJ or broadcaster, we may collect:</p>
      <ul>
        <li>DJ or project name</li>
        <li>email address</li>
        <li>show name</li>
        <li>preferred broadcast times</li>
        <li>venue information (if applicable)</li>
        <li>optional social media links</li>
      </ul>
      <p>
        This information is used to evaluate applications, schedule broadcasts, and communicate
        with DJs.
      </p>

      <h3>4.13 DJ Broadcast History</h3>
      <p>
        For DJs, Channel retains a history of broadcasts including show identifiers and dates for
        operational, archival, and scheduling purposes.
      </p>
      <p>If a DJ account is removed, associated broadcast history and recordings are removed.</p>

      <h3>4.14 Public DJ Profiles &amp; DJ Studio</h3>
      <p>
        DJs may create public profile pages (e.g. /dj/[username]) displaying information they
        choose to provide, such as:
      </p>
      <ul>
        <li>DJ name</li>
        <li>bio</li>
        <li>photos</li>
        <li>social links</li>
        <li>shows and recommendations</li>
      </ul>
      <p>These pages are publicly accessible and may be viewed without an account.</p>
      <p>
        DJs manage this information through the DJ Studio and are responsible for the content they
        choose to make public.
      </p>

      <h3>4.15 Collectives, Venues &amp; Events</h3>
      <p>Channel may display public pages for collectives, venues, and events.</p>
      <p>These pages may include:</p>
      <ul>
        <li>names and descriptions</li>
        <li>social media links</li>
        <li>associated DJs or shows</li>
        <li>location or event information</li>
      </ul>
      <p>Information may originate from:</p>
      <ul>
        <li>DJs or organizers</li>
        <li>Channel administrators</li>
        <li>publicly available sources</li>
      </ul>

      <h2>5. Legal Bases for Processing (GDPR / UK GDPR)</h2>

      <p>
        <strong>Contract (Article 6(1)(b))</strong>
      </p>
      <ul>
        <li>accounts and authentication</li>
        <li>live streaming and recording</li>
        <li>chat and community features</li>
        <li>DJ Studio and profile functionality</li>
        <li>notifications and reminders</li>
      </ul>

      <p>
        <strong>Consent (Article 6(1)(a))</strong>
      </p>
      <ul>
        <li>email communications</li>
        <li>push notifications</li>
        <li>calendar sync</li>
        <li>automated activity messages</li>
      </ul>

      <p>
        <strong>Legitimate Interest (Article 6(1)(f))</strong>
      </p>
      <ul>
        <li>security and abuse prevention</li>
        <li>fraud detection</li>
        <li>service reliability</li>
        <li>improving discovery and recommendation features</li>
      </ul>

      <p>No data is used for advertising or profiling.</p>

      <h2>6. How We Use Information</h2>
      <p>We use personal data to:</p>
      <ul>
        <li>operate live streams and recordings</li>
        <li>display public DJ profiles and show information</li>
        <li>provide chat and community features</li>
        <li>enable following DJs and favoriting shows</li>
        <li>generate personalized recommendations based on preferences or estimated location</li>
        <li>deliver notifications and digest emails</li>
        <li>facilitate voluntary tips and DJ payouts</li>
        <li>prevent fraud and abuse</li>
        <li>improve platform reliability</li>
      </ul>
      <p>We do not sell personal data or share it with advertisers.</p>

      <h2>7. Data Sharing</h2>
      <p>Channel shares data only with service providers required to operate the platform:</p>
      <ul>
        <li>Firebase / Google Cloud</li>
        <li>Hetzner</li>
        <li>Cloudflare R2</li>
        <li>Vercel</li>
        <li>Resend</li>
        <li>Stripe</li>
      </ul>
      <p>All providers act as processors and do not use data for advertising.</p>

      <h2>8. International Transfers</h2>
      <p>Data may be processed in the United States and the European Union.</p>
      <p>Transfers are protected by:</p>
      <ul>
        <li>Standard Contractual Clauses (SCCs)</li>
        <li>additional security measures</li>
      </ul>

      <h2>9. Data Retention</h2>
      <ul>
        <li>
          Account data: deleted upon account deletion, including favorites, watchlist, saved
          searches, notification preferences, and username reservation
        </li>
        <li>Chat messages: retained after account deletion; may be removed upon request</li>
        <li>Presence session identifiers: short-lived</li>
        <li>Live stream recordings: retained unless removed</li>
        <li>DJ profiles: retained until deletion or removal request</li>
        <li>Payment transaction records: retained for accounting, compliance, and disputes</li>
        <li>DJ application data: retained while relevant</li>
        <li>Moderation logs: retained as necessary for safety</li>
      </ul>
      <p>
        Favorites may be automatically removed if the associated show or event is deleted from the
        platform.
      </p>

      <h2>10. Your Rights (GDPR / UK GDPR)</h2>
      <p>You may:</p>
      <ul>
        <li>access your data</li>
        <li>correct inaccuracies</li>
        <li>request deletion</li>
        <li>export your data</li>
        <li>withdraw consent</li>
        <li>object to processing</li>
      </ul>
      <p>
        Contact: <a href="mailto:support@channel-app.com">support@channel-app.com</a>
      </p>

      <h2>11. Automated Decision-Making</h2>
      <p>Channel does not use automated decision-making or profiling.</p>

      <h2>12. Security</h2>
      <p>
        We use industry-standard safeguards including HTTPS, access controls, Firestore security
        rules, and infrastructure protections.
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
