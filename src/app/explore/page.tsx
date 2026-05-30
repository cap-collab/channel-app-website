import { redirect } from 'next/navigation';

// /explore was renamed to /scene — keep this route as a redirect so existing
// links, bookmarks, and any navigation pointing at /explore still resolve.
export default function ExplorePage() {
  redirect('/scene');
}
