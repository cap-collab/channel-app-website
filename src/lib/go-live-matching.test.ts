import { describe, it, expect } from "vitest";
import {
  normalizeForLookup,
  buildAffiliationGraph,
  buildAffiliatedRecipients,
  buildRelatedUsernames,
  matchUserToShow,
  failsUniversalGates,
  type MatchableShow,
  type RelationshipSets,
  type MatchUserState,
  type DjUserDoc,
} from "./go-live-matching";

// ── Fixtures ────────────────────────────────────────────────────────────────
// A small crew graph:
//   maria (uid m) is the parent artist.
//   luke  (uid l) is affiliatedWithUid = m  → maria's affiliate, sibling of ninka.
//   ninka (uid n) is affiliatedWithUid = m  → sibling of luke.
//   dax   (uid d) borrows maria's audience: dax.audienceDjUids = [m].
const djUsers: DjUserDoc[] = [
  { id: "m", data: { chatUsername: "Maria", chatUsernameNormalized: "maria", djProfile: {} } },
  { id: "l", data: { chatUsername: "Luke", chatUsernameNormalized: "luke", djProfile: { affiliatedWithUid: "m" } } },
  { id: "n", data: { chatUsername: "Ninka", chatUsernameNormalized: "ninka", djProfile: { affiliatedWithUid: "m" } } },
  { id: "d", data: { chatUsername: "Dax", chatUsernameNormalized: "dax", djProfile: { audienceDjUids: ["m"] } } },
];

const graph = buildAffiliationGraph(djUsers);

// Maria's live show.
const mariaShow: MatchableShow = {
  name: "Maria Live",
  dj: "Maria",
  stationId: "broadcast",
  showId: "broadcast-maria1",
  djUsername: "maria",
  djUserId: "m",
};

// Dax's live show (borrows maria's audience).
const daxShow: MatchableShow = {
  name: "Dax Live",
  dj: "Dax",
  stationId: "broadcast",
  showId: "broadcast-dax1",
  djUsername: "dax",
  djUserId: "d",
};

// Build relationship sets the way the cron does, but with engagement sets
// supplied directly (the rec engine builds these from a user's own history).
function buildSets(opts: {
  engagedWithMaria?: string[];
  engagedWithLuke?: string[];
}): RelationshipSets {
  const affiliatedRecipientsByShowId = new Map<string, Set<string>>();
  const relatedUsernamesByShowId = new Map<string, Set<string>>();
  const borrowedUsernamesByShowId = new Map<string, Set<string>>();
  for (const show of [mariaShow, daxShow]) {
    const recipients = buildAffiliatedRecipients(show, graph);
    if (recipients) affiliatedRecipientsByShowId.set(show.showId, recipients);
    const rel = buildRelatedUsernames(show, graph);
    if (rel) {
      if (rel.related.size) relatedUsernamesByShowId.set(show.showId, rel.related);
      if (rel.borrowed.size) borrowedUsernamesByShowId.set(show.showId, rel.borrowed);
    }
  }

  const engagedByShowId = new Map<string, Set<string>>();
  engagedByShowId.set(mariaShow.showId, new Set(opts.engagedWithMaria ?? []));

  // Per-related-DJ engagement, keyed by normalized related username.
  const engagedByRelatedDjByShowId = new Map<string, Map<string, Set<string>>>();
  // Dax's show is bridged to fans of maria (audience-borrow).
  const daxRelated = new Map<string, Set<string>>();
  daxRelated.set("maria", new Set(opts.engagedWithMaria ?? []));
  engagedByRelatedDjByShowId.set(daxShow.showId, daxRelated);
  // Maria's show is bridged to fans of luke/ninka (crew).
  const mariaRelated = new Map<string, Set<string>>();
  mariaRelated.set("luke", new Set(opts.engagedWithLuke ?? []));
  engagedByRelatedDjByShowId.set(mariaShow.showId, mariaRelated);

  return {
    affiliatedRecipientsByShowId,
    relatedUsernamesByShowId,
    borrowedUsernamesByShowId,
    engagedByShowId,
    engagedByRelatedDjByShowId,
    normalizedUsernameToDisplay: graph.normalizedUsernameToDisplay,
  };
}

function userState(over: Partial<MatchUserState> & { userId: string }): MatchUserState {
  return {
    showFavorites: [],
    searchTerms: [],
    emailNotifications: undefined,
    goLiveMutes: new Set(),
    ...over,
  };
}

