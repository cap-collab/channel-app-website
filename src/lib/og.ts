import { Metadata } from "next";

const DEFAULT_DESCRIPTION = "For the music. And the people behind it.";

export function makeOG({
  title = "Channel",
  description = DEFAULT_DESCRIPTION,
  image,
}: {
  title?: string;
  description?: string;
  image?: string;
} = {}): Metadata {
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}
