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
        Last updated: December 2025<br />
        Channel Media, Inc.
      </p>

      <h2>1. Introduction</h2>
      <p>
        Channel (&quot;we,&quot; &quot;our,&quot; &quot;us&quot;) provides a mobile application that
        streams independent radio stations and enables public chat rooms.
      </p>
      <p>
        <span className="highlight">Channel is designed to be anonymous by default.</span> We do not
        collect email addresses, phone numbers, passwords, or advertising identifiers.
      </p>
      <p>
        This Privacy Policy describes what we collect, why we collect it, and how you can contact us
        with questions.
      </p>
      <p>By using Channel, you agree to this policy.</p>

      <h2>2. Information We Collect</h2>

      <h3>2.1 Information You Provide</h3>
      <p>
        <strong>Chat Messages</strong>
        <br />
        Messages you send in a public chat are stored in Firestore and visible to all users tuned to
        that station.
      </p>
      <p>
        <strong>Username (Optional)</strong>
        <br />
        You may choose a username (2–20 alphanumeric characters). Usernames are stored in Firestore
        so others can see who is speaking.
      </p>

      <h3>2.2 Information Collected Automatically</h3>
      <p>Channel does not collect personal identifiers or tracking data.</p>
      <p>Operational data collected includes:</p>
      <ul>
        <li>
          <strong>Anonymous Firebase User ID</strong> — required for chat.
        </li>
        <li>
          <strong>Firebase infrastructure logs</strong> — Google Cloud may log IP addresses for
          security/abuse prevention.
        </li>
        <li>
          <strong>Device & app details in reports</strong> — Only if you shake your device to report
          something:
          <ul>
            <li>Device model</li>
            <li>iOS version</li>
            <li>App version</li>
          </ul>
        </li>
      </ul>
      <p>No screenshots or logs are sent automatically.</p>

      <h3>2.3 Optional Automatic Activity Messages</h3>
      <p>
        Channel includes an optional feature that posts small messages in the public chat based on
        your activity:
      </p>
      <ul>
        <li>
          When you tap the Love button for a show, the message &quot;username is loving showname&quot; may be
          posted.
        </li>
        <li>
          When you listen to the same show for 35 minutes, the message &quot;username is locked in&quot; may
          be posted.
        </li>
      </ul>
      <p>These messages:</p>
      <ul>
        <li>are optional and can be turned on or off in Settings</li>
        <li>are triggered locally on your device</li>
        <li>do not send logs, diagnostics, analytics, or background reports</li>
        <li>contain no personal information beyond your chosen username</li>
        <li>are visible publicly to users in that station&apos;s chat</li>
      </ul>
      <p>We never send screenshots or system logs automatically.</p>

      <h2>3. How We Use Information</h2>
      <p>We use data only to:</p>
      <ul>
        <li>Enable chat functionality</li>
        <li>Display usernames</li>
        <li>Maintain app performance</li>
        <li>Investigate reports of misuse</li>
        <li>Protect users and prevent abuse</li>
      </ul>
      <p>We do not use your data for:</p>
      <ul>
        <li>Advertising</li>
        <li>Analytics</li>
        <li>Profiling</li>
        <li>Selling to third parties</li>
      </ul>

      <h2>4. Data Sharing</h2>
      <p>
        <span className="highlight">We do not sell your data.</span>
        <br />
        We do not share personal data beyond what is necessary for core functionality.
      </p>

      <h3>4.1 Firebase (Google)</h3>
      <ul>
        <li>Stores chat messages</li>
        <li>Stores username claims</li>
        <li>Provides anonymous authentication</li>
      </ul>

      <h3>4.2 GitHub Pages</h3>
      <p>Hosts non-sensitive metadata (e.g., schedules). Does not store user data.</p>

      <h2>5. Data Retention</h2>
      <ul>
        <li>
          <strong>Chat messages:</strong> Stored indefinitely in Firestore, but the app only
          displays the last hour.
        </li>
        <li>
          <strong>Username:</strong> Persists in Firestore until removed by a user request.
        </li>
        <li>
          <strong>Local preferences:</strong> Stored only on your device and deleted when you
          uninstall the app.
        </li>
      </ul>

      <h2>6. User Choices & Controls</h2>
      <p>You may:</p>
      <ul>
        <li>Use Channel without creating an account</li>
        <li>Avoid chat entirely</li>
        <li>Choose not to provide a username</li>
        <li>Request deletion of your username or specific chat messages</li>
        <li>Uninstall the app to clear all local data</li>
      </ul>
      <p>
        Requests should be sent to{" "}
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>.
      </p>

      <h2>7. Children&apos;s Privacy</h2>
      <p>
        Channel is intended for users 13 years and older. We do not knowingly collect information
        from children under 13.
      </p>

      <h2>8. Security</h2>
      <p>
        We use Firebase Authentication, Firestore rules, and standard platform protections. No
        system is perfectly secure, and we cannot guarantee absolute security.
      </p>

      <h2>9. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy. Changes will be posted on this page with a new &quot;Last
        Updated&quot; date.
      </p>

      <h2>10. Contact Us</h2>
      <p>
        Channel Media, Inc.
        <br />
        Email: <a href="mailto:info@channel-app.com">info@channel-app.com</a>
        <br />
        For reports or safety issues:{" "}
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>
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
