import { Metadata } from "next";
import { getAdminDb } from "@/lib/firebase-admin";
import { CollectivePublicPage } from "./CollectivePublicPage";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

async function getCollectiveData(slug: string): Promise<{ name: string; description?: string } | null> {
  const adminDb = getAdminDb();
  if (!adminDb) return null;

  try {
    const snapshot = await adminDb
      .collection("collectives")
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
    console.error("[Collective Metadata] Error:", error);
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const collective = await getCollectiveData(slug);
  const name = collective?.name || slug;
  const title = `Channel - ${name}`;
  const description = collective?.description || `${name} on Channel`;

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

export default async function CollectiveProfilePage({ params }: Props) {
  const { slug } = await params;
  return <CollectivePublicPage slug={slug} />;
}
