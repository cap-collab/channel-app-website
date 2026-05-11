import { Metadata } from "next";
import { getAdminDb } from "@/lib/firebase-admin";
import { makeOG } from "@/lib/og";
import { VenuePublicPage } from "./VenuePublicPage";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

async function getVenueData(slug: string): Promise<{ name: string; photo: string | null } | null> {
  const adminDb = getAdminDb();
  if (!adminDb) return null;

  try {
    const snapshot = await adminDb
      .collection("venues")
      .where("slug", "==", slug)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    const data = snapshot.docs[0].data();
    return { name: data.name || slug, photo: data.photo || null };
  } catch (error) {
    console.error("[Venue Metadata] Error:", error);
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const venue = await getVenueData(slug);
  const name = venue?.name || slug;
  return makeOG({
    title: name,
    description: `Discover shows, DJs, and events at ${name} on Channel.`,
    image: venue?.photo || undefined,
    path: `/venue/${encodeURIComponent(slug)}`,
  });
}

export default async function VenueProfilePage({ params }: Props) {
  const { slug } = await params;
  return <VenuePublicPage slug={slug} />;
}
