import { Metadata } from "next";

const BRAND = "Channel";
const HOME_TITLE = "Channel — independent creative scenes";
const DEFAULT_DESCRIPTION = "For the music. And the people behind it.";

// Produces page metadata aligned with the root layout's `%s · Channel`
// template. Pass a short page title (no brand suffix) and a description.
// Omit `title` for pages that should use the home title verbatim.
//
// `path` should be the route path (e.g. "/", "/archives") — sets a
// self-referencing canonical so Google doesn't infer the wrong canonical.
export function makeOG({
  title,
  description = DEFAULT_DESCRIPTION,
  image,
  path,
}: {
  title?: string;
  description?: string;
  image?: string;
  path?: string;
} = {}): Metadata {
  const ogTitle = title ? `${title} · ${BRAND}` : HOME_TITLE;
  return {
    // `title` is a string here so the root layout's template doesn't re-suffix
    // (Next.js only applies templates to children's metadata when the child
    // sets `title` to a string and `title.absolute` is not provided — using
    // `absolute` to be explicit).
    title: { absolute: ogTitle },
    description,
    ...(path ? { alternates: { canonical: path } } : {}),
    openGraph: {
      title: ogTitle,
      description,
      ...(path ? { url: path } : {}),
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
