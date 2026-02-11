"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { collection, query, where, getDocs, orderBy, Timestamp } from "firebase/firestore";
import { Header } from "@/components/Header";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { db } from "@/lib/firebase";
import { Venue, Event, EventDJRef } from "@/types/events";

// Icon components (same as DJPublicProfileClient)
const InstagramIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
  </svg>
);

const GlobeIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
  </svg>
);

const SoundCloudIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24">
    <path d="M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.27-2.154c-.009-.06-.052-.1-.084-.1zm-.9 1.53c-.057 0-.097.045-.105.097l-.138 1.627.152 1.578c.008.058.048.097.105.097.05 0 .09-.039.098-.097l.168-1.578-.168-1.627c-.008-.052-.048-.097-.112-.097zm1.8-1.627c-.063 0-.112.047-.12.105l-.218 2.406.218 2.313c.008.063.057.112.12.112.058 0 .105-.049.12-.112l.24-2.313-.24-2.406c-.015-.058-.062-.105-.12-.105zm.9-.45c-.068 0-.12.052-.127.112l-.195 2.969.195 2.843c.007.063.059.112.127.112.063 0 .112-.049.127-.112l.217-2.843-.217-2.969c-.015-.06-.064-.112-.127-.112zm.9-.675c-.075 0-.135.06-.142.127l-.173 3.757.173 3.607c.007.068.067.127.142.127.068 0 .127-.059.135-.127l.195-3.607-.195-3.757c-.008-.067-.067-.127-.135-.127zm.9-.675c-.082 0-.142.067-.15.135l-.15 4.545.15 4.35c.008.075.068.135.15.135.075 0 .135-.06.15-.135l.165-4.35-.165-4.545c-.015-.068-.075-.135-.15-.135zm.9-.45c-.09 0-.157.068-.165.15l-.127 5.107.127 4.867c.008.082.075.15.165.15.082 0 .15-.068.157-.15l.142-4.867-.142-5.107c-.007-.082-.075-.15-.157-.15zm.9-.225c-.097 0-.172.075-.18.165l-.105 5.445.105 5.137c.008.09.083.165.18.165.09 0 .165-.075.172-.165l.12-5.137-.12-5.445c-.007-.09-.082-.165-.172-.165zm.9-.225c-.105 0-.18.082-.187.18l-.083 5.782.083 5.37c.007.098.082.18.187.18.097 0 .172-.082.18-.18l.09-5.37-.09-5.782c-.008-.098-.083-.18-.18-.18zm1.125-.225c-.112 0-.195.09-.202.195l-.068 6.12.068 5.602c.007.105.09.195.202.195.105 0 .187-.09.195-.195l.075-5.602-.075-6.12c-.008-.105-.09-.195-.195-.195zm.9 0c-.12 0-.21.097-.217.21l-.045 6.232.045 5.602c.007.112.097.21.217.21.113 0 .203-.098.21-.21l.053-5.602-.053-6.232c-.007-.113-.097-.21-.21-.21zm.9.225c-.127 0-.225.105-.232.225l-.023 6.12.023 5.602c.007.12.105.225.232.225.12 0 .218-.105.225-.225l.03-5.602-.03-6.12c-.007-.12-.105-.225-.225-.225zm1.125-.45c-.142 0-.255.112-.262.247l-.008 6.683.008 5.55c.007.135.12.247.262.247.135 0 .247-.112.255-.247l.015-5.55-.015-6.683c-.008-.135-.12-.247-.255-.247zm1.575-.225c-.15 0-.27.12-.285.27v.015l-.008 6.795.008 5.535c.015.15.135.27.285.27.142 0 .263-.12.277-.27l.015-5.535-.015-6.795c-.014-.15-.135-.27-.277-.285zm.9.225c-.157 0-.285.127-.3.285v6.75l.015 5.52c.015.157.143.285.285.285.15 0 .278-.128.285-.285l.015-5.52V6.915c-.007-.158-.135-.285-.3-.285zm.9-.225c-.165 0-.3.135-.307.3v6.75l.015 5.52c.007.165.142.3.307.3.157 0 .285-.135.3-.3l.015-5.52V6.69c-.015-.165-.143-.3-.33-.3zm4.95 1.35c-.375 0-.735.052-1.08.15-.232-2.61-2.437-4.65-5.137-4.65-.69 0-1.35.142-1.95.39-.232.098-.293.195-.3.39v9.36c.007.202.157.367.352.39h8.115c1.5 0 2.715-1.215 2.715-2.715s-1.215-2.715-2.715-2.715z"/>
  </svg>
);

const ExternalLinkIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

interface Props {
  slug: string;
}

export function VenuePublicPage({ slug }: Props) {
  const [venue, setVenue] = useState<Venue | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Fetch venue by slug
  useEffect(() => {
    async function fetchVenue() {
      if (!db) {
        setLoading(false);
        setNotFound(true);
        return;
      }

      try {
        const venuesRef = collection(db, "venues");
        const q = query(venuesRef, where("slug", "==", slug));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        const doc = snapshot.docs[0];
        const data = doc.data();

        const venueData: Venue = {
          id: doc.id,
          name: data.name,
          slug: data.slug,
          photo: data.photo || null,
          location: data.location || null,
          description: data.description || null,
          genres: data.genres || [],
          socialLinks: data.socialLinks || {},
          residentDJs: data.residentDJs || [],
          createdAt: data.createdAt?.toMillis?.() || Date.now(),
          createdBy: data.createdBy,
        };

        setVenue(venueData);

        // Fetch upcoming events for this venue
        const now = Date.now();
        const eventsRef = collection(db, "events");
        const eventsQ = query(
          eventsRef,
          where("venueId", "==", doc.id),
          where("date", ">=", now),
          orderBy("date", "asc")
        );
        const eventsSnapshot = await getDocs(eventsQ);

        const eventsList: Event[] = [];
        eventsSnapshot.forEach((eventDoc) => {
          const eventData = eventDoc.data();
          eventsList.push({
            id: eventDoc.id,
            name: eventData.name,
            slug: eventData.slug,
            date: eventData.date,
            endDate: eventData.endDate || undefined,
            photo: eventData.photo || null,
            description: eventData.description || null,
            venueId: eventData.venueId || null,
            venueName: eventData.venueName || null,
            djs: eventData.djs || [],
            genres: eventData.genres || [],
            location: eventData.location || null,
            ticketLink: eventData.ticketLink || null,
            createdAt: eventData.createdAt?.toMillis?.() || Date.now(),
            createdBy: eventData.createdBy,
          });
        });

        setUpcomingEvents(eventsList);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching venue:", error);
        setNotFound(true);
        setLoading(false);
      }
    }

    fetchVenue();
  }, [slug]);

  const formatEventDate = (ms: number) => {
    return new Date(ms).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-zinc-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !venue) {
    return (
      <div className="min-h-screen bg-black">
        <Header position="sticky" />
        <main className="max-w-5xl mx-auto px-6 py-16">
          <div className="text-center py-12">
            <p className="text-zinc-500 mb-4">Venue not found</p>
            <p className="text-zinc-600 text-sm">
              The venue &quot;{slug}&quot; doesn&apos;t exist.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const socialLinks = venue.socialLinks || {};
  const hasSocialLinks = socialLinks.instagram || socialLinks.soundcloud || socialLinks.website || socialLinks.residentAdvisor;

  return (
    <div className="min-h-screen text-white relative">
      <AnimatedBackground />
      <Header position="sticky" />

      <main className="max-w-5xl mx-auto px-6 py-4 pb-24">
        {/* SECTION A: IDENTITY */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-6 mb-6 md:items-start">
          <div className="md:col-span-4">
            <div className="aspect-square bg-zinc-900 overflow-hidden border border-white/10">
              {venue.photo ? (
                <Image
                  src={venue.photo}
                  alt={venue.name}
                  width={400}
                  height={400}
                  className="w-full h-full object-cover"
                  unoptimized
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-24 h-24 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
              )}
            </div>
          </div>

          <div className="md:col-span-8 flex flex-col">
            {/* Large: Venue Name */}
            <h1 className="text-5xl sm:text-7xl md:text-8xl font-black uppercase tracking-tighter leading-none mb-4">
              {venue.name}
            </h1>

            {/* Small & Grey: Location + Genres */}
            <div className="mb-6">
              {venue.location && (
                <p className="text-zinc-500 text-xs uppercase tracking-[0.3em] mb-2">
                  {venue.location}
                </p>
              )}
              {venue.genres && venue.genres.length > 0 && (
                <p className="text-zinc-500 text-xs uppercase tracking-[0.2em]">
                  {venue.genres.join(" · ")}
                </p>
              )}
            </div>

            {/* Description */}
            {venue.description && (
              <div className="max-w-xl mb-6">
                <p className="text-base leading-relaxed text-zinc-300 font-light">
                  {venue.description}
                </p>
              </div>
            )}

            {/* Social Links */}
            {hasSocialLinks && (
              <div className="flex flex-wrap gap-3 mb-6">
                {socialLinks.instagram && (
                  <a
                    href={`https://instagram.com/${socialLinks.instagram.replace('@', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/50 border border-white/10 rounded-full text-zinc-400 hover:text-white hover:border-white/20 transition-colors text-xs"
                  >
                    <InstagramIcon size={12} />
                    {socialLinks.instagram.startsWith('@') ? socialLinks.instagram : `@${socialLinks.instagram}`}
                  </a>
                )}
                {socialLinks.soundcloud && (
                  <a
                    href={socialLinks.soundcloud}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/50 border border-white/10 rounded-full text-zinc-400 hover:text-white hover:border-white/20 transition-colors text-xs"
                  >
                    <SoundCloudIcon size={12} />
                    SoundCloud
                  </a>
                )}
                {socialLinks.residentAdvisor && (
                  <a
                    href={socialLinks.residentAdvisor}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/50 border border-white/10 rounded-full text-zinc-400 hover:text-white hover:border-white/20 transition-colors text-xs"
                  >
                    RA
                  </a>
                )}
                {socialLinks.website && (
                  <a
                    href={socialLinks.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/50 border border-white/10 rounded-full text-zinc-400 hover:text-white hover:border-white/20 transition-colors text-xs"
                  >
                    <GlobeIcon size={12} />
                    Website
                  </a>
                )}
              </div>
            )}
          </div>
        </section>

        {/* SECTION B: RESIDENT DJs */}
        {venue.residentDJs && venue.residentDJs.length > 0 && venue.residentDJs.some(dj => dj.djName) && (
          <section className="mb-8">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">
              Resident DJs
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {venue.residentDJs
                .filter((dj: EventDJRef) => dj.djName)
                .map((dj: EventDJRef, i: number) => {
                  const content = (
                    <div className="flex items-center gap-3 bg-zinc-900/50 border border-white/10 rounded-lg p-3 hover:bg-zinc-800/50 transition-colors">
                      {dj.djPhotoUrl ? (
                        <Image
                          src={dj.djPhotoUrl}
                          alt={dj.djName}
                          width={40}
                          height={40}
                          className="w-10 h-10 rounded-full object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center">
                          <svg className="w-5 h-5 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                      )}
                      <span className="text-sm text-white font-medium truncate">{dj.djName}</span>
                    </div>
                  );

                  if (dj.djUsername) {
                    return (
                      <Link key={i} href={`/dj/${dj.djUsername}`}>
                        {content}
                      </Link>
                    );
                  }
                  return <div key={i}>{content}</div>;
                })}
            </div>
          </section>
        )}

        {/* SECTION C: UPCOMING EVENTS */}
        {upcomingEvents.length > 0 && (
          <section className="mb-8">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">
              Upcoming Events
            </h2>
            <div className="space-y-3">
              {upcomingEvents.map((event) => (
                <div
                  key={event.id}
                  className="bg-zinc-900/50 border border-white/10 rounded-lg p-4 hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {event.photo && (
                      <Image
                        src={event.photo}
                        alt={event.name}
                        width={64}
                        height={64}
                        className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                        unoptimized
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium mb-1">{event.name}</p>
                      <p className="text-zinc-500 text-xs uppercase tracking-wide mb-2">
                        {formatEventDate(event.date)}
                        {event.location && <> &middot; {event.location}</>}
                      </p>
                      {event.djs.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {event.djs.map((dj: EventDJRef, i: number) => (
                            dj.djUsername ? (
                              <Link
                                key={i}
                                href={`/dj/${dj.djUsername}`}
                                className="text-xs text-zinc-400 hover:text-white transition-colors"
                              >
                                {dj.djName}
                                {i < event.djs.length - 1 ? "," : ""}
                              </Link>
                            ) : (
                              <span key={i} className="text-xs text-zinc-400">
                                {dj.djName}
                                {i < event.djs.length - 1 ? "," : ""}
                              </span>
                            )
                          ))}
                        </div>
                      )}
                    </div>
                    {event.ticketLink && (
                      <a
                        href={event.ticketLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-black text-xs font-medium rounded-full hover:bg-zinc-200 transition-colors flex-shrink-0"
                      >
                        Tickets
                        <ExternalLinkIcon size={10} />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
