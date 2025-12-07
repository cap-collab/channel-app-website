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
        Last updated: December 2025
      </p>

      <h2>1. Acceptance of Terms</h2>
      <p>
        By accessing or using Channel — whether through the mobile app or the web app — you agree
        to these Terms of Use.
      </p>
      <p>If you do not agree, do not use Channel.</p>

      <h2>2. Eligibility</h2>
      <p>You must be 16 years or older to use Channel.</p>

      <h2>3. Description of Service</h2>
      <p>Channel provides (across mobile and web):</p>
      <ul>
        <li>Live audio streams from third-party radio stations</li>
        <li>Public chat rooms</li>
        <li>Show schedules</li>
        <li>Optional automated &quot;activity messages&quot;</li>
        <li>Optional local/mobile notifications</li>
        <li>Optional web email alerts (show reminders, digests)</li>
        <li>Optional watchlists and favorites</li>
        <li>Optional Google Calendar sync</li>
        <li>BPM and metadata information</li>
      </ul>
      <p>We do not own or control any station content.</p>

      <h2>4. Accounts &amp; Login</h2>

      <h3>4.1 Mobile App</h3>
      <p>Mobile use is anonymous by default. No account is required.</p>

      <h3>4.2 Web App</h3>
      <p>The web app requires sign-in via Google OAuth.</p>
      <p>When you sign in, we receive:</p>
      <ul>
        <li>Email</li>
        <li>Display name</li>
        <li>Profile photo</li>
        <li>Timezone</li>
        <li>Google Calendar ID (if syncing)</li>
      </ul>
      <p>You agree to keep your account secure and not share access.</p>

      <h2>5. User Conduct</h2>
      <p>You agree not to post or transmit:</p>
      <ul>
        <li>Harassment, threats, or abuse</li>
        <li>Hate speech (racism, sexism, homophobia, transphobia, etc.)</li>
        <li>Illegal content</li>
        <li>Sexual or explicit content</li>
        <li>Spam, ads, or self-promotion</li>
        <li>Someone else&apos;s personal information</li>
      </ul>
      <p>Violations may result in message removal or access restriction.</p>

      <h2>6. User-Generated Content</h2>
      <p>
        Chat messages and activity posts are public and visible to anyone tuned into that station.
      </p>

      <h3>Optional Automatic Activity Messages</h3>
      <p>
        Channel may post short activity-based messages (ex: &quot;username is loving this
        show&quot;).
      </p>
      <p>These:</p>
      <ul>
        <li>Are optional</li>
        <li>Can be disabled at any time</li>
        <li>Include only your username</li>
        <li>Appear publicly in chat</li>
      </ul>
      <p>By enabling this option, you acknowledge these messages may appear publicly.</p>

      <h2>7. External Radio Streams</h2>
      <p>Channel streams content from third-party broadcasters such as:</p>
      <p>NTS, Subtle Radio, Dublab, Rinse FM, and others.</p>
      <p>We are not responsible for:</p>
      <ul>
        <li>Schedule accuracy</li>
        <li>Stream availability or interruptions</li>
        <li>Copyright or licensing issues related to station content</li>
        <li>Content quality or appropriateness</li>
      </ul>

      <h2>8. Disclaimers</h2>
      <p>Channel is provided &quot;as is&quot; without warranties of any kind.</p>
      <p>We do not guarantee:</p>
      <ul>
        <li>Continuous or error-free service</li>
        <li>Availability of specific stations</li>
        <li>Accuracy of schedules or metadata</li>
      </ul>

      <h2>9. Limitation of Liability</h2>
      <p>To the maximum extent permitted by law, Channel Media, Inc. is not liable for:</p>
      <ul>
        <li>Service interruptions</li>
        <li>Data loss</li>
        <li>User interactions in chat</li>
        <li>Third-party station content</li>
        <li>Device issues, browser issues, or app crashes</li>
        <li>Unauthorized account access</li>
      </ul>

      <h2>10. Reporting Issues</h2>
      <p>You may report:</p>
      <ul>
        <li>Bugs</li>
        <li>Abuse</li>
        <li>Content violations</li>
      </ul>
      <p>
        By shaking your mobile device or emailing{" "}
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>.
      </p>

      <h2>11. Governing Law</h2>
      <p>
        These Terms are governed by U.S. federal law and the laws of the State of California.
      </p>

      <h2>12. Contact</h2>
      <p>
        Channel Media, Inc.
        <br />
        General contact: <a href="mailto:info@channel-app.com">info@channel-app.com</a>
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
