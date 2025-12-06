import { MyShowsClient } from "./MyShowsClient";

export const metadata = {
  title: "My Shows - Channel",
  description: "Your saved shows and watchlist",
};

export default function MyShowsPage() {
  return <MyShowsClient />;
}
