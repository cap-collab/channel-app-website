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
        Last updated: December 2025
      </p>

      <h2>1. Introduction</h2>
      <p>
        Channel Media, Inc. (&quot;Channel,&quot; &quot;we,&quot; &quot;our,&quot; &quot;us&quot;)
        provides a platform for streaming independent radio stations, discovering shows, and
        participating in public chat communities. Channel is available on both mobile and web.
      </p>
      <p>
        This Privacy Policy explains what information we collect, how we use it, how long we retain
        it, and the rights available to users in the EU, EEA, and UK under GDPR and UK GDPR.
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
        We do not target our service specifically to the EU/EEA/UK. Access is offered on a passive
        basis, so an EU representative is not required under GDPR Article 27.
      </p>

      <h2>3. Minimum Age</h2>
      <p>Channel is intended for users 16 years and older.</p>
      <p>We do not knowingly collect data from children under 16.</p>
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
      <p>We collect only the information needed to operate the service.</p>

      <h3>4.1 Information You Provide Directly</h3>

      <p>
        <strong>A. Chat Messages (Mobile + Web)</strong>
      </p>
      <ul>
        <li>Public messages you post in chat rooms</li>
        <li>Visible to anyone tuned into a station</li>
        <li>Stored in Firestore</li>
        <li>You may request deletion of all your messages</li>
      </ul>

      <p>
        <strong>B. Username</strong>
      </p>
      <ul>
        <li>Optional on mobile</li>
        <li>Automatically created on web from your authentication provider</li>
        <li>Displayed publicly in chat and automated messages (if enabled)</li>
      </ul>

      <p>
        <strong>C. Email and Notification Preferences (Web)</strong>
      </p>
      <p>If you enable email-based features, we store:</p>
      <ul>
        <li>Your email</li>
        <li>Notification preferences</li>
        <li>Watchlist items</li>
        <li>Favorite shows</li>
        <li>Saved search terms</li>
        <li>Digest timestamps</li>
        <li>Calendar sync settings</li>
      </ul>

      <h3>4.2 Authentication Methods</h3>

      <p>
        <strong>A. Google OAuth</strong>
      </p>
      <p>We receive: email, display name, profile photo, timezone.</p>

      <p>
        <strong>B. Apple Sign-In</strong>
      </p>
      <p>
        We receive: email, full name (when shared), and an Apple user identifier.
        <br />
        Apple may mask your email via &quot;Hide My Email.&quot;
      </p>

      <p>
        <strong>C. Email Magic Link</strong>
      </p>
      <p>
        Your email is temporarily stored in localStorage during the login flow and cleared when the
        flow completes or expires.
      </p>

      <h3>4.3 Information Collected Automatically</h3>
      <p>
        We do not use advertising IDs, tracking pixels, fingerprinting, or behavioral analytics.
      </p>
      <p>We collect:</p>
      <ul>
        <li>Firebase User ID (anonymous on mobile, authenticated on web)</li>
        <li>IP address temporarily logged by Google Cloud for security</li>
        <li>Device or app details only when you shake your device to report an issue</li>
        <li>Temporary session IDs used for presence tracking</li>
      </ul>
      <p>We do not collect screenshots or background logs automatically.</p>

      <h3>4.4 Listener Presence Tracking</h3>
      <p>We track listener activity using Firebase Realtime Database.</p>
      <p>We store temporary session IDs and timestamps to display listener counts.</p>
      <p>Session IDs are not linked to usernames or accounts.</p>

      <h3>4.5 Push Notifications (Mobile)</h3>
      <p>We store a Firebase Cloud Messaging (FCM) token to deliver notifications.</p>
      <p>The token is removed when you sign out, disable notifications, or uninstall the app.</p>

      <h3>4.6 Notification History (Local Storage)</h3>
      <p>Your device may retain a short-term notification history.</p>
      <p>These entries are stored locally for up to 5 days and then deleted automatically.</p>

      <h3>4.7 Local Device Storage (UserDefaults / LocalStorage)</h3>
      <p>Your device may store:</p>
      <ul>
        <li>Favorites (local copies)</li>
        <li>Notification settings</li>
        <li>Feature discovery flags</li>
        <li>Anonymous counters</li>
        <li>Recently viewed shows</li>
        <li>Local presence session IDs</li>
        <li>Temporary Magic Link login email</li>
      </ul>
      <p>Local data is removed when you uninstall the app or clear browser storage.</p>

      <h3>4.8 Favorites, Watchlist, and User Collections</h3>
      <p>We store server-side synchronized data in Firestore under your user ID, including:</p>
      <ul>
        <li>Favorites</li>
        <li>Watchlist items</li>
        <li>Saved searches</li>
        <li>Notification preferences</li>
      </ul>
      <p>This data supports cross-device sync and is deleted when your account is deleted.</p>

      <h3>4.9 Automated Activity Messages (Love, Locked In, Favorites)</h3>
      <p>
        When enabled, Channel may generate automatic public messages based on your behavior:
      </p>
      <ul>
        <li>Love reactions</li>
        <li>Locked In messages (after approximately 35 minutes of listening)</li>
        <li>Favorite messages (manual or via Auto-Favorite)</li>
      </ul>
      <p>These messages can be disabled in settings.</p>
      <p>They may appear anonymously or with your username depending on your preference.</p>
      <p>Automated messages are rate-limited to prevent spam.</p>

      <h3>4.10 @Channel Mentions Logging</h3>
      <p>
        Messages that mention &quot;@Channel&quot; are logged in a separate Firestore collection for
        developer review and abuse detection.
      </p>
      <p>We do not use these logs for advertising or profiling.</p>

      <h3>4.11 Firebase Remote Config</h3>
      <p>Remote Config is used to adjust app behavior (e.g., notification thresholds, UI flags).</p>
      <p>Remote Config does not collect personal data.</p>

      <h2>5. Legal Bases for Processing (GDPR and UK GDPR)</h2>

      <p>
        <strong>A. Contract (Article 6(1)(b))</strong>
      </p>
      <p>We process data to:</p>
      <ul>
        <li>Provide chat functionality</li>
        <li>Provide user accounts</li>
        <li>Sync favorites, watchlists, and searches</li>
        <li>Deliver notifications</li>
        <li>Provide calendar sync</li>
        <li>Send reminders and digests</li>
      </ul>

      <p>
        <strong>B. Consent (Article 6(1)(a))</strong>
      </p>
      <p>We rely on consent for:</p>
      <ul>
        <li>Email alerts and digests</li>
        <li>Calendar sync</li>
        <li>Automated activity messages</li>
        <li>Favorites, watchlists, and searches</li>
        <li>Push notifications</li>
        <li>Magic Link authentication</li>
        <li>Apple Sign-In data</li>
      </ul>
      <p>You may withdraw consent at any time.</p>

      <p>
        <strong>C. Legitimate Interest (Article 6(1)(f))</strong>
      </p>
      <p>Used for:</p>
      <ul>
        <li>Abuse detection</li>
        <li>Security</li>
        <li>Fraud prevention</li>
        <li>Debugging user-reported issues</li>
        <li>Maintaining service stability</li>
      </ul>
      <p>We do not rely on legitimate interest for advertising or profiling.</p>

      <h2>6. How We Use Information</h2>
      <p>We use your data to:</p>
      <ul>
        <li>Enable chat and social functionality</li>
        <li>Display usernames</li>
        <li>Personalize favorites and watchlists</li>
        <li>Deliver email and push notifications</li>
        <li>Sync shows to your calendar</li>
        <li>Provide listener presence indicators</li>
        <li>Prevent spam and abuse</li>
        <li>Improve safety and stability</li>
      </ul>
      <p>We do not:</p>
      <ul>
        <li>Sell your data</li>
        <li>Engage in behavioral advertising</li>
        <li>Use tracking for profiling</li>
        <li>Share your data with advertisers</li>
      </ul>

      <h2>7. Data Sharing</h2>

      <p>
        <strong>A. Firebase (Google Cloud Platform)</strong>
      </p>
      <p>
        Used for authentication, data storage, presence tracking, notification tokens, and
        infrastructure.
      </p>
      <p>Google may temporarily log IPs for security.</p>

      <p>
        <strong>B. Resend (Email Provider)</strong>
      </p>
      <p>Used to send emails. Receives only your email and message content.</p>

      <p>
        <strong>C. GitHub Pages</strong>
      </p>
      <p>Hosts public show metadata. Does not process user data.</p>

      <p>We do not sell or rent your data.</p>

      <h2>8. International Transfers</h2>
      <p>Data may be transferred to the United States.</p>
      <p>Transfers to Google Cloud and Resend are protected by:</p>
      <ul>
        <li>Standard Contractual Clauses (SCCs)</li>
        <li>Additional security measures</li>
      </ul>
      <p>Copies of SCCs are available upon request.</p>

      <h2>9. Data Retention</h2>
      <p>We retain data only as long as necessary.</p>
      <p>Retention details:</p>
      <ul>
        <li>
          <strong>Chat messages:</strong> retained until you request deletion
        </li>
        <li>
          <strong>Username:</strong> retained until deletion request
        </li>
        <li>
          <strong>Favorites, watchlist, searches:</strong> retained until you remove them or delete
          your account
        </li>
        <li>
          <strong>Email and notification preferences:</strong> retained until you disable them or
          delete your account
        </li>
        <li>
          <strong>FCM tokens:</strong> removed on sign-out, uninstall, or when notifications are
          disabled
        </li>
        <li>
          <strong>Presence session IDs:</strong> short-lived and auto-expiring
        </li>
        <li>
          <strong>Notification history (local):</strong> stored for 5 days, device-only
        </li>
        <li>
          <strong>Local device storage:</strong> removed on uninstall or when cleared manually
        </li>
        <li>
          <strong>Bug report metadata:</strong> retained for up to 90 days
        </li>
        <li>
          <strong>@Channel logs:</strong> retained for up to 180 days for abuse investigation
        </li>
        <li>
          <strong>Account deletion (web and mobile):</strong> deletes all user-associated data as
          described above
        </li>
      </ul>

      <h2>10. Your Rights (GDPR and UK GDPR)</h2>
      <p>If you are in the EU, EEA, or UK, you may:</p>
      <ul>
        <li>Access your data</li>
        <li>Correct inaccurate data</li>
        <li>Delete your data</li>
        <li>Delete your chat messages</li>
        <li>Export your data</li>
        <li>Withdraw consent</li>
        <li>Restrict processing</li>
        <li>Object to processing based on legitimate interest</li>
        <li>File a complaint with a supervisory authority</li>
      </ul>
      <p>
        To exercise your rights, email:{" "}
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>
      </p>
      <p>Data Export: We can provide an export of your account data via secure email or download link.</p>

      <h2>11. Automated Decision-Making</h2>
      <p>Channel does not use automated decision-making or profiling.</p>

      <h2>12. Security</h2>
      <p>
        We use Firebase Authentication, Firestore security rules, HTTPS, access controls, and
        industry-standard infrastructure protections.
      </p>
      <p>No system is perfectly secure, but we take reasonable steps to protect your information.</p>

      <h2>13. Changes to This Policy</h2>
      <p>
        We may update this policy. Updates will appear with a new &quot;Last updated&quot; date.
      </p>
      <p>Continued use of Channel indicates acceptance of the updated policy.</p>

      <h2>14. Contact</h2>
      <p>
        Channel Media, Inc.
        <br />
        General inquiries: <a href="mailto:info@channel-app.com">info@channel-app.com</a>
        <br />
        Safety and abuse: <a href="mailto:support@channel-app.com">support@channel-app.com</a>
      </p>

      <footer className="legal-footer">
        <p>&copy; 2025 Channel Media, Inc.</p>
      </footer>
    </div>
  );
}
