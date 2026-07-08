import { describe, it, expect } from "vitest";
import { isListenerVisibleArchive } from "./archive-priority";

describe("isListenerVisibleArchive", () => {
  it("hides hidden-priority archives", () => {
    expect(isListenerVisibleArchive({ priority: "hidden", isPublic: true })).toBe(false);
  });

  it("hides private archives (isPublic === false)", () => {
    expect(isListenerVisibleArchive({ priority: "high", isPublic: false })).toBe(false);
  });

  it("hides an archive that is both hidden and private", () => {
    expect(isListenerVisibleArchive({ priority: "hidden", isPublic: false })).toBe(false);
  });

  it("treats undefined isPublic as public (legacy archives)", () => {
    expect(isListenerVisibleArchive({ priority: "high" })).toBe(true);
    expect(isListenerVisibleArchive({ priority: "medium" })).toBe(true);
  });

  it("shows a normal public archive at every non-hidden tier", () => {
    for (const priority of ["featured", "high", "medium", "low"]) {
      expect(isListenerVisibleArchive({ priority, isPublic: true })).toBe(true);
    }
  });

  it("shows an archive with no priority field (defaults to visible)", () => {
    expect(isListenerVisibleArchive({ isPublic: true })).toBe(true);
    expect(isListenerVisibleArchive({})).toBe(true);
  });
});
