// NOTE (step 8 — funnel acceptance UI): the collective-terms checkbox in the
// AuthModal / activation screen must use this EXACT label (Cap, confirmed):
//   ☐ I confirm that I have authority to manage this collective and agree to the Collective Terms.
// with "Collective Terms" linking to /collective-terms.
import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Collective Terms of Use",
  description: "Terms of Use for collective owners managing a collective page on Channel.",
  alternates: { canonical: "/collective-terms" },
};

export default function CollectiveTermsPage() {
  return (
    <div className="legal-container">
      <Link href="/" className="inline-block text-gray-500 text-sm mb-8 hover:text-white">
        &larr; Back to Channel
      </Link>

      <h1>Collective Terms of Use</h1>
      <p className="last-updated">
        Channel Media, Inc.
        <br />
        Last updated: March 2026
      </p>

      <h2>1. Purpose &amp; Scope</h2>
      <p>
        These Collective Terms of Use (&quot;Collective Terms,&quot; &quot;you&quot;) apply to anyone who manages
        or administers a collective on Channel (&quot;Collective Owner,&quot; &quot;you&quot;).
      </p>
      <p>
        By accepting these Terms or accessing the Collective Studio, you agree to these Collective
        Terms.
      </p>
      <p>
        These Collective Terms supplement Channel&apos;s{" "}
        <Link href="/terms">Terms of Use</Link>,{" "}
        <Link href="/privacy">Privacy Policy</Link>, and{" "}
        <Link href="/guidelines">Community Guidelines</Link>.
      </p>

      <h2>2. Eligibility &amp; Access</h2>
      <p>Access to the Collective Studio is granted by Channel.</p>
      <p>Acceptance of these Collective Terms is required before you can manage a collective.</p>
      <p>
        Channel may approve, revoke, suspend, or modify collective management permissions at any time.
      </p>

      <h2>3. Authority to Represent the Collective</h2>
      <p>
        By managing a collective on Channel, you represent and warrant that you are authorized to act
        on behalf of the collective or otherwise have permission to manage its public presence.
      </p>
      <p>
        You are responsible for ensuring that the information you publish is accurate and that your use
        of the Collective Studio is authorized.
      </p>

      <h2>4. Managing the Collective</h2>
      <p>You may manage information relating to the collective, including:</p>
      <ul>
        <li>name</li>
        <li>description</li>
        <li>images</li>
        <li>location</li>
        <li>genres</li>
        <li>social links</li>
        <li>external links</li>
        <li>upcoming events</li>
        <li>residents</li>
        <li>guest DJs</li>
        <li>other public profile information made available by Channel</li>
      </ul>
      <p>You are responsible for the accuracy of any information you publish.</p>

      <h2>5. Residents, Guests &amp; DJ Profiles</h2>
      <p>Channel allows collective owners to associate DJs and other artists with a collective.</p>
      <p>When adding a person, you represent and warrant that:</p>
      <ul>
        <li>
          you have permission to identify that person as being associated with the collective where
          appropriate;
        </li>
        <li>the information you provide is accurate to the best of your knowledge;</li>
        <li>you will not knowingly impersonate another individual.</li>
      </ul>
      <p>You may:</p>
      <ul>
        <li>link an existing Channel DJ profile;</li>
        <li>add a person by name;</li>
        <li>create a lightweight public profile for someone who does not yet have a Channel account.</li>
      </ul>
      <p>
        Creating a profile for another person does not create a Channel account for that individual and
        does not grant them access to Channel.
      </p>
      <p>
        If an individual later claims or requests correction of a profile, Channel may update,
        transfer, or remove the profile at its discretion.
      </p>

      <h2>6. Events</h2>
      <p>Collective owners may create and manage events associated with their collective.</p>
      <p>You are responsible for ensuring event information is accurate.</p>
      <p>Channel may edit, remove, or moderate events that violate its policies.</p>

      <h2>7. External Links</h2>
      <p>Collectives may share external websites and social media links.</p>
      <p>
        Channel does not control external websites and is not responsible for their content or
        services.
      </p>
      <p>Channel may remove links that violate the Terms of Use or Community Guidelines.</p>

      <h2>8. Prohibited Content</h2>
      <p>You may not use the Collective Studio to publish or promote:</p>
      <ul>
        <li>illegal content;</li>
        <li>copyright-infringing material;</li>
        <li>adult content containing nudity or explicit sexual acts;</li>
        <li>violent extremist content;</li>
        <li>hate speech;</li>
        <li>impersonation;</li>
        <li>misleading or fraudulent information.</li>
      </ul>

      <h2>9. Moderation</h2>
      <p>Channel may review, edit, remove, or refuse to publish any collective content.</p>
      <p>Channel may suspend or revoke collective management access at any time.</p>

      <h2>10. Data Collection</h2>
      <p>Channel may collect information relating to:</p>
      <ul>
        <li>collective ownership;</li>
        <li>collective settings;</li>
        <li>public profile information;</li>
        <li>events;</li>
        <li>residents and guests;</li>
        <li>moderation history.</li>
      </ul>
      <p>
        Data handling is governed by the{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>11. Indemnification</h2>
      <p>You agree to defend and indemnify Channel Media, Inc. from claims arising from:</p>
      <ul>
        <li>your management of the collective;</li>
        <li>inaccurate information;</li>
        <li>unauthorized representation;</li>
        <li>intellectual property disputes;</li>
        <li>your breach of these Collective Terms.</li>
      </ul>

      <h2>12. Termination</h2>
      <p>Channel may suspend or revoke collective management access at any time.</p>
      <p>Removal of management access does not necessarily remove the collective page.</p>

      <h2>13. Governing Law</h2>
      <p>These Terms are governed by the laws described in Channel&apos;s Terms of Use.</p>

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