describe("normalizeForLookup", () => {
  it("strips all non-alphanumeric and lowercases", () => {
    expect(normalizeForLookup("Naomi Green")).toBe("naomigreen");
    expect(normalizeForLookup("dj-funk_99")).toBe("djfunk99");
  });
});

describe("buildAffiliationGraph + builders", () => {
  it("affiliated recipients = parent + affiliates + siblings, minus live DJ", () => {
    // Maria's show: recipients are her affiliates (luke, ninka). Maria herself excluded.
    const recipients = buildAffiliatedRecipients(mariaShow, graph)!;
    expect(recipients.has("l")).toBe(true);
    expect(recipients.has("n")).toBe(true);
    expect(recipients.has("m")).toBe(false);
  });

  it("luke's show recipients include parent maria + sibling ninka", () => {
    const lukeShow: MatchableShow = {
      name: "Luke Live", stationId: "broadcast", showId: "broadcast-luke1",
      djUsername: "luke", djUserId: "l",
    };
    const recipients = buildAffiliatedRecipients(lukeShow, graph)!;
    expect(recipients.has("m")).toBe(true); // parent
    expect(recipients.has("n")).toBe(true); // sibling
    expect(recipients.has("l")).toBe(false); // self excluded
  });

  it("related usernames: maria's crew = luke + ninka; borrowed empty", () => {
    const rel = buildRelatedUsernames(mariaShow, graph)!;
    expect(rel.related.has("luke")).toBe(true);
    expect(rel.related.has("ninka")).toBe(true);
    expect(rel.borrowed.size).toBe(0); // pure crew, no audience-borrow
  });

  it("dax borrows maria's audience: maria is related + borrowed", () => {
    const rel = buildRelatedUsernames(daxShow, graph)!;
    expect(rel.related.has("maria")).toBe(true);
    expect(rel.borrowed.has("maria")).toBe(true); // audience-borrow → caption "If you like Maria"
  });
});

describe("buildAffiliationGraph — collective crew leads", () => {
  // pip (uid p) + quincy (uid q) own collective "deep-coll". owning a collective
  // makes IT their crew lead, overriding any explicit affiliatedWithUid.
  const cDjUsers: DjUserDoc[] = [
    { id: "p", data: { chatUsername: "Pip", chatUsernameNormalized: "pip", djProfile: { affiliatedWithUid: "m" } } },
    { id: "q", data: { chatUsername: "Quincy", chatUsernameNormalized: "quincy", djProfile: {} } },
    { id: "m", data: { chatUsername: "Maria", chatUsernameNormalized: "maria", djProfile: {} } },
  ];
  const collectives = [{ id: "cid", slug: "deep-coll", name: "Deep Collective", owners: ["p", "q"] }];
  const cGraph = buildAffiliationGraph(cDjUsers, collectives);
  const leadKey = "collective:cid";

  it("owning a collective makes it the crew lead, overriding explicit affiliation", () => {
    expect(cGraph.affiliatedByLiveDjUid.get("p")).toBe(leadKey); // was "m", now collective
    expect(cGraph.affiliatedByLiveDjUid.get("q")).toBe(leadKey);
    // pip removed from maria's affiliate bucket (override un-buckets the old lead).
    expect(cGraph.affiliatesByUid.get("m")?.has("p")).toBeFalsy();
    expect(cGraph.affiliatesByUid.get(leadKey)).toEqual(new Set(["p", "q"]));
  });

  it("the collective lead resolves to its slug + name", () => {
    expect(cGraph.uidToUsername.get(leadKey)).toBe("deepcoll"); // normalizeForLookup strips dash
    expect(cGraph.normalizedUsernameToDisplay.get("deepcoll")).toBe("Deep Collective");
  });

  it("an owner's show relates to the collective + sibling owner (crew bridge)", () => {
    const pipShow: MatchableShow = {
      name: "Pip Live", stationId: "broadcast", showId: "broadcast-pip1",
      djUsername: "pip", djUserId: "p",
    };
    const rel = buildRelatedUsernames(pipShow, cGraph)!;
    // pip's crew = the collective (lead) + quincy (sibling owner).
    expect(rel.related.has("deepcoll")).toBe(true);
    expect(rel.related.has("quincy")).toBe(true);
  });
});

