import { describe, it, expect } from "vitest";
import {
  toMillis,
  addCount,
  earliest,
  latest,
  unionArray,
  unionDjs,
  mergeStreamHistory,
  mergeLoveHistory,
  mergeTracklistView,
  mergePlayedArchiveIds,
} from "./merge-anon-history-reducers";

const ts = (ms: number) => ({ toMillis: () => ms }); // Timestamp-ish

describe("time helpers", () => {
  it("toMillis coerces every shape", () => {
    expect(toMillis(ts(1000))).toBe(1000);
    expect(toMillis({ _seconds: 2, _nanoseconds: 0 })).toBe(2000);
    expect(toMillis(new Date(1234))).toBe(1234);
    expect(toMillis("2020-01-01T00:00:00Z")).toBe(Date.parse("2020-01-01T00:00:00Z"));
    expect(toMillis(5555)).toBe(5555);
    expect(toMillis(null)).toBeNull();
  });
  it("earliest/latest pick the extreme and preserve the raw value", () => {
    const a = ts(100), b = ts(200);
    expect(earliest(a, b)).toBe(a);
    expect(latest(a, b)).toBe(b);
    // missing side → take the present one
    expect(earliest(undefined, b)).toBe(b);
    expect(latest(a, undefined)).toBe(a);
  });
});

describe("addCount", () => {
  it("sums, missing = 0", () => {
    expect(addCount(2, 3)).toBe(5);
    expect(addCount(undefined, 3)).toBe(3);
    expect(addCount(2, undefined)).toBe(2);
    expect(addCount(undefined, undefined)).toBe(0);
  });
});

describe("unionArray / unionDjs", () => {
  it("dedupes primitives, dest-first order", () => {
    expect(unionArray(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(unionArray(undefined, ["x"])).toEqual(["x"]);
  });
  it("unions djs by username, dest wins", () => {
    const dest = [{ name: "A", username: "a", photoUrl: "destA" }];
    const src = [{ name: "A2", username: "a", photoUrl: "srcA" }, { name: "B", username: "b" }];
    const out = unionDjs(dest, src);
    expect(out).toHaveLength(2);
    expect(out.find((d) => d.username === "a")?.photoUrl).toBe("destA"); // dest won
    expect(out.find((d) => d.username === "b")).toBeTruthy();
  });
});

describe("mergeStreamHistory", () => {
  it("source-only key copied verbatim", () => {
    const src = { archiveId: "x", streamCount: 1, firstStreamedAt: ts(10), lastStreamedAt: ts(10), djUsernames: ["a"] };
    expect(mergeStreamHistory(undefined, src)).toEqual(src);
  });
  it("overlapping key: count adds, first=earliest, last=latest, arrays union", () => {
    const dest = { archiveId: "x", streamCount: 2, firstStreamedAt: ts(100), lastStreamedAt: ts(200), djUsernames: ["a"], djUsernamesNormalized: ["a"], djs: [{ username: "a", name: "A" }] };
    const src = { archiveId: "x", streamCount: 3, firstStreamedAt: ts(50), lastStreamedAt: ts(300), djUsernames: ["a", "b"], djUsernamesNormalized: ["a", "b"], djs: [{ username: "b", name: "B" }] };
    const out = mergeStreamHistory(dest, src);
    expect(out.streamCount).toBe(5);
    expect(toMillis(out.firstStreamedAt as never)).toBe(50);
    expect(toMillis(out.lastStreamedAt as never)).toBe(300);
    expect(out.djUsernames).toEqual(["a", "b"]);
    expect((out.djs as unknown[]).length).toBe(2);
  });
  it("preserves gateCreditedAt (earliest if both)", () => {
    const dest = { streamCount: 1, gateCreditedAt: ts(500) };
    const src = { streamCount: 1, gateCreditedAt: ts(400) };
    const out = mergeStreamHistory(dest, src);
    expect(toMillis(out.gateCreditedAt as never)).toBe(400);
  });
});

describe("mergeLoveHistory", () => {
  it("adds loveCount, unions contexts, earliest/latest", () => {
    const dest = { djUsername: "d", loveCount: 1, contexts: ["live"], firstLovedAt: ts(100), lastLovedAt: ts(100) };
    const src = { djUsername: "d", loveCount: 4, contexts: ["archive"], firstLovedAt: ts(50), lastLovedAt: ts(200) };
    const out = mergeLoveHistory(dest, src);
    expect(out.loveCount).toBe(5);
    expect(out.contexts).toEqual(["live", "archive"]);
    expect(toMillis(out.firstLovedAt as never)).toBe(50);
    expect(toMillis(out.lastLovedAt as never)).toBe(200);
  });
});

describe("mergeTracklistView", () => {
  it("adds viewCount and merges times", () => {
    const out = mergeTracklistView(
      { viewCount: 2, firstViewedAt: ts(10), lastViewedAt: ts(20) },
      { viewCount: 1, firstViewedAt: ts(5), lastViewedAt: ts(30) },
    );
    expect(out.viewCount).toBe(3);
    expect(toMillis(out.firstViewedAt as never)).toBe(5);
    expect(toMillis(out.lastViewedAt as never)).toBe(30);
  });
});

describe("mergePlayedArchiveIds", () => {
  it("latest play wins per archive; union of keys", () => {
    const out = mergePlayedArchiveIds({ a: 100, b: 200 }, { a: 150, c: 300 }, 5000);
    expect(out).toEqual({ a: 150, b: 200, c: 300 });
  });
  it("trims to cap, keeping newest", () => {
    const out = mergePlayedArchiveIds({ a: 1, b: 2 }, { c: 3, d: 4 }, 2);
    expect(Object.keys(out).sort()).toEqual(["c", "d"]); // newest two
  });
});

// The property Cap asked about: a merge that is applied ONCE (compute-from-read)
// and would then have its source DELETED cannot double-count. Simulate: after a
// first merge, the "source" is empty, so a second merge is a no-op — counts stay.
describe("idempotency (no double-count on re-run)", () => {
  it("re-merging with an empty source leaves counts unchanged", () => {
    const dest = { streamCount: 5, firstStreamedAt: ts(50), lastStreamedAt: ts(300), djUsernames: ["a", "b"] };
    // First merge already happened → dest holds the summed value. Source docs
    // were deleted, so a re-run has NO source doc for this key: nothing to merge.
    // (mergeStreamHistory is never called for a key with no source doc.)
    // Assert the summed dest is stable if accidentally merged against a zero src.
    const zeroSrc = { streamCount: 0, firstStreamedAt: ts(50), lastStreamedAt: ts(300) };
    const out = mergeStreamHistory(dest, zeroSrc);
    expect(out.streamCount).toBe(5); // + 0, not doubled
    expect(toMillis(out.firstStreamedAt as never)).toBe(50);
    expect(toMillis(out.lastStreamedAt as never)).toBe(300);
  });
});
