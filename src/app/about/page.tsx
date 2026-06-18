import Link from "next/link";
import { Metadata } from "next";
import ScrollReveal from "@/components/ScrollReveal";
import FAQAccordion from "@/components/FAQAccordion";
import { Header } from "@/components/Header";
import { AboutEmailSignup } from "@/components/AboutEmailSignup";
import { AnimatedBackground } from "@/components/AnimatedBackground";

export const metadata: Metadata = {
  title: "About",
  description: "Channel is for independent creative scenes — artists, producers, labels, and collectives. No ads. No algorithms.",
  alternates: { canonical: "/about" },
};

const faqItems = [
  {
    question: "What is Channel?",
    answer:
      "An online radio platform built around artists and tastemakers.",
  },
  {
    question: "Tell me more.",
    answer:
      "Channel is a community-led internet radio platform.\n\nArtists, DJs, producers, collectives, and labels host live shows and listening sessions. Listeners discover music through people, and shared experiences.\n\nBuilt for intentional listening.\n\nNo ads. No algorithms.",
  },
  {
    question: "Who is it for?",
    answer:
      "Anyone who values taste and craft over algorithms and hype.",
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
      <AnimatedBackground />
      <Header position="sticky" />

      {/* About Section */}
      <section id="about-me" className="pb-24 px-6 pt-12">
        <ScrollReveal>
          <div className="max-w-3xl mx-auto">
            <div className="space-y-6 text-zinc-400 leading-relaxed">
              <p>
                My name is Cap. I&apos;m building Channel out of love for the music and the people behind it.
              </p>

              <p>
                After moving from France to New York to Los Angeles, I realized how difficult it is to stay connected to the people and scenes quietly shaping culture. The internet gives us endless music, but very little context, identity, or human connection.
              </p>

              <p>
                Channel is an alternative to algorithmic listening and mass consumption. A place that values taste and craft over visibility and hype.
              </p>
            </div>

            <div className="mt-10 flex justify-center">
              <Link
                href="/?play=1"
                className="inline-block bg-white text-black hover:bg-gray-200 transition-colors text-sm font-medium px-6 py-3 rounded"
              >
                Lock in
              </Link>
            </div>

            <div className="mt-8 flex justify-center">
              <AboutEmailSignup />
            </div>

            <div className="mt-6 flex justify-center">
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
