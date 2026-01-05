import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Community Guidelines - Channel",
  description: "Community Guidelines for Channel - Community-Led Media",
};

export default function GuidelinesPage() {
  return (
    <div className="legal-container">
      <Link href="/" className="inline-block text-gray-500 text-sm mb-8 hover:text-white">
        &larr; Back to Channel
      </Link>

      <h1>Community Guidelines</h1>
      <p className="last-updated">
        Channel Media, Inc.
        <br />
        Last updated: January 2026
      </p>

      <p>
        Channel exists to support DJ culture, live radio, and shared music experiences. These guidelines apply to listeners, chat participants, and DJs.
      </p>

      <h2>1. Be Respectful</h2>
      <p>Zero tolerance for harassment, hate speech, discrimination, threats, or targeted abuse.</p>

      <h2>2. Keep It Legal</h2>
      <p>Do not share illegal content, infringing material, personal information, or encourage harmful behavior.</p>

      <h2>3. No Spam</h2>
      <p>Do not flood chat, run bots, advertise unrelated services, or disrupt conversations.</p>
      <p>Manual chat messages are limited to 10 per minute.</p>
      <p>Automated activity messages are also rate-limited.</p>

      <h2>4. Usernames</h2>
      <p>Usernames may not impersonate staff, DJs, venues, or other users, and may not contain offensive language.</p>

      <h2>5. Mentions &amp; @Channel</h2>
      <p>Use @mentions respectfully.</p>
      <p>Messages tagging @Channel are logged for review and reporting.</p>

      <h2>6. Automated Activity Messages</h2>
      <p>Optional system messages include Love, Locked In, and Favorite notifications.</p>
      <p>All can be disabled in Settings.</p>

      <h2>7. DJs &amp; Broadcast Conduct</h2>
      <p>DJs are expected to:</p>
      <ul>
        <li>Respect listeners and chat participants</li>
        <li>Moderate their broadcast chat</li>
        <li>Avoid offensive or illegal content</li>
      </ul>
      <p>Live broadcasts may be interrupted or terminated for violations.</p>

      <h2>8. Moderation</h2>
      <p>Moderation is manual. Actions may include message removal, restrictions, or bans.</p>

      <h2>9. Reporting</h2>
      <p>
        Report issues via shake-to-report, @Channel, or{" "}
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>.
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