describe("matchUserToShow — tiers", () => {
  it("Tier 1: favorite show matches by exact name", () => {
    const sets = buildSets({});
    const u = userState({
      userId: "u1",
      showFavorites: [{ data: { term: "maria live", stationId: "broadcast" } }],
    });
    expect(matchUserToShow(mariaShow, u, sets)?.savedReason).toBe("favorite");
  });

  it("Tier 2: watchlist search term word-boundary matches show name", () => {
    const sets = buildSets({});
    const u = userState({ userId: "u2", searchTerms: ["Maria"] });
    expect(matchUserToShow(mariaShow, u, sets)?.savedReason).toBe("watchlist");
  });

  it("Tier 3: direct engagement (hearted/streamed the DJ)", () => {
    const sets = buildSets({ engagedWithMaria: ["u3"] });
    const u = userState({ userId: "u3" });
    expect(matchUserToShow(mariaShow, u, sets)?.engagementReason).toBe("engaged");
  });

  it("Tier 3 respects engagementGoLive opt-out", () => {
    const sets = buildSets({ engagedWithMaria: ["u3"] });
    const u = userState({ userId: "u3", emailNotifications: { engagementGoLive: false } });
    expect(matchUserToShow(mariaShow, u, sets)).toBeNull();
  });

  it("Tier 4a: affiliated artist matches by UID set", () => {
    const sets = buildSets({});
    const u = userState({ userId: "l" }); // luke is maria's affiliate
    const r = matchUserToShow(mariaShow, u, sets);
    expect(r?.matchedViaAffiliation).toBe(true);
    expect(r?.bridgeKind).toBeUndefined(); // direct affiliated-recipient, no bridge caption
  });

  it("Tier 4a respects affiliatedGoLive opt-out", () => {
    const sets = buildSets({});
    const u = userState({ userId: "l", emailNotifications: { affiliatedGoLive: false } });
    expect(matchUserToShow(mariaShow, u, sets)).toBeNull();
  });

  it("Tier 4b crew bridge: engaged with luke → matches maria's show as crew", () => {
    const sets = buildSets({ engagedWithLuke: ["u4"] });
    const u = userState({ userId: "u4" });
    const r = matchUserToShow(mariaShow, u, sets);
    expect(r?.matchedViaAffiliation).toBe(true);
    expect(r?.bridgeKind).toBe("crew");
    expect(r?.affiliationBridgeDj).toBe("Luke"); // raw display name
  });

  it("Tier 4b borrow bridge: engaged with maria → matches dax's show as borrow", () => {
    const sets = buildSets({ engagedWithMaria: ["u5"] });
    const u = userState({ userId: "u5" });
    const r = matchUserToShow(daxShow, u, sets);
    expect(r?.matchedViaAffiliation).toBe(true);
    expect(r?.bridgeKind).toBe("borrow");
    expect(r?.affiliationBridgeDj).toBe("Maria");
  });

  it("no match → null", () => {
    const sets = buildSets({});
    const u = userState({ userId: "stranger" });
    expect(matchUserToShow(mariaShow, u, sets)).toBeNull();
  });

  it("external station never matches", () => {
    const sets = buildSets({ engagedWithMaria: ["u3"] });
    const u = userState({ userId: "u3" });
    expect(matchUserToShow({ ...mariaShow, stationId: "nts1" }, u, sets)).toBeNull();
  });

  it("is deterministic: same inputs → same result", () => {
    const sets = buildSets({ engagedWithLuke: ["u4"] });
    const u = userState({ userId: "u4" });
    const a = matchUserToShow(mariaShow, u, sets);
    const b = matchUserToShow(mariaShow, u, sets);
    expect(a).toEqual(b);
  });
});

describe("failsUniversalGates", () => {
  it("blocks a muted DJ", () => {
    expect(failsUniversalGates(mariaShow, "u1", new Set(["maria"]))).toBe(true);
  });
  it("blocks the DJ from their own show", () => {
    expect(failsUniversalGates(mariaShow, "m", new Set())).toBe(true);
  });
  it("blocks a collective owner from their collective's show", () => {
    const collShow: MatchableShow = {
      name: "Collective Live", stationId: "broadcast", showId: "broadcast-coll1",
      djUsername: "thecollective", collectiveOwnerUserIds: ["c1", "c2"],
    };
    expect(failsUniversalGates(collShow, "c1", new Set())).toBe(true);
  });
  it("blocks a show with no resolvable DJ or collective", () => {
    expect(failsUniversalGates({ name: "x", stationId: "broadcast", showId: "x" }, "u1", new Set())).toBe(true);
  });
  it("passes a normal show for an unrelated user", () => {
    expect(failsUniversalGates(mariaShow, "u1", new Set())).toBe(false);
  });
});
