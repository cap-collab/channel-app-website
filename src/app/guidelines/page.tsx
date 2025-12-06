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
      <p className="last-updated">Last updated: December 2025</p>

      <p>
        Channel exists to bring people together through DJ radio culture, community, and shared
        music experiences. To keep this space safe and welcoming, everyone must follow these
        guidelines.
      </p>

      <h2>1. Be Respectful</h2>
      <p>
        <span className="highlight">Zero tolerance for:</span>
      </p>
      <ul>
        <li>Harassment or bullying</li>
        <li>Racism, sexism, homophobia, transphobia</li>
        <li>Hate speech or discriminatory language</li>
        <li>Threats or intimidation</li>
      </ul>

      <h2>2. Keep It Legal</h2>
      <p>Do not post:</p>
      <ul>
        <li>Illegal content</li>
        <li>Copyrighted material</li>
        <li>Personal information about others</li>
        <li>Dangerous or harmful behavior encouragement</li>
      </ul>

      <h2>3. No Spam</h2>
      <p>Do not:</p>
      <ul>
        <li>Post the same message repeatedly</li>
        <li>Advertise services</li>
        <li>Promote products or events</li>
        <li>Run bots or scripts</li>
      </ul>
      <p>
        <span className="highlight">Rate limit: 10 messages per minute.</span>
      </p>

      <h2>4. Usernames</h2>
      <p>Usernames must follow the rules:</p>
      <p>
        <strong>Not allowed:</strong>
      </p>
      <ul>
        <li>Impersonation</li>
        <li>&quot;Admin,&quot; &quot;Moderator,&quot; &quot;Channel,&quot; &quot;System,&quot; etc.</li>
        <li>Offensive or hate-based names</li>
      </ul>

      <h2>5. Moderation</h2>
      <p>Moderation is currently manual.</p>
      <p>
        <strong>Possible actions:</strong>
      </p>
      <ul>
        <li>Message deletion</li>
        <li>Username removal</li>
        <li>Temporary restriction</li>
        <li>Future: device-level bans for repeated abuse</li>
      </ul>

      <h2>6. How to Report</h2>
      <p>If something feels off:</p>
      <ul>
        <li>
          <strong>Shake your phone</strong> &rarr; Report Something
        </li>
        <li>
          Or email <a href="mailto:support@channel-app.com">support@channel-app.com</a>
        </li>
      </ul>
      <p>We review all reports manually.</p>

      <h2>7. Final Note</h2>
      <p>
        This community is built on trust and love for music culture. Respect the space, respect the
        people, and help keep Channel safe for everyone.
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
