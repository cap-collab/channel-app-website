import Link from "next/link";
import Image from "next/image";
import ScrollReveal from "@/components/ScrollReveal";
import FAQAccordion from "@/components/FAQAccordion";
import PhoneMockup from "@/components/PhoneMockup";
import HomeScreen from "@/components/mockups/HomeScreen";
import MyShowsScreen from "@/components/mockups/MyShowsScreen";
import ChatScreen from "@/components/mockups/ChatScreen";

const faqItems = [
  {
    question: "What is Channel?",
    answer:
      "Channel is a home for DJ radio culture — a place to listen, discover, and engage with independent stations, their DJs, and the communities behind them.",
  },
  {
    question: "How does it work?",
    answer:
      "We aggregate livestreams from selected independent radios and give listeners new ways to connect: calendar browsing, show reminders, chat, and soon direct support tools like tipping and super chats.",
  },
  {
    question: "Why only a few radios?",
    answer:
      "Channel is growing intentionally. We partner with stations who share our values and want to actively build stronger community engagement.",
  },
  {
    question: "Why is the mobile app not ready yet?",
    answer:
      "We're onboarding partner radios and waiting for authorization to feature some of the leading DJ radios in our app. Great things take time.",
  },
  {
    question: "How can I help?",
    answer:
      "Join the community, share Channel with friends, and tell your favorite radios why you want to see them on the platform.",
  },
  {
    question: "How can I feature my radio on Channel?",
    answer:
      "We'd love to connect. Fill out our application form with your radio info or email us at info@channel-app.com and we will be in touch shortly.",
    hasLink: true,
  },
];

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-md border-b border-gray-900">
        <div className="max-w-7xl mx-auto px-6 py-2 flex items-center justify-between">
          <Image
            src="/logo-white.svg"
            alt="CHANNEL"
            width={160}
            height={32}
            className="h-8 md:h-9 w-auto"
            priority
          />
          <nav className="flex items-center gap-3 md:gap-4">
            <Link
              href="/djshows"
              className="bg-white text-black px-4 md:px-6 py-2 rounded-lg text-sm font-semibold hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(255,255,255,0.2)] transition-all"
            >
              Browse DJ Shows
            </Link>
            <a
              href="#get-involved"
              className="hidden sm:inline-block text-gray-400 hover:text-white text-sm transition-colors"
            >
              Get Involved
            </a>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="min-h-screen flex flex-col justify-center items-center px-6 pt-24 pb-20 relative">
        <div className="max-w-3xl text-center">
          <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
            The live-streaming app<br />for DJ shows.
          </h1>

          <p className="text-lg md:text-xl text-gray-400 mb-12 max-w-xl mx-auto leading-relaxed">
            Turn every listen into real support for independent culture.
          </p>

          <Link
            href="/djshows"
            className="inline-block bg-white text-black px-10 py-4 rounded-xl text-lg font-semibold hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(255,255,255,0.15)] transition-all"
          >
            Browse DJ Shows
          </Link>

          <p className="mt-6 text-sm text-gray-600">Coming soon to iOS</p>
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

      {/* Values Section - 3 columns with mockups below */}
      <section className="py-24 px-6">
        <ScrollReveal>
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row md:divide-x divide-gray-800">
              {/* Curated */}
              <div className="flex-1 py-8 md:py-0 md:px-8 first:md:pl-0 last:md:pr-0 border-b md:border-b-0 border-gray-800 last:border-b-0 flex flex-col items-center">
                <h2 className="text-xl md:text-2xl font-semibold text-white mb-4 text-center">
                  Curated
                </h2>
                <p className="text-gray-400 leading-relaxed text-center text-sm mb-8">
                  Channel partners with independent radios and DJs who want deeper
                  relationships with their audience. Our goal is to build a more
                  transparent, sustainable and engaging ecosystem for artists,
                  curators, and streamers.
                </p>
                <div className="transform scale-[0.55] origin-top -mb-[45%]">
                  <PhoneMockup className="w-[300px]">
                    <HomeScreen />
                  </PhoneMockup>
                </div>
              </div>

              {/* Supportive */}
              <div className="flex-1 py-8 md:py-0 md:px-8 first:md:pl-0 last:md:pr-0 border-b md:border-b-0 border-gray-800 last:border-b-0 flex flex-col items-center">
                <h2 className="text-xl md:text-2xl font-semibold text-white mb-4 text-center">
                  Supportive
                </h2>
                <p className="text-gray-400 leading-relaxed text-center text-sm mb-8">
                  Channel enables direct support for DJs and stations through super
                  chats, tipping, and community-driven features. We build tools that
                  amplify culture, not extract from it. We don&apos;t do ads.
                </p>
                <div className="transform scale-[0.55] origin-top -mb-[45%]">
                  <PhoneMockup className="w-[300px]">
                    <MyShowsScreen />
                  </PhoneMockup>
                </div>
              </div>

              {/* Participative */}
              <div className="flex-1 py-8 md:py-0 md:px-8 first:md:pl-0 last:md:pr-0 border-b md:border-b-0 border-gray-800 last:border-b-0 flex flex-col items-center">
                <h2 className="text-xl md:text-2xl font-semibold text-white mb-4 text-center">
                  Participative
                </h2>
                <p className="text-gray-400 leading-relaxed text-center text-sm mb-8">
                  Channel is built for participation and community. Listeners can
                  tune in, join the chat, send love, and connect with other
                  streamers or show hosts in real time.
                </p>
                <div className="transform scale-[0.55] origin-top -mb-[45%]">
                  <PhoneMockup className="w-[300px]">
                    <ChatScreen />
                  </PhoneMockup>
                </div>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* FAQ Section */}
      <section className="py-24 px-6">
        <ScrollReveal>
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-12 text-center">
              About / FAQs
            </h2>
            <FAQAccordion items={faqItems} />
          </div>
        </ScrollReveal>
      </section>

      {/* Get Involved Section */}
      <section id="get-involved" className="py-24 px-6 bg-gray-950">
        <ScrollReveal>
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-8 text-center">
              Get Involved
            </h2>

            <div className="space-y-6 text-gray-400 leading-relaxed">
              <p>
                My name is Cap. I&apos;m building Channel out of love for DJ radio and the communities that make it so special.
              </p>

              <p>
                After moving from Paris to New York to Los Angeles, I realized how hard it was to stay connected with my favorite DJs, dancers, and curators beyond the dancefloor. This ecosystem deserves better tools: to support artists, strengthen communities, and make it easier to follow the sounds and the people you love.
              </p>

              <p>
                I&apos;m looking to connect with <span className="text-white">DJs, radio operators, nightlife promoters, dancers, and music heads</span> of all kinds. Whether you want to collaborate, give feedback, or just chat, I&apos;d truly love to hear from you.
              </p>

              <p>
                Channel is growing, and I&apos;m actively seeking help with:
              </p>

              <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
                <li>Fundraising</li>
                <li>Product & website design</li>
                <li>DJ & radio monetization strategy</li>
                <li>Marketing & community building</li>
                <li>Partnerships & licensing</li>
              </ul>

              <p>
                If any of this resonates, reach out. I&apos;d love to connect.
              </p>
            </div>

            <div className="mt-10 text-center">
              <a
                href="mailto:info@channel-app.com"
                className="inline-block bg-white text-black px-10 py-4 rounded-xl text-lg font-semibold hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(255,255,255,0.15)] transition-all"
              >
                Contact Us
              </a>
            </div>
          </div>
        </ScrollReveal>
      </section>

      {/* Footer */}
      <footer className="py-24 px-6 border-t border-gray-900">
        <div className="max-w-3xl mx-auto text-center">
          <ScrollReveal>
            <h3 className="text-2xl md:text-3xl font-semibold text-white mb-4">
              Still have questions?
            </h3>
            <p className="text-gray-400 mb-10">
              Email us anytime:{" "}
              <a
                href="mailto:info@channel-app.com"
                className="text-white hover:text-gray-300 transition-colors"
              >
                info@channel-app.com
              </a>
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
              <a
                href="mailto:info@channel-app.com"
                className="inline-block bg-white text-black px-8 py-4 rounded-xl text-base font-semibold hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(255,255,255,0.15)] transition-all"
              >
                Contact Us
              </a>
              <Link
                href="/apply"
                className="inline-block bg-transparent border border-gray-600 text-white px-8 py-4 rounded-xl text-base font-medium hover:border-white hover:bg-white/5 transition-all"
              >
                Feature Your Station
              </Link>
            </div>

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
