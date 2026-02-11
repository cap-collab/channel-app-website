import { Metadata } from "next";
import { getAdminDb } from "@/lib/firebase-admin";
import { VenuePublicPage } from "./VenuePublicPage";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

async function getVenueData(slug: string): Promise<{ name: string; description?: string } | null> {
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
    return {
      name: data.name || slug,
      description: data.description || undefined,
    };
  } catch (error) {
    console.error("[Venue Metadata] Error:", error);
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const venue = await getVenueData(slug);
  const name = venue?.name || slug;
  const title = `Channel - ${name}`;
  const description = venue?.description || `${name} on Channel`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
    },
    twitter: {
      title,
      description,
    },
  };
}

export default async function VenueProfilePage({ params }: Props) {
  const { slug } = await params;
  return <VenuePublicPage slug={slug} />;
}
