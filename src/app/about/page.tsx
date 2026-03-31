import Link from "next/link";
import ScrollReveal from "@/components/ScrollReveal";
import { EmailSignup } from "@/components/EmailSignup";
import FAQAccordion from "@/components/FAQAccordion";
import { Header } from "@/components/Header";

const faqItems = [
  {
    question: "What is Channel?",
    answer:
      "Channel is an online radio for the electronic music community, curated in LA.\n\nDJs, labels, venues, and collectives host shows and listening sessions. People tune in, listen together, and connect with their community.\n\nNo ads. No algorithms.",
  },
  {
    question: "Who is it for?",
    answer:
      "For DJs and show hosts\nHost shows, share music, connect directly with the people who care about your craft, and notify your followers when something new happens.\n\nNo more depending on Instagram to reach your audience.\n\nFor listeners\nFollow the DJs and curators you care about. Get notified when something new happens. Tune in when they host shows and connect with them and their community, live.\n\nNo more chasing stories to catch what's next.",
  },
  {
    question: "How is Channel different?",
    answer:
      "Channel is built around people and niche communities.\n\nCurators host shows.\nListeners gather.\nMusic and community spread through trust and taste.\n\nRadio becomes a shared space again.",
  },
  {
    question: "How much does it cost?",
    answer:
      "Channel is free to use. No ads.",
  },
];

export default function About() {
  return (
    <div className="min-h-screen">
      <Header position="sticky" showSearch />

      {/* Hero Section */}
      <section className="min-h-screen flex flex-col justify-center items-center px-6 pt-24 pb-20 relative bg-[#1a1a1a]">
        <div className="max-w-3xl text-center">
          <h1 className="text-2xl md:text-4xl lg:text-5xl font-black text-white mb-6 uppercase tracking-tighter leading-none">
            Platform for electronic music communities.
          </h1>

          <p className="text-lg md:text-xl text-zinc-400 mb-12 max-w-xl mx-auto leading-relaxed">
            Bringing DJs, producers, and dancers closer together.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-stretch">
            <EmailSignup />
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <svg
            className="w-6 h-6 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </div>
      </section>

      {/* My Purpose Section */}
      <section id="my-purpose" className="py-24 px-6 bg-black">
        <ScrollReveal>
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-semibold text-white mb-8 text-center">
              My Purpose
            </h2>

            <div className="space-y-6 text-zinc-400 leading-relaxed">
              <p>
                My name is Cap. I&apos;m building Channel out of love for DJ culture and the communities that make it so special.
              </p>

              <p>
                After moving from France to New York to Los Angeles, I realized how hard it can be to stay connected with DJs, producers, curators, and dancers shaping your community, on and beyond the dancefloor. This diverse and constantly evolving ecosystem deserves better tools — to support artists, strengthen communities, and make it easier to find and follow the sounds and people you care about.
              </p>

              <p>
                I&apos;m looking to connect with music heads of all kinds. Whether you want to collaborate, give feedback, host a show, share your work, find your people, or just chat, I&apos;d love to hear from you.
              </p>

              <p>
                Channel is growing, and I&apos;m especially interested in conversations around programming, community support, and building a healthy, sustainable ecosystem across every niche and taste.
              </p>

              <p>
                If any of this resonates, reach out. I&apos;d love to connect.
              </p>
            </div>

            <div className="mt-10 text-center">
              <Link
                href="/radio"
                className="inline-block bg-white text-black px-10 py-4 rounded text-lg font-semibold hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(255,255,255,0.15)] transition-all"
              >
                Discover Channel Radio
              </Link>
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* Values Section - 3 columns */}
      <section className="py-24 px-6 bg-black">
        <ScrollReveal>
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row md:divide-x divide-gray-800">
              {/* Curated */}
              <div className="flex-1 py-8 md:py-0 md:px-8 first:md:pl-0 last:md:pr-0 border-b md:border-b-0 border-gray-800 last:border-b-0 flex flex-col items-center">
                <h2 className="text-xl md:text-2xl font-bold text-white mb-4 text-center">
                  Curated
                </h2>
                <p className="text-zinc-400 leading-relaxed text-center text-sm mb-8">
                  Channel is built around collectives and people most active in
                  their communities, not surfaced by an algorithm. Discovery
                  here is intentional, rooted in trust, taste, and local
                  scenes.
                </p>
              </div>

              {/* Independent */}
              <div className="flex-1 py-8 md:py-0 md:px-8 first:md:pl-0 last:md:pr-0 border-b md:border-b-0 border-gray-800 last:border-b-0 flex flex-col items-center">
                <h2 className="text-xl md:text-2xl font-bold text-white mb-4 text-center">
                  Independent
                </h2>
                <p className="text-zinc-400 leading-relaxed text-center text-sm mb-8">
                  When someone you follow hosts a show or goes live, you hear
                  about it directly. You can support them through tips and
                  connect with others in the room through chat. No ads. No
                  feed. No algorithm deciding what you should hear.
                </p>
              </div>

              {/* Collaborative */}
              <div className="flex-1 py-8 md:py-0 md:px-8 first:md:pl-0 last:md:pr-0 border-b md:border-b-0 border-gray-800 last:border-b-0 flex flex-col items-center">
                <h2 className="text-xl md:text-2xl font-bold text-white mb-4 text-center">
                  Collective
                </h2>
                <p className="text-zinc-400 leading-relaxed text-center text-sm mb-8">
                  Culture is collective. DJs, producers, venues, promoters,
                  listeners, and dancers shape it together. Channel reflects
                  that. Curators host shows, share the music they care about,
                  and bring their communities together.
                </p>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* FAQ Section */}
      <section className="py-24 px-6 bg-[#1a1a1a]">
        <ScrollReveal>
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-semibold text-white mb-12 text-center">
              About / FAQs
            </h2>
            <FAQAccordion items={faqItems} />
          </div>
        </ScrollReveal>
      </section>

      {/* Footer */}
      <footer className="py-24 px-6 bg-[#1a1a1a]">
        <div className="max-w-3xl mx-auto text-center">
          <ScrollReveal>
            <h3 className="text-2xl md:text-3xl font-semibold text-white mb-4">
              Still have questions?
            </h3>
            <p className="text-zinc-400 mb-10">
              Email me anytime:{" "}
              <a
                href="mailto:info@channel-app.com"
                className="text-white hover:text-gray-300 transition-colors"
              >
                info@channel-app.com
              </a>
            </p>

            {/* Legal links */}
            <div className="text-sm text-gray-600 space-y-3">
              <p>
                <Link href="/privacy" className="text-gray-500 hover:text-white transition-colors">
                  Privacy Policy
                </Link>
                <span className="text-gray-700 mx-3">·</span>
                <Link href="/terms" className="text-gray-500 hover:text-white transition-colors">
                  Terms & Conditions
                </Link>
                <span className="text-gray-700 mx-3">·</span>
                <Link href="/guidelines" className="text-gray-500 hover:text-white transition-colors">
                  Community Guidelines
                </Link>
              </p>
              <p>&copy; 2025 Channel Media, Inc. All rights reserved.</p>
            </div>
          </ScrollReveal>
        </div>
      </footer>
    </div>
  );
}
