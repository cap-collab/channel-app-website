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
        Last updated: March 2026
      </p>

      <p>
        Channel exists to support DJ culture, live radio, and shared music experiences. These
        guidelines apply to listeners, chat participants, DJs, and anyone interacting with public
        content on Channel.
      </p>
      <p>These rules apply across the platform, including:</p>
      <ul>
        <li>station chat rooms</li>
        <li>DJ profile chats</li>
        <li>DJ profile pages</li>
        <li>collective, venue, and event pages</li>
        <li>live broadcasts and recordings</li>
      </ul>
      <p>Violations may result in content removal, restrictions, or account suspension.</p>

      <h2>1. Be Respectful</h2>
      <p>
        Harassment, hate speech, discrimination, threats, or targeted abuse are not allowed.
      </p>
      <p>This includes:</p>
      <ul>
        <li>racist, sexist, homophobic, transphobic, or discriminatory language</li>
        <li>threats of violence</li>
        <li>bullying or intimidation</li>
        <li>harassment directed at DJs, listeners, venues, or communities</li>
      </ul>
      <p>Channel has zero tolerance for abusive behavior.</p>

      <h2>2. Keep It Legal</h2>
      <p>Do not share or promote:</p>
      <ul>
        <li>illegal content</li>
        <li>copyright-infringing material</li>
        <li>stolen or leaked music</li>
        <li>personal information about others without permission</li>
        <li>content encouraging illegal or dangerous behavior</li>
      </ul>
      <p>
        Broadcasting or sharing music without the appropriate rights is the responsibility of the DJ.
      </p>

      <h2>3. No Spam or Disruption</h2>
      <p>Do not flood chat or disrupt conversations.</p>
      <p>This includes:</p>
      <ul>
        <li>repeated messages or excessive self-promotion</li>
        <li>automated bots or scripts</li>
        <li>advertising unrelated products or services</li>
        <li>posting the same links repeatedly</li>
      </ul>
      <p>Rate limits may apply to prevent spam.</p>
      <p>Automated activity messages are also rate-limited.</p>

      <h2>4. Usernames</h2>
      <p>Usernames may not:</p>
      <ul>
        <li>impersonate Channel staff, DJs, venues, or other users</li>
        <li>contain offensive or abusive language</li>
        <li>mislead users about identity or affiliation</li>
      </ul>
      <p>Channel may require a username to be changed.</p>

      <h2>5. Mentions &amp; @Channel</h2>
      <p>Use @mentions respectfully.</p>
      <p>Messages tagging @Channel may be logged for review by the moderation team.</p>
      <p>Do not abuse mentions to spam users or disrupt conversations.</p>

      <h2>6. Automated Activity Messages</h2>
      <p>
        Channel may generate optional system messages based on activity, including:
      </p>
      <ul>
        <li>Love reactions</li>
        <li>Locked-in listening indicators</li>
      </ul>
      <p>These messages may appear publicly in chat and can be disabled in Settings.</p>

      <h2>7. DJs &amp; Broadcast Conduct</h2>
      <p>
        DJs are expected to maintain a respectful and safe environment during broadcasts.
      </p>
      <p>DJs must:</p>
      <ul>
        <li>respect listeners and chat participants</li>
        <li>avoid broadcasting offensive, illegal, or infringing content</li>
        <li>ensure venue authorization when broadcasting from venues</li>
        <li>ensure that collaborators appearing in a broadcast are aware of the livestream</li>
      </ul>
      <p>DJs may moderate their chat space, but Channel may intervene if necessary.</p>
      <p>Live broadcasts may be interrupted or terminated for violations.</p>

      <h2>8. Public Pages &amp; Content</h2>
      <p>Channel includes public pages for DJs, collectives, venues, and events.</p>
      <p>Content displayed on these pages should:</p>
      <ul>
        <li>accurately represent the artist, collective, or venue</li>
        <li>not impersonate or misrepresent individuals or organizations</li>
        <li>not include abusive, illegal, or infringing material</li>
      </ul>
      <p>Channel may edit or remove content that violates these guidelines.</p>

      <h2>9. External Links</h2>
      <p>Channel may allow DJs and users to share external links.</p>
      <p>You may not use Channel to promote or link to content that involves:</p>
      <ul>
        <li>adult content containing nudity or explicit sexual acts</li>
        <li>copyright-infringing or unauthorized material</li>
        <li>intellectual property violations</li>
        <li>violent extremism or promotion of unlawful violence</li>
        <li>hate-based content targeting protected groups</li>
      </ul>
      <p>You are responsible for the links you share.</p>
      <p>Channel may remove links or restrict access if they violate these guidelines.</p>

      <h2>10. Moderation</h2>
      <p>Moderation is primarily manual.</p>
      <p>Channel may take actions including:</p>
      <ul>
        <li>message removal</li>
        <li>content removal</li>
        <li>chat restrictions</li>
        <li>removal of links</li>
        <li>account suspension or bans</li>
      </ul>
      <p>Moderation decisions are made at Channel&apos;s discretion to maintain platform safety.</p>

      <h2>11. Reporting</h2>
      <p>You can report issues through:</p>
      <ul>
        <li>shake-to-report (mobile)</li>
        <li>tagging @Channel in chat</li>
        <li>emailing <a href="mailto:support@channel-app.com">support@channel-app.com</a></li>
      </ul>
      <p>Reports may be reviewed by moderators or the development team.</p>

      <footer className="legal-footer">
        <p>&copy; 2026 Channel Media, Inc.</p>
        <p>
          <a href="mailto:info@channel-app.com">info@channel-app.com</a>
        </p>
      </footer>
    </div>
  );
}
