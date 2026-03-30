import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use - Channel",
  description: "Terms of Use for Channel - Channel Media, Inc.",
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
        Last updated: March 2026
      </p>

      <h2>1. Acceptance of Terms</h2>
      <p>
        By accessing or using Channel — including the mobile app, web app, Channel Radio, DJ
        Studio, public DJ pages, and DJ profile chats — you agree to these Terms of Use.
      </p>
      <p>If you do not agree, do not use Channel.</p>

      <h2>2. Eligibility</h2>
      <p>Channel is intended for users 16 years and older worldwide.</p>

      <h2>3. Description of the Service</h2>
      <p>Channel is a platform that enables users to:</p>
      <ul>
        <li>listen to live audio streams from third-party radio stations</li>
        <li>listen to live DJ broadcasts through Channel Radio (Channel-hosted DJ broadcasts)</li>
        <li>view public pages for DJs, collectives, venues, and events (e.g. /dj/[username])</li>
        <li>interact with public chat rooms associated with DJs or radio stations</li>
        <li>discover show schedules, metadata, and listener indicators</li>
        <li>access external links shared by DJs (including promotional or support links)</li>
        <li>receive optional notifications and emails</li>
        <li>save favorites, watchlists, and searches</li>
      </ul>
      <p>Channel may also provide personalized recommendations based on:</p>
      <ul>
        <li>user preferences (such as selected cities or genres), or</li>
        <li>estimated location derived from the device or browser when available</li>
      </ul>
      <p>Users may adjust their preferences in settings.</p>
      <p>Channel does not own or control the content streamed by third-party radios or DJs.</p>

      <h2>4. Accounts &amp; Authentication</h2>

      <h3>4.1 Mobile App</h3>
      <p>Use is anonymous by default. Users may optionally authenticate using:</p>
      <ul>
        <li>email and password</li>
        <li>email Magic Link</li>
        <li>Google OAuth</li>
        <li>Apple Sign-In</li>
      </ul>
      <p>You are responsible for maintaining the security of your account credentials.</p>

      <h2>5. Public DJ Profiles</h2>

      <h3>5.1 Profile Content</h3>
      <p>Channel displays public DJ profiles that may include:</p>
      <ul>
        <li>DJ name or username</li>
        <li>biography and descriptive information</li>
        <li>images, artwork, or thumbnails</li>
        <li>location, genres, and recommendations</li>
        <li>social links and external references</li>
        <li>past or upcoming broadcasts and recordings</li>
      </ul>
      <p>Profile information may originate from:</p>
      <ul>
        <li>DJs themselves (after claiming a profile)</li>
        <li>Channel administrators</li>
        <li>publicly available information from third-party platforms</li>
      </ul>
      <p>Channel does not guarantee the accuracy or completeness of DJ profile information.</p>

      <h3>5.2 Pending and Auto-Created Profiles</h3>
      <p>Some DJ profiles may exist before a DJ signs up, including profiles:</p>
      <ul>
        <li>created by Channel administrators</li>
        <li>automatically generated from publicly available sources</li>
      </ul>
      <p>These profiles are displayed for discovery purposes.</p>
      <p>
        If a DJ later signs up with a matching email, the profile may be claimed and updated.
      </p>

      <h2>6. Channel Radio (Listening Experience)</h2>
      <p>Channel Radio displays live DJ broadcasts hosted on Channel.</p>
      <p>Broadcasts may:</p>
      <ul>
        <li>appear dynamically when a DJ is live</li>
        <li>include chat, reactions, or recordings</li>
        <li>be interrupted, delayed, or unavailable</li>
      </ul>
      <p>Channel does not guarantee broadcast availability, quality, or continuity.</p>

      <h2>7. External Links &amp; Third-Party Services</h2>
      <p>
        Channel may allow DJs to share external links, including links for promotion, content, or
        financial support.
      </p>
      <p>You acknowledge that:</p>
      <ul>
        <li>Channel does not operate or control external websites or services</li>
        <li>Channel does not process payments or financial transactions</li>
        <li>any interaction with third-party services is at your own risk</li>
      </ul>
      <p>Channel is not responsible for:</p>
      <ul>
        <li>transactions conducted outside of Channel</li>
        <li>third-party content, services, or platforms</li>
        <li>disputes, losses, or damages resulting from external interactions</li>
      </ul>
      <p>
        Channel may remove or restrict access to links that violate these Terms or Community
        Guidelines.
      </p>

      <h2>8. User Conduct</h2>
      <p>You agree not to post, transmit, promote, or link to content that includes:</p>
      <ul>
        <li>harassment, threats, or abuse</li>
        <li>hate speech or discriminatory content</li>
        <li>illegal or infringing material</li>
        <li>sexual or explicit content</li>
        <li>spam or unrelated self-promotion</li>
        <li>sharing personal information of others</li>
      </ul>
      <p>You also agree not to use Channel to promote or link to:</p>
      <ul>
        <li>adult content involving nudity or explicit sexual acts</li>
        <li>copyright-infringing or unauthorized content</li>
        <li>intellectual property violations</li>
        <li>violent extremism or promotion of unlawful violence</li>
        <li>hate-based content targeting protected groups</li>
      </ul>
      <p>Violations may result in content removal, account restriction, or loss of access.</p>

      <h2>9. User-Generated Content &amp; Chats</h2>

      <h3>9.1 Chat Rooms</h3>
      <p>Chat rooms on Channel may be associated with either:</p>
      <ul>
        <li>radio stations (for third-party streams), or</li>
        <li>DJ profiles (for Channel Radio DJs)</li>
      </ul>
      <p>Chat messages:</p>
      <ul>
        <li>are public</li>
        <li>are visible to other users</li>
        <li>may persist beyond a single broadcast session</li>
      </ul>

      <h3>9.2 Responsibility for Messages</h3>
      <p>You are responsible for any content you post.</p>
      <p>
        Channel does not endorse or verify user-generated content and may remove content that
        violates these Terms or Community Guidelines.
      </p>

      <h2>10. Automated Activity Messages</h2>
      <p>Channel may display system-generated messages related to user activity, including:</p>
      <ul>
        <li>Love reactions</li>
        <li>Locked-in listening indicators</li>
      </ul>
      <p>These messages may appear publicly and can be disabled in settings.</p>
      <p>
        Channel may also automatically add new shows from favorited DJs to a user&apos;s favorites
        list.
      </p>

      <h2>11. Notifications</h2>

      <h3>11.1 Push Notifications (Mobile)</h3>
      <p>Optional notifications may include:</p>
      <ul>
        <li>show reminders</li>
        <li>go-live alerts</li>
        <li>mentions</li>
      </ul>

      <h3>11.2 Email Notifications (Web)</h3>
      <p>Optional emails may include:</p>
      <ul>
        <li>show reminders</li>
        <li>watchlist updates</li>
        <li>digest emails including personalized recommendations</li>
      </ul>
      <p>You may disable notifications at any time.</p>

      <h2>12. Third-Party Services</h2>
      <p>Channel integrates third-party services, including:</p>
      <ul>
        <li>Firebase / Google Cloud</li>
        <li>Hetzner (streaming infrastructure)</li>
        <li>Cloudflare R2 (recording storage)</li>
        <li>Vercel (hosting)</li>
        <li>Resend (email)</li>
      </ul>
      <p>Channel is not responsible for third-party service interruptions or failures.</p>

      <h2>13. Disclaimers</h2>
      <p>Channel is provided &quot;as is&quot; without warranties of any kind.</p>

      <h2>14. Limitation of Liability</h2>
      <p>To the fullest extent permitted by law, Channel Media, Inc. is not liable for:</p>
      <ul>
        <li>broadcast interruptions or failures</li>
        <li>accuracy of DJ profile information</li>
        <li>user-generated content or chat messages</li>
        <li>third-party services or external links</li>
        <li>transactions conducted outside of Channel</li>
        <li>data loss or unauthorized account access</li>
      </ul>
      <p>Your sole remedy is to stop using Channel.</p>

      <h2>15. Reporting &amp; Enforcement</h2>
      <p>You may report issues via:</p>
      <ul>
        <li>shaking your device (mobile)</li>
        <li>mentioning @Channel in chat</li>
        <li>emailing <a href="mailto:support@channel-app.com">support@channel-app.com</a></li>
      </ul>
      <p>Channel may remove content or restrict access at its discretion.</p>

      <h2>16. Account Deletion</h2>
      <p>Users may delete their account via Settings.</p>
      <p>Deletion removes associated user data as described in the Privacy Policy.</p>

      <h2>17. Governing Law</h2>
      <p>
        These Terms are governed by U.S. federal law and the laws of California, except where EU/UK
        consumer protections apply.
      </p>

      <h2>18. Contact</h2>
      <p>
        Channel Media, Inc.
        <br />
        <a href="mailto:info@channel-app.com">info@channel-app.com</a>
        <br />
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>
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
