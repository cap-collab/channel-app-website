"use client";

import { useState } from "react";
import Link from "next/link";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import ScrollReveal from "@/components/ScrollReveal";
import FAQAccordion from "@/components/FAQAccordion";
import PhoneMockup from "@/components/PhoneMockup";
import HomeScreen from "@/components/mockups/HomeScreen";
import MyShowsScreen from "@/components/mockups/MyShowsScreen";
import ChatScreen from "@/components/mockups/ChatScreen";
import { Header } from "@/components/Header";

const faqItems = [
  {
    question: "What is Channel?",
    answer:
      "Channel is a live-streaming app for DJ culture. It's where select live DJ sets are broadcast, and where listeners can tune in together, in real time.\n\nChannel isn't about passive listening. It's about presence, shared moments, and supporting the people behind the music.",
  },
  {
    question: "Who is Channel for?",
    answer:
      "Channel is built for DJs, venues, and curators who want deeper relationships with their audience — and for listeners who care about independent culture.",
  },
  {
    question: "How is Channel different from other streaming apps?",
    answer:
      "Channel is not social audio, and it's not a feed.\n\nEverything on Channel is live, intentional, and anchored in a real moment — a DJ set, a venue, a curator. Listeners aren't just tuning in; they're showing up together while it's happening.",
  },
  {
    question: "Can I listen on Channel today?",
    answer:
      "Yes. Channel is live on the web, and available on iOS via TestFlight while we continue expanding access.\n\nYou can tune into live sets, see what's coming up, and join the chat during broadcasts.",
  },
  {
    question: "Who can broadcast on Channel?",
    answer:
      "Channel is open to DJs, venues, and curators who want to host live broadcasts.\n\nIf your DJ setup connects to a computer — through a controller, a mixer with USB, or a simple audio interface — you already have what you need to go live. Check our streaming setup guide for details.\n\nIf you already have a radio stream, we can feature you as well.\n\nWe onboard progressively to keep the experience intentional and high-quality.",
    hasLink: true,
  },
  {
    question: "Do I need special equipment to go live?",
    answer:
      "No. Most everyday DJ setups already work. No cameras required, and no complex software needed to get started.\n\nSee our streaming setup guide for more details on what equipment works.",
    hasLink: true,
  },
  {
    question: "Can listeners interact during live sets?",
    answer:
      "Yes. Listeners can tune in, join the chat, send love, and connect with others — while the music is playing.\n\nParticipation is there to support the moment, not distract from it.",
  },
  {
    question: "How does support work on Channel?",
    answer:
      "Channel enables direct support for DJs, curators, and venues through tipping, exclusive drops, and community-driven features.\n\nWe don't run ads. Support flows to the people creating the culture.",
  },
  {
    question: "Why isn't Channel fully available on the App Store yet?",
    answer:
      "Channel is currently in beta on iOS.\n\nWe're rolling out access thoughtfully to make sure broadcasts are authorized, the live experience feels right, and the community features work as intended.\n\nThe web version is already live.",
  },
  {
    question: "How can I get involved?",
    answer:
      "If you're a DJ, venue, or curator and want to host live broadcasts, reach out at info@channel-app.com\n\nIf you're a radio and want to be featured on Channel, reach out.\n\nIf you're a listener, tune in, show up in the chat, and invite people who care about DJ culture.",
    hasLink: true,
  },
  {
    question: "What's next?",
    answer:
      "More live broadcasts. More venues. More ways to support the people behind the music.\n\nChannel is built alongside the community using it.",
  },
];

