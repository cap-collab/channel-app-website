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
        This Privacy Policy explains what information we collect, how we use it, and the rights
        available to users located in the EU, EEA, and UK under GDPR and UK GDPR.
      </p>
      <p>By using Channel, you agree to this Privacy Policy.</p>

      <h2>2. Who We Are</h2>
      <p>
        Channel Media, Inc.
        <br />
        Los Angeles, California, USA
        <br />
        Email: <a href="mailto:info@channel-app.com">info@channel-app.com</a>
        <br />
        Safety/abuse: <a href="mailto:support@channel-app.com">support@channel-app.com</a>
      </p>
      <p>
        We do not target our services specifically to the EU/EEA/UK. We offer access on a passive
        basis, so an EU representative is not required under Article 27.
      </p>

      <h2>3. Minimum Age</h2>
      <p>Channel is intended for users 16 years and older worldwide.</p>
      <p>
        We do not knowingly collect information from children under 16. If you believe a child under
        16 is using Channel, contact:{" "}
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>.
      </p>

      <h2>4. Information We Collect</h2>
      <p>Channel has two different modes:</p>
      <ul>
        <li>
          <strong>Mobile app</strong> — anonymous by default
        </li>
        <li>
          <strong>Web app</strong> — requires Google login
        </li>
      </ul>
      <p>We only collect the minimum data needed to provide the service.</p>

      <h3>4.1 Information You Provide Directly</h3>

      <p>
        <strong>A. Chat Messages (Mobile + Web)</strong>
      </p>
      <ul>
        <li>Public chat messages you send</li>
        <li>Visible to anyone tuned into that station</li>
        <li>Stored in Firestore</li>
        <li>You may request deletion of all your messages (Section 10)</li>
      </ul>

      <p>
        <strong>B. Username</strong>
      </p>
      <ul>
        <li>Optional on the mobile app</li>
        <li>Automatically created on the web from your Google account</li>
        <li>Displayed publicly in chat</li>
      </ul>

      <p>
        <strong>C. Email Preferences (Web)</strong>
      </p>
      <p>
        If you enable email-based features (such as show reminders or digest emails), we store:
      </p>
      <ul>
        <li>Your email</li>
        <li>Notification preferences</li>
        <li>Your favorite shows</li>
        <li>Your watchlist</li>
        <li>Saved search terms</li>
        <li>Last-email-sent timestamps</li>
      </ul>
      <p>Necessary to deliver the features you request.</p>

      <h3>4.2 Information Collected Automatically</h3>
      <p>
        We do not use advertising IDs, tracking pixels, fingerprinting, analytics profiling, or ad
        networks.
      </p>
      <p>We collect limited operational data:</p>
      <ul>
        <li>Firebase User ID (anonymous on mobile, authenticated on web)</li>
        <li>IP address logged temporarily by Google Cloud for security</li>
        <li>Device/app details only if you shake the device to report a bug</li>
        <li>No screenshots or logs are ever sent automatically</li>
      </ul>

      <h3>4.3 Information Collected via Web Login (Google OAuth)</h3>
      <p>When you sign in on the web, we receive:</p>
      <ul>
        <li>Email address</li>
        <li>Display name</li>
        <li>Profile photo</li>
        <li>Timezone</li>
      </ul>
      <p>Used for account creation, personalization, email delivery, and user preferences.</p>

      <h3>4.4 Watchlist, Favorites, and Search Preferences (Web)</h3>
      <p>When using the web app, you may choose to save:</p>
      <ul>
        <li>Favorite shows</li>
        <li>Watchlist items (shows or search topics)</li>
        <li>Saved search terms</li>
        <li>Notification and digest settings</li>
        <li>Calendar sync settings</li>
      </ul>
      <p>Stored in Firestore to provide personalization, reminders, and digests.</p>

      <h3>4.5 Google Calendar Sync (Optional)</h3>
      <p>If you enable Calendar Sync, we store:</p>
      <ul>
        <li>OAuth access token</li>
        <li>OAuth refresh token</li>
        <li>Your Google Calendar ID</li>
        <li>List of shows synced to your calendar</li>
      </ul>
      <p>Used exclusively to add or remove calendar events at your request.</p>
      <p>You can disconnect at any time (Section 10).</p>

      <h2>5. Legal Bases for Processing (GDPR/UK GDPR)</h2>
      <p>We rely on the following legal bases:</p>

      <h3>5.1 Contract (Art. 6(1)(b))</h3>
      <p>To provide the core service:</p>
      <ul>
        <li>Chat functionality</li>
        <li>User account on web</li>
        <li>Display of your username</li>
        <li>Watchlist, favorites, search preferences</li>
        <li>Calendar sync</li>
        <li>Show reminders and digests</li>
      </ul>

      <h3>5.2 Consent (Art. 6(1)(a))</h3>
      <p>For optional features:</p>
      <ul>
        <li>Email alerts and digests</li>
        <li>Calendar sync</li>
        <li>Activity-based automatic messages</li>
        <li>Saving favorites, watchlist, searches</li>
        <li>Username creation (mobile)</li>
      </ul>
      <p>You may withdraw consent at any time (Section 10).</p>

      <h3>5.3 Legitimate Interest (Art. 6(1)(f))</h3>
      <p>For:</p>
      <ul>
        <li>Preventing abuse</li>
        <li>Protecting community safety</li>
        <li>Debugging user-reported issues</li>
        <li>Ensuring platform security</li>
      </ul>
      <p>We never rely on legitimate interest for email marketing, profiling, or advertising.</p>

      <h2>6. How We Use Information</h2>
      <p>We use data only to:</p>
      <ul>
        <li>Provide chat and community features</li>
        <li>Personalize your watchlist and favorites</li>
        <li>Provide email notifications/reminders (web only)</li>
        <li>Sync shows to your Google Calendar (optional)</li>
        <li>Maintain app performance</li>
        <li>Combat spam, abuse, and policy violations</li>
        <li>Improve stability and safety</li>
      </ul>
      <p>We do NOT:</p>
      <ul>
        <li>Sell your data</li>
        <li>Use behavioral advertising</li>
        <li>Use tracking for profiling</li>
        <li>Share your data with advertisers</li>
      </ul>

      <h2>7. Data Sharing</h2>

      <h3>7.1 Firebase (Google Cloud Platform)</h3>
      <p>Used for:</p>
      <ul>
        <li>Authentication</li>
        <li>Storage of chat messages</li>
        <li>Storage of watchlists/favorites/preferences</li>
        <li>Security and infrastructure</li>
      </ul>
      <p>Google may temporarily log IP addresses for security purposes.</p>

      <h3>7.2 Resend (Email Provider)</h3>
      <p>Used to send:</p>
      <ul>
        <li>Show reminders</li>
        <li>Digest emails</li>
        <li>Account notices</li>
      </ul>
      <p>Resend receives only your email and message content.</p>

      <h3>7.3 GitHub Pages</h3>
      <p>Hosts public show metadata. Does not process user data.</p>
      <p>
        <strong>We do not sell or rent your data.</strong>
      </p>

      <h2>8. International Transfers</h2>
      <p>We operate in the United States. Data may be transferred to the US.</p>
      <p>Transfers to Google Cloud (GCP) and Resend are protected by:</p>
      <ul>
        <li>Standard Contractual Clauses (SCCs) approved by the European Commission</li>
        <li>Additional security measures provided by Google and Resend</li>
      </ul>
      <p>Links to SCCs can be provided upon request.</p>

      <h2>9. Data Retention</h2>
      <p>We retain data only for as long as necessary to provide the service or to comply with legal obligations.</p>
      <p>Retention periods:</p>
      <ul>
        <li>
          <strong>Chat messages:</strong> Stored until you request deletion.
        </li>
        <li>
          <strong>Username (mobile or web):</strong> Stored until you request deletion.
        </li>
        <li>
          <strong>Email address and email notification preferences:</strong> Stored until you
          disable notifications or request deletion.
        </li>
        <li>
          <strong>Watchlist, favorites, and saved search terms:</strong> Stored until you remove
          them or request deletion.
        </li>
        <li>
          <strong>Calendar sync OAuth tokens and calendar settings:</strong> Stored until you
          disconnect Google Calendar sync or request deletion.
        </li>
        <li>
          <strong>Bug report metadata (sent when you shake the device):</strong> Retained for up to
          90 days.
        </li>
        <li>
          <strong>Local mobile settings (notifications, preferences):</strong> Stored only on your
          device and deleted when you uninstall the app.
        </li>
        <li>
          <strong>Account deletion (web app):</strong> When you request account deletion, all
          associated data is removed, including email, username, favorites, watchlist, saved
          searches, calendar sync tokens, and notification preferences.
        </li>
      </ul>

      <h2>10. Your Rights (GDPR + UK GDPR)</h2>
      <p>Users in the EU, EEA, and UK have the right to:</p>
      <ul>
        <li>Access your data</li>
        <li>Correct inaccurate data</li>
        <li>Delete your data (&quot;right to be forgotten&quot;)</li>
        <li>Delete all chat messages you have ever posted</li>
        <li>Withdraw consent (email alerts, calendar sync, favorites, watchlist)</li>
        <li>Restrict processing</li>
        <li>Object to processing based on legitimate interests</li>
        <li>Port your data (export)</li>
        <li>File a complaint with a supervisory authority</li>
      </ul>
      <p>
        To exercise these rights, email:{" "}
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>
      </p>
      <p>We may request verification to protect your account.</p>

      <h2>11. Automated Decision-Making</h2>
      <p>Channel does not use automated decision-making or profiling as defined by GDPR.</p>

      <h2>12. Security</h2>
      <p>We use:</p>
      <ul>
        <li>Firebase Authentication</li>
        <li>Firestore security rules</li>
        <li>Encrypted data transport (HTTPS)</li>
        <li>Access controls</li>
        <li>Modern infrastructure safeguards</li>
      </ul>
      <p>No system is perfectly secure, but we take reasonable steps to protect your data.</p>

      <h2>13. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Changes will be posted with a new
        &quot;Last updated&quot; date.
      </p>

      <h2>14. Contact</h2>
      <p>
        Channel Media, Inc.
        <br />
        General: <a href="mailto:info@channel-app.com">info@channel-app.com</a>
        <br />
        Safety/abuse: <a href="mailto:support@channel-app.com">support@channel-app.com</a>
      </p>

      <footer className="legal-footer">
        <p>&copy; 2025 Channel Media, Inc.</p>
        <p>
          <a href="mailto:info@channel-app.com">info@channel-app.com</a>
        </p>
      </footer>
    </div>
  );
}
