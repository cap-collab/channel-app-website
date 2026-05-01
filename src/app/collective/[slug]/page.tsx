import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ slug: string }>;
}

// Collectives now live at /dj/<slug> — the unified profile component handles
// users, pending DJs, and collectives. Preserve old /collective/<slug> URLs
// with a redirect so existing bookmarks keep working.
export default async function CollectiveProfilePage({ params }: Props) {
  const { slug } = await params;
  redirect(`/dj/${slug}`);
}
