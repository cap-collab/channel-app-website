import { Metadata } from "next";

const BRAND = "Channel";
const HOME_TITLE = "Channel — community-led internet radio";
const DEFAULT_DESCRIPTION = "For the music. And the people behind it.";

// Produces page metadata aligned with the root layout's `%s · Channel`
// template. Pass a short page title (no brand suffix) and a description.
// Omit `title` for pages that should use the home title verbatim.
export function makeOG({
  title,
  description = DEFAULT_DESCRIPTION,
  image,
}: {
  title?: string;
  description?: string;
  image?: string;
} = {}): Metadata {
  const ogTitle = title ? `${title} · ${BRAND}` : HOME_TITLE;
  return {
    // `title` is a string here so the root layout's template doesn't re-suffix
    // (Next.js only applies templates to children's metadata when the child
    // sets `title` to a string and `title.absolute` is not provided — using
    // `absolute` to be explicit).
    title: { absolute: ogTitle },
    description,
    openGraph: {
      title: ogTitle,
      description,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}
