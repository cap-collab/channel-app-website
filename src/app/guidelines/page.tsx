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
        music experiences. To keep this space safe, fun, and welcoming, everyone must follow these
        guidelines.
      </p>

      <h2>1. Be Respectful</h2>
      <p>
        <span className="highlight">Zero tolerance for:</span>
      </p>
      <ul>
        <li>Harassment, bullying, or personal attacks</li>
        <li>Racism, sexism, homophobia, transphobia</li>
        <li>Hate speech or discriminatory language</li>
        <li>Threats or intimidation</li>
      </ul>

      <h2>2. Keep It Legal</h2>
      <p>Do not post or encourage:</p>
      <ul>
        <li>Illegal content or activities</li>
        <li>Copyrighted material you do not own</li>
        <li>Personal or identifying information about others</li>
        <li>Dangerous, harmful, or exploitative behavior</li>
      </ul>

      <h2>3. No Spam</h2>
      <p>Do not:</p>
      <ul>
        <li>Post the same message repeatedly</li>
        <li>Advertise products, services, or events</li>
        <li>Promote unrelated content</li>
        <li>Use bots, scripts, or automation to post messages</li>
      </ul>
      <p>
        <span className="highlight">Rate Limit:</span>
      </p>
      <ul>
        <li>Manual chat messages are limited to 10 messages per minute.</li>
        <li>Automated system messages (Love, Locked In, Favorites) are also rate-limited to prevent spam.</li>
      </ul>

      <h2>4. Usernames</h2>
      <p>Usernames must follow the rules. The following are not allowed:</p>
      <ul>
        <li>Impersonation of other users</li>
        <li>Impersonation of staff (&quot;Admin,&quot; &quot;Moderator,&quot; &quot;Channel,&quot; &quot;System,&quot; etc.)</li>
        <li>Offensive, hateful, or slur-based names</li>
      </ul>
      <p>Violations may result in forced username changes or account restrictions.</p>

      <h2>5. @Mentions</h2>
      <p>Users may mention others using &quot;@username&quot;.</p>
      <ul>
        <li>Use mentions respectfully.</li>
        <li>Mentions may trigger notifications for the user you tag.</li>
        <li>Harassing or abusive mentions violate Section 1.</li>
      </ul>
      <p>
        <span className="highlight">@Channel Mentions:</span>
      </p>
      <ul>
        <li>Tagging @Channel automatically logs the message for developer review.</li>
        <li>This can be used to report bugs or flag inappropriate content.</li>
      </ul>

      <h2>6. Automated Activity Messages</h2>
      <p>
        Channel may generate optional automatic messages in the chat to reflect your listening activity.
        All automated messages can be disabled in Settings.
      </p>
      <p>
        <strong>Types of automated messages:</strong>
      </p>
      <ul>
        <li>Love Reactions (e.g., &quot;username is loving this show&quot;)</li>
        <li>Locked In (posted after about 35 minutes of continuous listening)</li>
        <li>Favorite Messages (posted when you mark a show as a favorite, manually or via Auto-Favorite)</li>
      </ul>
      <p>Automated messages are subject to rate limits to prevent spam or disruption.</p>

      <h2>7. Moderation</h2>
      <p>Moderation is currently manual.</p>
      <p>
        <strong>Possible moderation actions include:</strong>
      </p>
      <ul>
        <li>Message deletion</li>
        <li>Username removal</li>
        <li>Temporary restrictions</li>
        <li>Future: device-level or IP-level bans for repeated or severe abuse</li>
      </ul>
      <p>Repeated violations may result in escalating consequences.</p>

      <h2>8. How to Report</h2>
      <p>If something feels off or unsafe, you can report it using any of the following methods:</p>
      <ul>
        <li>Shake your device &rarr; &quot;Report Something&quot; (mobile only)</li>
        <li>Mention @Channel in chat to flag content for review (mobile only)</li>
        <li>Email: <a href="mailto:support@channel-app.com">support@channel-app.com</a></li>
      </ul>
      <p>All reports are reviewed manually.</p>

      <h2>9. Final Note</h2>
      <p>
        This community is built on trust, respect, and love for music culture.
        Help keep Channel welcoming, safe, and enjoyable for everyone.
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
