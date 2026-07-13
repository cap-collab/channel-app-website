// Shared "share this recording" behavior used by the DJ/collective recording
// cards and the homepage archive grid. Every surface produces the SAME URL —
// `${origin}/?archive=<slug>` — which the homepage deep-link consumer in
// ArchiveHero.tsx (searchParams.get('archive')) auto-plays on load.
//
// Behavior: copy the URL to the clipboard first (so desktop, where the native
// share sheet usually doesn't exist, still gets the link), THEN open the native
// share sheet when available. Returns a result the caller can use to toast.

export type ShareArchiveResult =
  | { ok: true; usedNativeShare: boolean }
  | { ok: false };

/** Build the deep-link share URL for an archive slug. */
export function archiveShareUrl(slug: string): string {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://channel-app.com';
  return `${origin}/?archive=${encodeURIComponent(slug)}`;
}

/**
 * Copy the archive's deep-link to the clipboard and, when supported, open the
 * native share sheet. `title` is used as the share-sheet title on mobile.
 * Never throws — a cancelled share sheet or a clipboard rejection resolves to a
 * best-effort result so the UI stays quiet.
 */
export async function shareArchive(
  slug: string,
  title?: string,
): Promise<ShareArchiveResult> {
  if (!slug) return { ok: false };
  const url = archiveShareUrl(slug);

  // Copy first — this is the piece that always works and is the primary intent.
  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch {
    // Clipboard can reject outside a user gesture or in an insecure context.
  }

  // Then offer the native sheet where it exists (mobile, some desktops).
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(title ? { title, url } : { url });
      return { ok: true, usedNativeShare: true };
    } catch {
      // User dismissed the sheet (AbortError) or share failed — fall through to
      // the copy result so they still keep the copied link.
    }
  }

  return copied ? { ok: true, usedNativeShare: false } : { ok: false };
}