export default function Home() {
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || emailStatus === "submitting" || !db) return;

    setEmailStatus("submitting");
    try {
      await addDoc(collection(db, "beta-waitlist"), {
        email,
        platform: "android",
        submittedAt: serverTimestamp(),
      });
      setEmailStatus("success");
      setEmail("");
    } catch {
      setEmailStatus("error");
    }
  };

  return (
    <div className="min-h-screen">
      <Header />

      {/* Hero Section */}
      <section className="min-h-screen flex flex-col justify-center items-center px-6 pt-24 pb-20 relative bg-[#1a1a1a]">
        <div className="max-w-3xl text-center">
          <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight">
            Live streaming for<br />DJ communities.
          </h1>

          <p className="text-lg md:text-xl text-gray-400 mb-12 max-w-xl mx-auto leading-relaxed">
            Turn every listen into real support for independent culture.
          </p>

          <a
            href="https://testflight.apple.com/join/HcKTJ1nH"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-white text-black px-10 py-4 rounded-xl text-lg font-semibold hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(255,255,255,0.15)] transition-all"
          >
            Get the Beta
          </a>

          {/* Not on iOS - Email capture */}
          <div className="mt-6">
            {!showEmailInput ? (
              <button
                onClick={() => setShowEmailInput(true)}
                className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Not on iOS? Get notified
              </button>
            ) : emailStatus === "success" ? (
              <p className="text-sm text-green-400">Thanks! We&apos;ll notify you when Android is available.</p>
            ) : (
              <form onSubmit={handleEmailSubmit} className="flex flex-col items-center gap-2">
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    className="px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gray-500 w-56"
                  />
                  <button
                    type="submit"
                    disabled={emailStatus === "submitting"}
                    className="px-4 py-2 rounded-lg bg-gray-700 text-white text-sm font-medium hover:bg-gray-600 transition-colors disabled:opacity-50"
                  >
                    {emailStatus === "submitting" ? "..." : "Notify me"}
                  </button>
                </div>
                {emailStatus === "error" && (
                  <p className="text-sm text-red-400">Something went wrong. Try again.</p>
                )}
              </form>
            )}
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

      {/* Values Section - 3 columns with mockups below */}
      <section className="py-24 px-6 bg-black">
        <ScrollReveal>
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row md:divide-x divide-gray-800">
              {/* Curated */}
              <div className="flex-1 py-8 md:py-0 md:px-8 first:md:pl-0 last:md:pr-0 border-b md:border-b-0 border-gray-800 last:border-b-0 flex flex-col items-center">
                <h2 className="text-xl md:text-2xl font-semibold text-white mb-4 text-center">
                  Curated
                </h2>
                <p className="text-gray-400 leading-relaxed text-center text-sm mb-8">
                  Channel partners with DJs, venues, and curators who want deeper
                  relationships with their audience. Our goal is to support
                  meaningful live moments and build a more sustainable, engaging
                  culture around them.
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
                  Channel enables direct support for DJs, curators, and venues
                  through tipping, exclusive sales, and community-driven features.
                  We build tools that amplify culture — not extract from it. We
                  don&apos;t run ads.
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
                  Channel is built for live moments and shared experience. Listeners
                  can tune in, join the chat, send love, and connect in real time
                  with other listeners, DJs, and curators.
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
      <section className="py-24 px-6 bg-[#1a1a1a]">
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
      <section id="get-involved" className="py-24 px-6 bg-black">
        <ScrollReveal>
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-8 text-center">
              Get Involved
            </h2>

            <div className="space-y-6 text-gray-400 leading-relaxed">
              <p>
                My name is Cap. I&apos;m building Channel out of love for DJ culture and the communities that make it so special.
              </p>

              <p>
                After moving from Paris to New York to Los Angeles, I realized how hard it was to stay connected with my favorite DJs, dancers, and curators beyond the dancefloor. This culture deserves better tools — to support artists, strengthen communities, and make it easier to follow the sounds and the people you love.
              </p>

              <p>
                I&apos;m looking to connect with <span className="text-white">DJs, venues, nightlife promoters, dancers, curators, and music heads</span> of all kinds. Whether you want to collaborate, give feedback, broadcast a live set, or just chat, I&apos;d truly love to hear from you.
              </p>

              <p>
                Channel is growing, and I&apos;m especially interested in conversations around DJ programming, live broadcasts, fan and community support, partnerships, and the realities of building sustainable culture around live music.
              </p>

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
      <footer className="py-24 px-6 bg-[#1a1a1a]">
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
