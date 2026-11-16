import { describe, expect, it } from "vitest";

import { defaultVolume, effectiveLevel, parseVolume } from "./volume";

describe("parseVolume", () => {
  it("reads a stored volume", () => {
    expect(parseVolume('{"level":0.35,"muted":true}')).toEqual({ level: 0.35, muted: true });
  });

  it("falls back to the default for missing or broken data", () => {
    expect(parseVolume(null)).toEqual(defaultVolume);
    expect(parseVolume("not json")).toEqual(defaultVolume);
    expect(parseVolume('{"level":"loud"}')).toEqual(defaultVolume);
  });

  it("keeps the level between 0 and 1", () => {
    expect(parseVolume('{"level":7}').level).toBe(1);
    expect(parseVolume('{"level":-2}').level).toBe(0);
  });
});

describe("effectiveLevel", () => {
  it("is silent when muted, whatever the level", () => {
    expect(effectiveLevel({ level: 0.6, muted: false })).toBe(0.6);
    expect(effectiveLevel({ level: 0.6, muted: true })).toBe(0);
  });
});
