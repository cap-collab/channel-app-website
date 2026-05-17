import { Metadata } from "next";

const BRAND = "Channel";
const HOME_TITLE = "Channel — Human Radio";
const DEFAULT_DESCRIPTION = "Left-field electronic music from underground curators. No ads. No algorithms.";
// Small square Channel logo used as the fallback OG image when a dynamic
// page (DJ/collective/archive/etc.) has no per-entity photo. 128x128 so
// iMessage/Facebook/Messenger pick the compact left-thumbnail card layout
// (anything above ~200px on either side can trigger the big banner on
// iMessage specifically; FB tolerates up to ~600px).
const FALLBACK_IMAGE = "/og-image.png";

// Messenger/Facebook ignore og:image:width/height hints and render layout
// from the actual image's dimensions. Firebase-hosted DJ photos are 640px+
// so Messenger always picks the big-banner card. Wrap remote URLs in the
// Next image optimizer so the OG crawler downloads a 128px thumbnail —
// small enough to trigger the compact left-thumb layout even for portrait
// source photos (which come back as ~128x187 from /_next/image, since it
// only constrains the longest side). Pass-through for local /public assets
// (no optimization gain, and `/_next/image` rejects non-allowlisted hosts
// anyway).
function thumbnailize(url: string): string {
  if (url.startsWith("/")) return url;
  return `/_next/image?url=${encodeURIComponent(url)}&w=128&q=75`;
}

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
  // Declare 128x128 dimensions — iMessage triggers big-banner above ~200px.
  // Twitter is forced to `summary` (small square card) for the same reason.
  const ogImage = image ? thumbnailize(image) : FALLBACK_IMAGE;
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
      images: [{ url: ogImage, width: 128, height: 128 }],
    },
    twitter: {
      card: "summary",
      title: ogTitle,
      description,
      images: [ogImage],
    },
  };
}
