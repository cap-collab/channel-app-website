import { Metadata } from "next";

const BRAND = "Channel";
const HOME_TITLE = "Channel — Human Radio";
const DEFAULT_DESCRIPTION = "Left-field electronic music curated by underground selectors. No ads. No algorithms.";
// Small square Channel logo used as the fallback OG image when a dynamic
// page (DJ/collective/archive/etc.) has no per-entity photo. 180x180 so
// Facebook/Messenger pick the compact left-thumbnail card layout
// (anything above ~600px on either side triggers their big banner).
const FALLBACK_IMAGE = "/apple-touch-icon.png";

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
  const ogTitle = title ? `${title} — ${BRAND}` : HOME_TITLE;
  // Always emit an og:image so social platforms don't scrape a random image
  // (the page logo, a random <img>, etc.) when a DJ/collective has no photo.
  // Declare 200x200 dimensions — Messenger/Facebook only pick the compact
  // left-thumbnail layout when both sides are below ~200px; anything bigger
  // (including a square 400x400) renders as a giant rectangle on top.
  // Twitter is forced to `summary` (small square card) for the same reason.
  const ogImage = image || FALLBACK_IMAGE;
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
      images: [{ url: ogImage, width: 200, height: 200 }],
    },
    twitter: {
      card: "summary",
      title: ogTitle,
      description,
      images: [ogImage],
    },
  };
}
