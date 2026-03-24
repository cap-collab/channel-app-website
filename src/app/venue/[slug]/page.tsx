import { Metadata } from "next";
import { getAdminDb } from "@/lib/firebase-admin";
import { makeOG } from "@/lib/og";
import { VenuePublicPage } from "./VenuePublicPage";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

async function getVenueName(slug: string): Promise<string | null> {
  const adminDb = getAdminDb();
  if (!adminDb) return null;

  try {
    const snapshot = await adminDb
      .collection("venues")
      .where("slug", "==", slug)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    return snapshot.docs[0].data().name || null;
  } catch (error) {
    console.error("[Venue Metadata] Error:", error);
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const name = (await getVenueName(slug)) || slug;
  return makeOG({ title: `Channel - ${name}` });
}

export default async function VenueProfilePage({ params }: Props) {
  const { slug } = await params;
  return <VenuePublicPage slug={slug} />;
}
