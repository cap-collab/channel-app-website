/**
 * Fake users for recommendation tests, defined purely by engagement history.
 * Each provides the raw doc shapes normalizeUser() consumes.
 */

import type {
  RawLoveHistoryDoc,
  RawStreamHistoryDoc,
  RawSearchFavoriteDoc,
} from "../normalize";

export interface FakeUser {
  uid: string;
  email: string;
  loveHistory: RawLoveHistoryDoc[];
  streamHistory: RawStreamHistoryDoc[];
  searchFavorites: RawSearchFavoriteDoc[];
  goLiveMutes?: string[];
  ownDjUsername?: string;
}

// Engaged with Maria (loved + streamed her spiral/uptempo set). This seeds:
//   engagedDjs = {maria}, engagedScenes = {spiral}, engagedTempos = {uptempo}.
export const USER_MARIA_FAN: FakeUser = {
  uid: "u-maria-fan",
  email: "fan@example.com",
  loveHistory: [{ djUsername: "Maria", djUsernameNormalized: "maria", djDisplayName: "Maria" }],
  streamHistory: [
    {
      archiveId: "a-maria-new",
      djUsernames: [{ username: "maria", name: "Maria" }],
      djUsernamesNormalized: ["maria"],
      streamCount: 3,
    },
  ],
  searchFavorites: [],
};

// Only a watchlist artist (searched "Ninka"), no listening history.
export const USER_WATCHLIST_ONLY: FakeUser = {
  uid: "u-watchlist",
  email: "watch@example.com",
  loveHistory: [],
  streamHistory: [],
  searchFavorites: [{ term: "Ninka" }],
};

// Brand-new user: no history at all → personalized sections empty → fallback.
export const USER_NEW: FakeUser = {
  uid: "u-new",
  email: "new@example.com",
  loveHistory: [],
  streamHistory: [],
  searchFavorites: [],
};

// Heavy listener: streamed Maria's new set many times → strong already-heard
// penalty on that archive.
export const USER_HEAVY: FakeUser = {
  uid: "u-heavy",
  email: "heavy@example.com",
  loveHistory: [{ djUsername: "Maria", djUsernameNormalized: "maria", djDisplayName: "Maria" }],
  streamHistory: [
    {
      archiveId: "a-maria-new",
      djUsernames: [{ username: "maria", name: "Maria" }],
      djUsernamesNormalized: ["maria"],
      streamCount: 50,
    },
    {
      archiveId: "a-maria-old",
      djUsernames: [{ username: "maria", name: "Maria" }],
      djUsernamesNormalized: ["maria"],
      streamCount: 1,
    },
  ],
  searchFavorites: [],
};
