import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Field Notes Terms",
  description: "Submission terms for Field Notes on Channel.",
  alternates: { canonical: "/field-notes-terms" },
};

export default function FieldNotesTermsPage() {
  return (
    <div className="legal-container">
      <Link href="/" className="inline-block text-gray-500 text-sm mb-8 hover:text-white">
        &larr; Back to Channel
      </Link>

      <h1>Field Notes Terms</h1>
      <p className="last-updated">
        Channel Media, Inc.
        <br />
        Last updated: July 2026
      </p>

      <h2>1. Scope</h2>
      <p>
        These Field Notes Submission Terms apply whenever you submit a Field Note to Channel, whether or not
        you have a Channel account.
      </p>
      <p>By submitting a Field Note, you agree to these Terms.</p>

      <h2>2. What is a Field Note?</h2>
      <p>
        A Field Note is a short audio recording submitted by a listener describing their personal experience
        at a live event, DJ performance, venue, festival, or other music-related experience.
      </p>
      <p>Field Notes may be recorded directly within Channel or uploaded from another source.</p>

      <h2>3. Ownership</h2>
      <p>You retain ownership of your Field Note.</p>
      <p>Submitting a Field Note does not transfer ownership of your recording to Channel.</p>

      <h2>4. License Granted to Channel</h2>
      <p>
        By submitting a Field Note, you grant Channel Media, Inc. a worldwide, non-exclusive, royalty-free,
        perpetual, irrevocable license to:
      </p>
      <ul>
        <li>host</li>
        <li>store</li>
        <li>reproduce</li>
        <li>edit</li>
        <li>transcribe</li>
        <li>translate</li>
        <li>publish</li>
        <li>distribute</li>
        <li>publicly perform</li>
        <li>publicly communicate</li>
        <li>promote</li>
      </ul>
      <p>your Field Note in connection with operating and promoting Channel.</p>
      <p>This includes use on:</p>
      <ul>
        <li>Channel mobile and web apps</li>
        <li>DJ pages</li>
        <li>Event pages</li>
        <li>Venue pages</li>
        <li>Collective pages</li>
        <li>Field Notes pages</li>
        <li>newsletters</li>
        <li>podcasts</li>
        <li>recap shows</li>
        <li>editorial content</li>
        <li>social media</li>
        <li>promotional materials</li>
        <li>future Channel products and services</li>
      </ul>
      <p>Channel is not required to publish any submission.</p>

      <h2>5. Your Representations</h2>
      <p>You represent and warrant that:</p>
      <ul>
        <li>the recording is yours or you have permission to submit it;</li>
        <li>submitting it does not violate the rights of any third party;</li>
        <li>
          you have obtained any permissions required to record and share the voices of identifiable
          individuals where required by applicable law;
        </li>
        <li>
          the information you provide about DJs, venues, collectives, or events is accurate to the best of
          your knowledge.
        </li>
      </ul>
      <p>You remain solely responsible for your submission.</p>

      <h2>6. Moderation</h2>
      <p>Every Field Note is manually reviewed before publication.</p>
      <p>Channel may, at its sole discretion:</p>
      <ul>
        <li>approve</li>
        <li>reject</li>
        <li>edit</li>
        <li>trim</li>
        <li>normalize audio</li>
        <li>categorize</li>
        <li>feature</li>
        <li>unpublish</li>
        <li>remove</li>
      </ul>
      <p>any Field Note.</p>
      <p>Channel has no obligation to explain moderation decisions.</p>

      <h2>7. Editorial Use</h2>
      <p>
        Field Notes may be incorporated into editorial features, playlists, recap shows, documentaries,
        podcasts, newsletters, promotional campaigns, and similar content produced by Channel.
      </p>
      <p>Channel may combine multiple Field Notes with other editorial material.</p>

      <h2>8. Removal Requests</h2>
      <p>
        You may request that your Field Note be removed by contacting{" "}
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>.
      </p>
      <p>
        Channel will consider requests but is not obligated to remove recordings that have already been
        incorporated into published editorial or promotional materials.
      </p>

      <h2>9. Prohibited Content</h2>
      <p>You may not submit Field Notes containing:</p>
      <ul>
        <li>harassment or hate speech;</li>
        <li>explicit sexual content;</li>
        <li>illegal activity;</li>
        <li>copyright-infringing material;</li>
        <li>misleading or fabricated submissions;</li>
        <li>recordings submitted without required permissions.</li>
      </ul>

      <h2>10. Liability</h2>
      <p>
        You agree to indemnify and hold harmless Channel Media, Inc. from claims arising from your Field
        Note, including claims relating to copyright, privacy, publicity rights, or other legal rights.
      </p>

      <h2>11. Contact</h2>
      <p>
        Channel Media, Inc.
        <br />
        <a href="mailto:support@channel-app.com">support@channel-app.com</a>
      </p>

      <footer className="legal-footer">
        <p>&copy; 2026 Channel Media, Inc.</p>
      </footer>
    </div>
  );
}
