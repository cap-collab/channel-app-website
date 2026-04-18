import Image from "next/image";
import Link from "next/link";
import ScrollReveal from "@/components/ScrollReveal";
import FAQAccordion from "@/components/FAQAccordion";
import { Header } from "@/components/Header";

const faqItems = [
  {
    question: "What is Channel?",
    answer:
      "Channel is an online radio for the electronic music community, curated in LA.\n\nArtists, labels, venues, and collectives host shows and listening sessions. People tune in, listen together, and connect with their community.\n\nNo ads. No algorithms.",
  },
  {
    question: "Who is it for?",
    answer:
      "For artists and show hosts\nHost shows, share music, connect directly with the people who care about your craft, and notify your followers when something new happens.\n\nNo more depending on Instagram to reach your audience.\n\nFor listeners\nFollow the artists and curators you care about. Get notified when something new happens. Tune in when they host shows and connect with them and their community, live.\n\nNo more chasing stories to catch what's next.",
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
      <Header position="sticky" />

      {/* About Section */}
      <section id="about-me" className="pb-24 px-6 bg-black pt-12">
        <ScrollReveal>
          <div className="max-w-3xl mx-auto">
            <div className="flex justify-center mb-8">
              <Image
                src="/logo-white.svg"
                alt="Channel"
                width={120}
                height={24}
                priority
              />
            </div>

            <div className="space-y-6 text-zinc-400 leading-relaxed">
              <p>
                My name is Cap. I&apos;m building Channel out of love for the music, and the people behind it.
              </p>

              <p>
                After moving from France to New York to Los Angeles, I realized how hard it is to stay connected to the people shaping a scene. This culture deserves better tools to find and follow the sounds and people you care about.
              </p>

              <p>
                Channel is built with the same values that shape the spaces we love. On the dancefloor, that often means no recording, no yapping, no staring, and a shared focus on the music. Channel extends that culture beyond the dancefloor — a place to dive deeper into music, strengthen communities, and support the artists shaping our world.
              </p>

              <p>
                Channel is a space for conversation and community, grounded in respect. No harassment, no discrimination, no abusive behavior.
              </p>
            </div>

            <div className="mt-10 flex justify-center">
              <a
                href="https://instagram.com/channelrad.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white hover:text-gray-300 transition-colors text-sm"
              >
                Follow us on Instagram @channelrad.io
              </a>
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
