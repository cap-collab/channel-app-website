import { MyShowsClient } from "./MyShowsClient";

export const metadata = {
  title: "My Shows",
  description: "Your saved shows and watchlist.",
  robots: { index: false, follow: false },
};

export default function MyShowsPage() {
  return <MyShowsClient />;
}
